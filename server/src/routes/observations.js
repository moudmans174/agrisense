import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { config } from '../config/env.js';
import { authenticate, loadField, scopeClause } from '../middleware/auth.js';
import { photoUpload, csvUpload } from '../middleware/upload.js';
import { asyncHandler, HttpError, parseCsv } from '../utils/helpers.js';

const r = Router();
r.use(authenticate);

// multipart forms send strings: treat '' as null, then coerce
const opt = (schema) => z.preprocess((v) => (v === '' || v === undefined || v === 'null' ? null : v), schema.nullable().optional());
const sev = opt(z.coerce.number().int().min(0).max(5));

const obsSchema = z.object({
  field_id: z.coerce.number().int(),
  observed_at: opt(z.string()),
  crop_stage: opt(z.string().max(40)),
  plant_height_cm: opt(z.coerce.number().min(0).max(1000)),
  canopy_cover_pct: opt(z.coerce.number().min(0).max(100)),
  pest_type: opt(z.string().max(80)),
  pest_severity: sev,
  disease_type: opt(z.string().max(80)),
  disease_severity: sev,
  weed_pressure: sev,
  soil_moisture_pct: opt(z.coerce.number().min(0).max(100)),
  leaf_color: opt(z.string().max(30)),
  latitude: opt(z.coerce.number().min(-90).max(90)),
  longitude: opt(z.coerce.number().min(-180).max(180)),
  notes: opt(z.string().max(4000)),
});

const COLS = ['field_id', 'user_id', 'observed_at', 'crop_stage', 'plant_height_cm', 'canopy_cover_pct', 'pest_type', 'pest_severity',
  'disease_type', 'disease_severity', 'weed_pressure', 'soil_moisture_pct', 'leaf_color', 'latitude', 'longitude', 'photo_url', 'notes'];

function values(d, userId, photoUrl) {
  return [d.field_id, userId, d.observed_at || new Date().toISOString(), d.crop_stage ?? null, d.plant_height_cm ?? null, d.canopy_cover_pct ?? null,
    d.pest_type ?? null, d.pest_severity ?? 0, d.disease_type ?? null, d.disease_severity ?? 0, d.weed_pressure ?? 0,
    d.soil_moisture_pct ?? null, d.leaf_color ?? null, d.latitude ?? null, d.longitude ?? null, photoUrl ?? null, d.notes ?? null];
}

r.get('/', asyncHandler(async (req, res) => {
  const params = [];
  const where = [scopeClause(req.user, params)];
  if (req.query.field_id) { params.push(req.query.field_id); where.push(`o.field_id=$${params.length}`); }
  if (req.query.from) { params.push(req.query.from); where.push(`o.observed_at >= $${params.length}`); }
  if (req.query.to) { params.push(req.query.to); where.push(`o.observed_at < ($${params.length}::date + 1)`); }
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
  const { rows } = await query(`
    SELECT o.*, f.name AS field_name, f.crop, fa.name AS farm_name, u.name AS observer
    FROM observations o JOIN fields f ON f.id=o.field_id JOIN farms fa ON fa.id=f.farm_id LEFT JOIN users u ON u.id=o.user_id
    WHERE ${where.join(' AND ')} ORDER BY o.observed_at DESC LIMIT ${limit}`, params);
  res.json(rows);
}));

r.post('/', photoUpload.single('photo'), asyncHandler(async (req, res) => {
  const d = obsSchema.parse(req.body);
  await loadField(req.user, d.field_id);
  const photo = req.file ? `/uploads/${req.file.filename}` : null;
  const { rows: [o] } = await query(
    `INSERT INTO observations (${COLS.join(',')}) VALUES (${COLS.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
    values(d, req.user.id, photo));
  res.status(201).json(o);
}));

r.put('/:id', photoUpload.single('photo'), asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM observations WHERE id=$1', [req.params.id]);
  if (!rows.length) throw new HttpError(404, 'Observation not found');
  await loadField(req.user, rows[0].field_id);
  const d = obsSchema.parse({ ...req.body, field_id: rows[0].field_id });
  const photo = req.file ? `/uploads/${req.file.filename}` : rows[0].photo_url;
  const v = values(d, rows[0].user_id, photo);
  const sets = COLS.slice(2).map((c, i) => `${c}=$${i + 1}`).join(',');
  const { rows: [o] } = await query(`UPDATE observations SET ${sets} WHERE id=$${COLS.length - 1} RETURNING *`, [...v.slice(2), rows[0].id]);
  res.json(o);
}));

r.delete('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM observations WHERE id=$1', [req.params.id]);
  if (!rows.length) throw new HttpError(404, 'Observation not found');
  await loadField(req.user, rows[0].field_id);
  await query('DELETE FROM observations WHERE id=$1', [rows[0].id]);
  if (rows[0].photo_url) fs.promises.unlink(path.resolve(config.uploadDir, path.basename(rows[0].photo_url))).catch(() => {});
  res.status(204).end();
}));

// Bulk import from CSV (e.g. exported from ODK / KoboToolbox)
r.post('/import', csvUpload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'CSV file is required');
  const fieldId = Number(req.body.field_id);
  await loadField(req.user, fieldId);
  const records = parseCsv(req.file.buffer.toString('utf8'));
  const errors = [];
  let inserted = 0;
  for (const [i, rec] of records.entries()) {
    const parsed = obsSchema.safeParse({ ...rec, field_id: fieldId });
    if (!parsed.success) { errors.push({ row: i + 2, error: parsed.error.issues[0].message }); continue; }
    await query(`INSERT INTO observations (${COLS.join(',')}) VALUES (${COLS.map((_, j) => `$${j + 1}`).join(',')})`, values(parsed.data, req.user.id, null));
    inserted++;
  }
  res.json({ inserted, errors });
}));

// -------- Irrigation / management log --------
const irrSchema = z.object({
  field_id: z.coerce.number().int(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount_mm: z.coerce.number().positive().max(300),
  method: z.string().max(30).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

r.get('/irrigation', asyncHandler(async (req, res) => {
  const params = [];
  const where = [scopeClause(req.user, params)];
  if (req.query.field_id) { params.push(req.query.field_id); where.push(`i.field_id=$${params.length}`); }
  const { rows } = await query(`
    SELECT i.*, f.name AS field_name FROM irrigation_events i JOIN fields f ON f.id=i.field_id JOIN farms fa ON fa.id=f.farm_id
    WHERE ${where.join(' AND ')} ORDER BY i.date DESC LIMIT 500`, params);
  res.json(rows);
}));

r.post('/irrigation', asyncHandler(async (req, res) => {
  const d = irrSchema.parse(req.body);
  await loadField(req.user, d.field_id);
  const { rows: [e] } = await query(
    'INSERT INTO irrigation_events (field_id,user_id,date,amount_mm,method,notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [d.field_id, req.user.id, d.date, d.amount_mm, d.method || null, d.notes || null]);
  res.status(201).json(e);
}));

r.delete('/irrigation/:id', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM irrigation_events WHERE id=$1', [req.params.id]);
  if (!rows.length) throw new HttpError(404, 'Event not found');
  await loadField(req.user, rows[0].field_id);
  await query('DELETE FROM irrigation_events WHERE id=$1', [rows[0].id]);
  res.status(204).end();
}));

export default r;
