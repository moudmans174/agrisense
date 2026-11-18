import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/helpers.js';

const r = Router();

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  phone: z.string().max(40).optional().nullable(),
  organization: z.string().max(160).optional().nullable(),
});

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone, organization: u.organization, created_at: u.created_at });

r.post('/register', asyncHandler(async (req, res) => {
  const data = registerSchema.parse(req.body);
  const exists = await query('SELECT 1 FROM users WHERE email=$1', [data.email]);
  if (exists.rows.length) throw new HttpError(409, 'An account with this email already exists');
  const hash = await bcrypt.hash(data.password, 10);
  const { rows: [user] } = await query(
    `INSERT INTO users (name, email, password_hash, role, phone, organization) VALUES ($1,$2,$3,'farmer',$4,$5) RETURNING *`,
    [data.name, data.email, hash, data.phone || null, data.organization || null]);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

r.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }).parse(req.body);
  const { rows } = await query('SELECT * FROM users WHERE email=$1', [email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) throw new HttpError(401, 'Invalid email or password');
  if (!user.active) throw new HttpError(403, 'Account disabled. Contact an administrator.');
  res.json({ token: signToken(user), user: publicUser(user) });
}));

r.get('/me', authenticate, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
  res.json(publicUser(rows[0]));
}));

r.put('/me', authenticate, asyncHandler(async (req, res) => {
  const data = z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().max(40).optional().nullable(),
    organization: z.string().max(160).optional().nullable(),
  }).parse(req.body);
  const { rows } = await query('UPDATE users SET name=$1, phone=$2, organization=$3 WHERE id=$4 RETURNING *',
    [data.name, data.phone || null, data.organization || null, req.user.id]);
  res.json(publicUser(rows[0]));
}));

r.put('/me/password', authenticate, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = z.object({ currentPassword: z.string(), newPassword: z.string().min(8).max(100) }).parse(req.body);
  const { rows } = await query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(currentPassword, rows[0].password_hash))) throw new HttpError(400, 'Current password is incorrect');
  await query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(newPassword, 10), req.user.id]);
  res.json({ ok: true });
}));

export default r;
