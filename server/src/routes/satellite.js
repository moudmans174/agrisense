import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticate, loadField } from '../middleware/auth.js';
import { csvUpload } from '../middleware/upload.js';
import {
  computeIndices, interpretNdvi, simulateScenes, fetchSentinelHub, upsertScenes, sentinelHubEnabled, summarizeScenes,
} from '../services/satellite.js';
import { asyncHandler, HttpError, parseCsv, addDays, today, daysBetween } from '../utils/helpers.js';

const r = Router();
r.use(authenticate);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idx = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().min(-1).max(1).nullable());

r.get('/providers', (_req, res) => {
  res.json([
    { id: 'sentinel-hub', name: 'Sentinel-2 L2A (Sentinel Hub Statistical API)', enabled: sentinelHubEnabled(),
      note: sentinelHubEnabled() ? 'Credentials configured' : 'Set SH_CLIENT_ID and SH_CLIENT_SECRET to enable' },
    { id: 'simulated', name: 'Simulated Sentinel-2 (phenology + stress model)', enabled: true, note: 'For demos, training and offline use' },
  ]);
});

r.get('/field/:fieldId', asyncHandler(async (req, res) => {
  const field = await loadField(req.user, req.params.fieldId);
  const params = [field.id];
  let where = 'field_id=$1';
  if (req.query.from) { params.push(req.query.from); where += ` AND acquired_on >= $${params.length}`; }
  if (req.query.to) { params.push(req.query.to); where += ` AND acquired_on <= $${params.length}`; }
  if (req.query.max_cloud) { params.push(Number(req.query.max_cloud)); where += ` AND (cloud_cover IS NULL OR cloud_cover <= $${params.length})`; }
  const { rows } = await query(`SELECT * FROM satellite_observations WHERE ${where} ORDER BY acquired_on`, params);
  res.json({ scenes: rows.map((s) => ({ ...s, interpretation: interpretNdvi(s.ndvi) })), summary: summarizeScenes(rows) });
}));

r.post('/field/:fieldId/fetch', asyncHandler(async (req, res) => {
  const field = await loadField(req.user, req.params.fieldId);
  const d = z.object({
    provider: z.enum(['sentinel-hub', 'simulated']).default('simulated'),
    start: dateStr.optional(), end: dateStr.optional(),
  }).parse(req.body);
  const start = d.start || addDays(field.planting_date, -20);
  const end = d.end || today();
  if (start > end) throw new HttpError(400, 'start must be before end');
  if (daysBetween(start, end) > 400) throw new HttpError(400, 'Range too long (max 400 days)');
  const scenes = d.provider === 'sentinel-hub' ? await fetchSentinelHub(field, start, end) : await simulateScenes(field, start, end);
  const inserted = await upsertScenes(field.id, scenes);
  res.json({ provider: d.provider, inserted, start, end, summary: summarizeScenes(scenes) });
}));

const sceneSchema = z.object({
  acquired_on: dateStr, source: z.string().max(40).default('manual'),
  ndvi: idx, ndwi: idx.optional(), evi: idx.optional(), savi: idx.optional(),
  lst_c: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().min(-30).max(80).nullable()).optional(),
  cloud_cover: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().min(0).max(100).nullable()).optional(),
});

r.post('/field/:fieldId', asyncHandler(async (req, res) => {
  const field = await loadField(req.user, req.params.fieldId);
  let body = req.body;
  // allow submitting raw reflectances instead of indices
  if (body.B4 !== undefined && body.B8 !== undefined) body = { ...body, ...computeIndices(body) };
  const s = sceneSchema.parse(body);
  if (s.ndvi === null) throw new HttpError(400, 'NDVI is required');
  await upsertScenes(field.id, [s]);
  res.status(201).json({ ok: true, scene: s });
}));

r.post('/field/:fieldId/import', csvUpload.single('file'), asyncHandler(async (req, res) => {
  const field = await loadField(req.user, req.params.fieldId);
  if (!req.file) throw new HttpError(400, 'CSV file is required');
  const recs = parseCsv(req.file.buffer.toString('utf8'));
  const good = [], errors = [];
  recs.forEach((rec, i) => {
    const row = { ...rec, acquired_on: rec.acquired_on || rec.date, source: rec.source || 'csv-import' };
    try {
      const s = sceneSchema.parse(row.b4 !== undefined && row.b8 !== undefined
        ? { ...row, ...computeIndices({ B2: row.b2, B3: row.b3, B4: row.b4, B8: row.b8, B11: row.b11 }) } : row);
      if (s.ndvi === null) throw new Error('ndvi missing');
      good.push(s);
    } catch (e) { errors.push({ row: i + 2, error: e.issues?.[0]?.message || e.message }); }
  });
  const inserted = await upsertScenes(field.id, good);
  res.json({ inserted, errors });
}));

r.delete('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT field_id FROM satellite_observations WHERE id=$1', [req.params.id]);
  if (!rows.length) throw new HttpError(404, 'Scene not found');
  await loadField(req.user, rows[0].field_id);
  await query('DELETE FROM satellite_observations WHERE id=$1', [req.params.id]);
  res.status(204).end();
}));

r.post('/indices', asyncHandler(async (req, res) => {
  const out = computeIndices(req.body);
  res.json({ ...out, interpretation: interpretNdvi(out.ndvi) });
}));

export default r;
