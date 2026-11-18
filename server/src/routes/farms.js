import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticate, loadFarm, isStaff } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/helpers.js';

const r = Router();
r.use(authenticate);

const farmSchema = z.object({
  name: z.string().trim().min(2).max(160),
  location_name: z.string().max(160).optional().nullable(),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  owner_id: z.coerce.number().int().optional(),
});

r.get('/', asyncHandler(async (req, res) => {
  const params = [];
  let where = 'TRUE';
  if (!isStaff(req.user)) { params.push(req.user.id); where = 'fa.owner_id=$1'; }
  const { rows } = await query(`
    SELECT fa.*, u.name AS owner_name,
      COUNT(f.id)::int AS field_count, COALESCE(SUM(f.area_ha),0)::float AS total_area_ha
    FROM farms fa JOIN users u ON u.id=fa.owner_id
    LEFT JOIN fields f ON f.farm_id=fa.id
    WHERE ${where} GROUP BY fa.id, u.name ORDER BY fa.created_at DESC`, params);
  res.json(rows);
}));

r.get('/:id', asyncHandler(async (req, res) => {
  const farm = await loadFarm(req.user, req.params.id);
  const { rows: fields } = await query(`
    SELECT f.*, d.health_score, d.health_class, d.generated_at AS last_decision_at
    FROM fields f
    LEFT JOIN LATERAL (SELECT health_score, health_class, generated_at FROM decisions WHERE field_id=f.id ORDER BY generated_at DESC LIMIT 1) d ON TRUE
    WHERE f.farm_id=$1 ORDER BY f.name`, [farm.id]);
  res.json({ ...farm, fields });
}));

r.post('/', asyncHandler(async (req, res) => {
  const d = farmSchema.parse(req.body);
  const ownerId = isStaff(req.user) && d.owner_id ? d.owner_id : req.user.id;
  const { rows: [farm] } = await query(
    `INSERT INTO farms (owner_id,name,location_name,latitude,longitude,description) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [ownerId, d.name, d.location_name || null, d.latitude ?? null, d.longitude ?? null, d.description || null]);
  res.status(201).json(farm);
}));

r.put('/:id', asyncHandler(async (req, res) => {
  await loadFarm(req.user, req.params.id);
  const d = farmSchema.parse(req.body);
  const { rows: [farm] } = await query(
    `UPDATE farms SET name=$1, location_name=$2, latitude=$3, longitude=$4, description=$5 WHERE id=$6 RETURNING *`,
    [d.name, d.location_name || null, d.latitude ?? null, d.longitude ?? null, d.description || null, req.params.id]);
  res.json(farm);
}));

r.delete('/:id', asyncHandler(async (req, res) => {
  await loadFarm(req.user, req.params.id);
  const { rowCount } = await query('DELETE FROM farms WHERE id=$1', [req.params.id]);
  if (!rowCount) throw new HttpError(404, 'Farm not found');
  res.status(204).end();
}));

export default r;
