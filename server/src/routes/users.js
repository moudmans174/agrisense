import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/helpers.js';

const r = Router();
r.use(authenticate, requireRole('admin'));

r.get('/', asyncHandler(async (_req, res) => {
  const { rows } = await query(`
    SELECT u.id, u.name, u.email, u.role, u.phone, u.organization, u.active, u.created_at,
           (SELECT COUNT(*) FROM farms f WHERE f.owner_id=u.id)::int AS farm_count
    FROM users u ORDER BY u.created_at DESC`);
  res.json(rows);
}));

r.post('/', asyncHandler(async (req, res) => {
  const d = z.object({
    name: z.string().trim().min(2), email: z.string().trim().toLowerCase().email(), password: z.string().min(8),
    role: z.enum(['admin', 'agronomist', 'farmer']), phone: z.string().optional().nullable(), organization: z.string().optional().nullable(),
  }).parse(req.body);
  const { rows: [u] } = await query(
    `INSERT INTO users (name,email,password_hash,role,phone,organization) VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id,name,email,role,phone,organization,active,created_at`,
    [d.name, d.email, await bcrypt.hash(d.password, 10), d.role, d.phone || null, d.organization || null]);
  res.status(201).json(u);
}));

r.patch('/:id', asyncHandler(async (req, res) => {
  const d = z.object({ role: z.enum(['admin', 'agronomist', 'farmer']).optional(), active: z.boolean().optional() }).parse(req.body);
  if (Number(req.params.id) === req.user.id && (d.active === false || (d.role && d.role !== 'admin'))) {
    throw new HttpError(400, 'You cannot demote or disable your own account');
  }
  const { rows } = await query(
    `UPDATE users SET role=COALESCE($1,role), active=COALESCE($2,active) WHERE id=$3
     RETURNING id,name,email,role,phone,organization,active,created_at`, [d.role ?? null, d.active ?? null, req.params.id]);
  if (!rows.length) throw new HttpError(404, 'User not found');
  res.json(rows[0]);
}));

r.delete('/:id', asyncHandler(async (req, res) => {
  if (Number(req.params.id) === req.user.id) throw new HttpError(400, 'You cannot delete your own account');
  const { rowCount } = await query('DELETE FROM users WHERE id=$1', [req.params.id]);
  if (!rowCount) throw new HttpError(404, 'User not found');
  res.status(204).end();
}));

// Contact messages from the public website
r.get('/messages/all', asyncHandler(async (_req, res) => {
  const { rows } = await query('SELECT * FROM contact_messages ORDER BY created_at DESC');
  res.json(rows);
}));
r.patch('/messages/:id', asyncHandler(async (req, res) => {
  const { handled } = z.object({ handled: z.boolean() }).parse(req.body);
  const { rows } = await query('UPDATE contact_messages SET handled=$1 WHERE id=$2 RETURNING *', [handled, req.params.id]);
  if (!rows.length) throw new HttpError(404, 'Message not found');
  res.json(rows[0]);
}));

export default r;
