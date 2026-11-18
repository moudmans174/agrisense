import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticate, loadField, scopeClause } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/helpers.js';

const r = Router();
r.use(authenticate);

r.get('/', asyncHandler(async (req, res) => {
  const params = [];
  const where = [scopeClause(req.user, params)];
  if (req.query.status) { params.push(req.query.status); where.push(`a.status=$${params.length}`); }
  if (req.query.severity) { params.push(req.query.severity); where.push(`a.severity=$${params.length}`); }
  if (req.query.field_id) { params.push(req.query.field_id); where.push(`a.field_id=$${params.length}`); }
  const { rows } = await query(`
    SELECT a.*, f.name AS field_name, f.crop, fa.name AS farm_name
    FROM alerts a JOIN fields f ON f.id=a.field_id JOIN farms fa ON fa.id=f.farm_id
    WHERE ${where.join(' AND ')}
    ORDER BY CASE a.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
             CASE a.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
             a.updated_at DESC
    LIMIT 500`, params);
  res.json(rows);
}));

r.patch('/:id', asyncHandler(async (req, res) => {
  const { status } = z.object({ status: z.enum(['open', 'acknowledged', 'resolved']) }).parse(req.body);
  const { rows } = await query('SELECT field_id FROM alerts WHERE id=$1', [req.params.id]);
  if (!rows.length) throw new HttpError(404, 'Alert not found');
  await loadField(req.user, rows[0].field_id);
  const { rows: [a] } = await query('UPDATE alerts SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *', [status, req.params.id]);
  res.json(a);
}));

r.delete('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT field_id FROM alerts WHERE id=$1', [req.params.id]);
  if (!rows.length) throw new HttpError(404, 'Alert not found');
  await loadField(req.user, rows[0].field_id);
  await query('DELETE FROM alerts WHERE id=$1', [req.params.id]);
  res.status(204).end();
}));

export default r;
