import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticate, loadField } from '../middleware/auth.js';
import { csvUpload } from '../middleware/upload.js';
import { syncFieldWeather, getForecast, hargreavesEt0 } from '../services/weather.js';
import { asyncHandler, HttpError, parseCsv, addDays, today, daysBetween, dayOfYear, round } from '../utils/helpers.js';

const r = Router();
r.use(authenticate);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

r.get('/field/:fieldId', asyncHandler(async (req, res) => {
  const field = await loadField(req.user, req.params.fieldId);
  const from = req.query.from || addDays(today(), -90);
  const to = req.query.to || today();
  const { rows } = await query('SELECT * FROM environmental_data WHERE field_id=$1 AND date BETWEEN $2 AND $3 ORDER BY date', [field.id, from, to]);
  const { rows: [agg] } = await query(`
    SELECT ROUND(SUM(rainfall_mm)::numeric,1) AS total_rain, ROUND(AVG(temp_mean)::numeric,1) AS avg_temp,
           ROUND(MAX(temp_max)::numeric,1) AS max_temp, ROUND(MIN(temp_min)::numeric,1) AS min_temp,
           ROUND(SUM(et0_mm)::numeric,1) AS total_et0, ROUND(AVG(humidity_pct)::numeric,1) AS avg_humidity,
           COUNT(*) FILTER (WHERE rainfall_mm >= 1)::int AS rain_days
    FROM environmental_data WHERE field_id=$1 AND date BETWEEN $2 AND $3`, [field.id, from, to]);
  res.json({ rows, summary: { ...agg, water_balance: round((agg.total_rain ?? 0) - (agg.total_et0 ?? 0), 1), from, to } });
}));

r.post('/field/:fieldId/sync', asyncHandler(async (req, res) => {
  const field = await loadField(req.user, req.params.fieldId);
  const d = z.object({ start: dateStr.optional(), end: dateStr.optional() }).parse(req.body);
  const start = d.start || addDays(field.planting_date, -30);
  const end = d.end || today();
  if (start > end) throw new HttpError(400, 'start must be before end');
  if (daysBetween(start, end) > 400) throw new HttpError(400, 'Range too long (max 400 days)');
  if (end > today()) throw new HttpError(400, 'Use the forecast endpoint for future dates');
  const result = await syncFieldWeather(field, start, end);
  res.json({ ...result, start, end });
}));

r.get('/field/:fieldId/forecast', asyncHandler(async (req, res) => {
  const field = await loadField(req.user, req.params.fieldId);
  const days = Math.min(parseInt(req.query.days || '7', 10), 14);
  res.json(await getForecast(field.centroid_lat, field.centroid_lng, days));
}));

const num = (min, max) => z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().min(min).max(max).nullable()).optional();
const envSchema = z.object({
  date: dateStr, source: z.string().max(40).default('station'),
  temp_max: num(-20, 60), temp_min: num(-30, 45), temp_mean: num(-25, 50), rainfall_mm: num(0, 600),
  humidity_pct: num(0, 100), wind_speed: num(0, 200), solar_rad: num(0, 50), et0_mm: num(0, 20),
});

async function upsertEnv(field, d) {
  const tmean = d.temp_mean ?? (d.temp_max !== null && d.temp_min !== null && d.temp_max !== undefined ? (d.temp_max + d.temp_min) / 2 : null);
  const et0 = d.et0_mm ?? (d.temp_max != null && d.temp_min != null ? round(hargreavesEt0(d.temp_max, d.temp_min, field.centroid_lat, dayOfYear(d.date)), 2) : null);
  await query(
    `INSERT INTO environmental_data (field_id,date,source,temp_max,temp_min,temp_mean,rainfall_mm,humidity_pct,wind_speed,solar_rad,et0_mm)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (field_id,date) DO UPDATE SET source=EXCLUDED.source, temp_max=EXCLUDED.temp_max, temp_min=EXCLUDED.temp_min,
       temp_mean=EXCLUDED.temp_mean, rainfall_mm=EXCLUDED.rainfall_mm, humidity_pct=EXCLUDED.humidity_pct,
       wind_speed=EXCLUDED.wind_speed, solar_rad=EXCLUDED.solar_rad, et0_mm=EXCLUDED.et0_mm`,
    [field.id, d.date, d.source, d.temp_max ?? null, d.temp_min ?? null, tmean, d.rainfall_mm ?? 0, d.humidity_pct ?? null,
      d.wind_speed ?? null, d.solar_rad ?? null, et0]);
}

// Manual entry (e.g. on-farm rain gauge or weather station reading)
r.post('/field/:fieldId', asyncHandler(async (req, res) => {
  const field = await loadField(req.user, req.params.fieldId);
  const d = envSchema.parse(req.body);
  await upsertEnv(field, d);
  res.status(201).json({ ok: true });
}));

r.post('/field/:fieldId/import', csvUpload.single('file'), asyncHandler(async (req, res) => {
  const field = await loadField(req.user, req.params.fieldId);
  if (!req.file) throw new HttpError(400, 'CSV file is required');
  const recs = parseCsv(req.file.buffer.toString('utf8'));
  let inserted = 0; const errors = [];
  for (const [i, rec] of recs.entries()) {
    const p = envSchema.safeParse(rec);
    if (!p.success) { errors.push({ row: i + 2, error: `${p.error.issues[0].path.join('.')}: ${p.error.issues[0].message}` }); continue; }
    await upsertEnv(field, p.data); inserted++;
  }
  res.json({ inserted, errors });
}));

r.delete('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT field_id FROM environmental_data WHERE id=$1', [req.params.id]);
  if (!rows.length) throw new HttpError(404, 'Record not found');
  await loadField(req.user, rows[0].field_id);
  await query('DELETE FROM environmental_data WHERE id=$1', [req.params.id]);
  res.status(204).end();
}));

export default r;
