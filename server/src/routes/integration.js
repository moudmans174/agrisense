import { Router } from 'express';
import { authenticate, loadField } from '../middleware/auth.js';
import { buildFieldTimeseries, seasonFeatures } from '../services/fusion.js';
import { asyncHandler, toCsv, today } from '../utils/helpers.js';

const r = Router();
r.use(authenticate);

// Unified daily dataset joining satellite, weather, soil-water model and field observations
r.get('/field/:fieldId/timeseries', asyncHandler(async (req, res) => {
  const field = await loadField(req.user, req.params.fieldId);
  const { rows, meta } = await buildFieldTimeseries(field, req.query.from || field.planting_date, req.query.to || today());
  res.json({ field: { id: field.id, name: field.name, crop: field.crop, planting_date: field.planting_date }, meta, features: seasonFeatures(rows), rows });
}));

r.get('/field/:fieldId/export.csv', asyncHandler(async (req, res) => {
  const field = await loadField(req.user, req.params.fieldId);
  const { rows } = await buildFieldTimeseries(field, req.query.from || field.planting_date, req.query.to || today());
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="agrisense-field-${field.id}-integrated.csv"`);
  res.send(toCsv(rows));
}));

export default r;
