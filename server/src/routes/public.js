// Unauthenticated endpoints that power the public website.
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { CROPS, kcAt, stageOf, seasonLength } from '../config/crops.js';
import { computeIndices, interpretNdvi } from '../services/satellite.js';
import { hargreavesEt0 } from '../services/weather.js';
import { asyncHandler, round, dayOfYear, today, HttpError } from '../utils/helpers.js';

const r = Router();

// simple in-memory rate limiter for the contact form
const hits = new Map();
function rateLimit(req, _res, next) {
  const key = req.ip;
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (list.length >= 5) return next(new HttpError(429, 'Too many messages. Please try again later.'));
  list.push(now); hits.set(key, list); next();
}

r.get('/stats', asyncHandler(async (_req, res) => {
  const { rows: [s] } = await query(`
    SELECT (SELECT COUNT(*) FROM farms)::int AS farms,
           (SELECT COUNT(*) FROM fields)::int AS fields,
           (SELECT COALESCE(ROUND(SUM(area_ha)::numeric,1),0) FROM fields)::float AS hectares,
           (SELECT COUNT(*) FROM observations)::int AS observations,
           (SELECT COUNT(*) FROM satellite_observations)::int AS satellite_scenes,
           (SELECT COUNT(*) FROM environmental_data)::int AS weather_days,
           (SELECT COUNT(*) FROM decisions)::int AS decisions,
           (SELECT COUNT(*) FROM users WHERE role='farmer')::int AS farmers`);
  res.json(s);
}));

r.get('/advisories', asyncHandler(async (req, res) => {
  const params = [];
  let where = 'published';
  if (req.query.crop) { params.push(req.query.crop); where += ` AND (crop=$${params.length} OR crop IS NULL)`; }
  const { rows } = await query(`SELECT id,title,body,region,crop,severity,created_at FROM advisories WHERE ${where} ORDER BY created_at DESC LIMIT 20`, params);
  res.json(rows);
}));

r.get('/crops', (_req, res) => {
  res.json(Object.entries(CROPS).map(([key, c]) => ({
    key, label: c.label, seasonDays: seasonLength(key), stages: c.stages, kc: c.kc, typicalYield: c.typicalYield,
    pests: c.pests, diseases: c.diseases,
  })));
});

r.post('/contact', rateLimit, asyncHandler(async (req, res) => {
  const d = z.object({
    name: z.string().trim().min(2).max(120), email: z.string().trim().email(),
    subject: z.string().max(200).optional().nullable(), message: z.string().trim().min(10).max(5000),
  }).parse(req.body);
  await query('INSERT INTO contact_messages (name,email,subject,message) VALUES ($1,$2,$3,$4)', [d.name, d.email, d.subject || null, d.message]);
  res.status(201).json({ ok: true, message: 'Thank you — our team will get back to you shortly.' });
}));

// Public tools
r.post('/tools/indices', (req, res, next) => {
  try {
    const out = computeIndices(req.body);
    res.json({ ...out, interpretation: interpretNdvi(out.ndvi) });
  } catch (e) { next(e); }
});

r.post('/tools/water-need', (req, res, next) => {
  try {
    const d = z.object({
      crop: z.enum(Object.keys(CROPS)), planting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      latitude: z.coerce.number().min(-60).max(60), temp_max: z.coerce.number().min(-10).max(55), temp_min: z.coerce.number().min(-20).max(40),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(req.body);
    if (d.temp_min > d.temp_max) throw new HttpError(400, 'Minimum temperature cannot exceed maximum');
    const date = d.date || today();
    const das = Math.round((new Date(date) - new Date(d.planting_date)) / 86400000);
    const et0 = hargreavesEt0(d.temp_max, d.temp_min, d.latitude, dayOfYear(date));
    const kc = das >= 0 ? kcAt(d.crop, das) : 0;
    res.json({
      date, days_after_planting: das, stage: stageOf(d.crop, das), et0_mm: round(et0, 2), kc: round(kc, 2),
      etc_mm_day: round(et0 * kc, 2), etc_mm_week: round(et0 * kc * 7, 1),
      litres_per_ha_day: round(et0 * kc * 10000, 0),
      method: 'FAO-56 Hargreaves ET0 × single crop coefficient',
    });
  } catch (e) { next(e); }
});

export default r;
