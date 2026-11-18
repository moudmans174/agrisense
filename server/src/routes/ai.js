import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticate, loadField, requireRole, scopeClause } from '../middleware/auth.js';
import { csvUpload } from '../middleware/upload.js';
import { runDecision } from '../services/ai/engine.js';
import { trainYieldModel, YIELD_FEATURES, predictYield } from '../services/ai/yield.js';
import { buildFieldTimeseries } from '../services/fusion.js';
import { CROP_KEYS } from '../config/crops.js';
import { asyncHandler, HttpError, parseCsv, today } from '../utils/helpers.js';

const r = Router();
r.use(authenticate);

// ---- Decisions ----
r.post('/fields/:fieldId/decide', asyncHandler(async (req, res) => {
  const field = await loadField(req.user, req.params.fieldId);
  const result = await runDecision(field, { refresh: req.body?.refresh !== false });
  res.status(201).json(result);
}));

r.get('/fields/:fieldId/decisions', asyncHandler(async (req, res) => {
  const field = await loadField(req.user, req.params.fieldId);
  const limit = Math.min(parseInt(req.query.limit || '30', 10), 200);
  const { rows } = await query(
    `SELECT id, generated_at, crop_stage, days_after_planting, health_score, health_class, water_deficit_mm, irrigation_mm,
       pest_risk, disease_risk, predicted_yield, yield_low, yield_high, anomaly, recommendations
     FROM decisions WHERE field_id=$1 ORDER BY generated_at DESC LIMIT ${limit}`, [field.id]);
  res.json(rows);
}));

r.get('/decisions/:id', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM decisions WHERE id=$1', [req.params.id]);
  if (!rows.length) throw new HttpError(404, 'Decision not found');
  await loadField(req.user, rows[0].field_id);
  res.json(rows[0]);
}));

// Latest decision for every field the user can see
r.get('/decisions', asyncHandler(async (req, res) => {
  const params = [];
  const { rows } = await query(`
    SELECT d.*, f.name AS field_name, f.crop, fa.name AS farm_name
    FROM fields f JOIN farms fa ON fa.id=f.farm_id
    JOIN LATERAL (SELECT * FROM decisions WHERE field_id=f.id ORDER BY generated_at DESC LIMIT 1) d ON TRUE
    WHERE ${scopeClause(req.user, params)} ORDER BY d.health_score ASC NULLS LAST`, params);
  res.json(rows);
}));

// Run the engine for all visible fields
r.post('/run-all', asyncHandler(async (req, res) => {
  const params = [];
  const { rows: fields } = await query(
    `SELECT f.* FROM fields f JOIN farms fa ON fa.id=f.farm_id WHERE ${scopeClause(req.user, params)}`, params);
  const results = [];
  for (const f of fields) {
    try {
      const { decision, alerts } = await runDecision(f);
      results.push({ field_id: f.id, name: f.name, health: decision.health_score, alerts: alerts.length });
    } catch (e) {
      results.push({ field_id: f.id, name: f.name, error: e.message });
    }
  }
  res.json({ processed: results.length, results });
}));

// What-if: yield prediction only
r.get('/fields/:fieldId/yield', asyncHandler(async (req, res) => {
  const field = await loadField(req.user, req.params.fieldId);
  const { rows } = await buildFieldTimeseries(field, field.planting_date, today());
  res.json(await predictYield(field, rows));
}));

// ---- Models ----
r.get('/models', asyncHandler(async (_req, res) => {
  const { rows } = await query(`SELECT id,name,crop,version,algorithm,features,metrics,n_samples,active,trained_at FROM ml_models ORDER BY crop, version DESC`);
  res.json(rows);
}));

r.post('/models/train', requireRole('admin', 'agronomist'), asyncHandler(async (req, res) => {
  const { crop, lambda } = z.object({ crop: z.enum(CROP_KEYS), lambda: z.coerce.number().min(0).max(100).default(1) }).parse(req.body);
  res.status(201).json(await trainYieldModel(crop, lambda));
}));

// ---- Training data (historical seasons) ----
const seasonSchema = z.object({
  crop: z.enum(CROP_KEYS), season_year: z.coerce.number().int().min(1980).max(2100),
  mean_ndvi: z.coerce.number().min(-1).max(1), peak_ndvi: z.coerce.number().min(-1).max(1),
  cum_rain: z.coerce.number().min(0), gdd: z.coerce.number().min(0),
  mean_pest: z.coerce.number().min(0).max(5).default(0), mean_disease: z.coerce.number().min(0).max(5).default(0),
  yield_t_ha: z.coerce.number().min(0).max(200),
  field_id: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().int().nullable().optional()),
});

r.get('/seasons', asyncHandler(async (req, res) => {
  const params = [];
  let where = 'TRUE';
  if (req.query.crop) { params.push(req.query.crop); where = 'crop=$1'; }
  const { rows } = await query(`SELECT * FROM season_records WHERE ${where} ORDER BY season_year DESC, id DESC LIMIT 1000`, params);
  res.json({ features: YIELD_FEATURES, rows });
}));

r.post('/seasons', requireRole('admin', 'agronomist'), asyncHandler(async (req, res) => {
  const d = seasonSchema.parse(req.body);
  const { rows: [s] } = await query(
    `INSERT INTO season_records (field_id,crop,season_year,mean_ndvi,peak_ndvi,cum_rain,gdd,mean_pest,mean_disease,yield_t_ha)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [d.field_id ?? null, d.crop, d.season_year, d.mean_ndvi, d.peak_ndvi, d.cum_rain, d.gdd, d.mean_pest, d.mean_disease, d.yield_t_ha]);
  res.status(201).json(s);
}));

r.post('/seasons/import', requireRole('admin', 'agronomist'), csvUpload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'CSV file is required');
  const recs = parseCsv(req.file.buffer.toString('utf8'));
  let inserted = 0; const errors = [];
  for (const [i, rec] of recs.entries()) {
    const p = seasonSchema.safeParse(rec);
    if (!p.success) { errors.push({ row: i + 2, error: `${p.error.issues[0].path.join('.')}: ${p.error.issues[0].message}` }); continue; }
    const d = p.data;
    await query(`INSERT INTO season_records (field_id,crop,season_year,mean_ndvi,peak_ndvi,cum_rain,gdd,mean_pest,mean_disease,yield_t_ha)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [d.field_id ?? null, d.crop, d.season_year, d.mean_ndvi, d.peak_ndvi, d.cum_rain, d.gdd, d.mean_pest, d.mean_disease, d.yield_t_ha]);
    inserted++;
  }
  res.json({ inserted, errors });
}));

r.delete('/seasons/:id', requireRole('admin', 'agronomist'), asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM season_records WHERE id=$1', [req.params.id]);
  if (!rowCount) throw new HttpError(404, 'Record not found');
  res.status(204).end();
}));

export default r;
