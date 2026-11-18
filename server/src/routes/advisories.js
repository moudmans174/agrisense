import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { CROP_KEYS } from '../config/crops.js';
import { asyncHandler, HttpError } from '../utils/helpers.js';

const r = Router();
r.use(authenticate);

const schema = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(10).max(10000),
  region: z.string().max(120).optional().nullable(),
  crop: z.enum(CROP_KEYS).optional().nullable().or(z.literal('').transform(() => null)),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
  published: z.boolean().default(false),
});

r.get('/', asyncHandler(async (_req, res) => {
  const { rows } = await query('SELECT a.*, u.name AS author FROM advisories a LEFT JOIN users u ON u.id=a.author_id ORDER BY a.created_at DESC');
  res.json(rows);
}));

r.post('/', requireRole('admin', 'agronomist'), asyncHandler(async (req, res) => {
  const d = schema.parse(req.body);
  const { rows: [a] } = await query(
    'INSERT INTO advisories (title,body,region,crop,severity,published,author_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [d.title, d.body, d.region || null, d.crop || null, d.severity, d.published, req.user.id]);
  res.status(201).json(a);
}));

r.put('/:id', requireRole('admin', 'agronomist'), asyncHandler(async (req, res) => {
  const d = schema.parse(req.body);
  const { rows } = await query(
    'UPDATE advisories SET title=$1, body=$2, region=$3, crop=$4, severity=$5, published=$6 WHERE id=$7 RETURNING *',
    [d.title, d.body, d.region || null, d.crop || null, d.severity, d.published, req.params.id]);
  if (!rows.length) throw new HttpError(404, 'Advisory not found');
  res.json(rows[0]);
}));

r.delete('/:id', requireRole('admin', 'agronomist'), asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM advisories WHERE id=$1', [req.params.id]);
  if (!rowCount) throw new HttpError(404, 'Advisory not found');
  res.status(204).end();
}));

export default r;
