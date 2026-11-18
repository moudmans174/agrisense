import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { query } from '../db/pool.js';
import { HttpError } from '../utils/helpers.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, name: user.name }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

export async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Authentication required');
    let payload;
    try { payload = jwt.verify(token, config.jwtSecret); } catch { throw new HttpError(401, 'Invalid or expired token'); }
    const { rows } = await query('SELECT id, name, email, role, active FROM users WHERE id=$1', [payload.sub]);
    if (!rows.length || !rows[0].active) throw new HttpError(401, 'Account not found or disabled');
    req.user = rows[0];
    next();
  } catch (err) { next(err); }
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return next(new HttpError(403, 'You do not have permission for this action'));
  next();
};

// Farmers see only their own farms; agronomists and admins see everything.
export const isStaff = (user) => user.role === 'admin' || user.role === 'agronomist';

export async function loadFarm(user, farmId) {
  const { rows } = await query('SELECT * FROM farms WHERE id=$1', [farmId]);
  if (!rows.length) throw new HttpError(404, 'Farm not found');
  if (!isStaff(user) && rows[0].owner_id !== user.id) throw new HttpError(403, 'Not your farm');
  return rows[0];
}

export async function loadField(user, fieldId) {
  const { rows } = await query(
    'SELECT f.*, fa.owner_id, fa.name AS farm_name FROM fields f JOIN farms fa ON fa.id=f.farm_id WHERE f.id=$1', [fieldId]);
  if (!rows.length) throw new HttpError(404, 'Field not found');
  if (!isStaff(user) && rows[0].owner_id !== user.id) throw new HttpError(403, 'Not your field');
  return rows[0];
}

// SQL fragment restricting fields to those the user may see. Use alias `fa` for farms.
export function scopeClause(user, params) {
  if (isStaff(user)) return 'TRUE';
  params.push(user.id);
  return `fa.owner_id = $${params.length}`;
}
