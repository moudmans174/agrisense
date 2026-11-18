import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticate, loadFarm, loadField, scopeClause } from '../middleware/auth.js';
import { CROP_KEYS, CROPS, SOIL_TYPES, seasonLength, stageOf } from '../config/crops.js';
import { asyncHandler, polygonAreaHa, polygonCentroid, isValidPolygon, addDays, daysBetween, today, round } from '../utils/helpers.js';

const r = Router();
r.use(authenticate);

const fieldSchema = z.object({
  farm_id: z.coerce.number().int(),
  name: z.string().trim().min(1).max(160),
  crop: z.enum(CROP_KEYS),
  variety: z.string().max(120).optional().nullable(),
  planting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expected_harvest: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal('')),
  area_ha: z.coerce.number().positive().optional().nullable(),
  boundary: z.any().optional().nullable(),
  centroid_lat: z.coerce.number().min(-90).max(90).optional().nullable(),
  centroid_lng: z.coerce.number().min(-180).max(180).optional().nullable(),
  soil_type: z.enum(Object.keys(SOIL_TYPES)).default('loam'),
  irrigation_type: z.enum(['rainfed', 'drip', 'sprinkler', 'surface', 'flood']).default('rainfed'),
  field_capacity: z.coerce.number().min(0.05).max(0.6).optional().nullable(),
  wilting_point: z.coerce.number().min(0.01).max(0.4).optional().nullable(),
}).superRefine((d, ctx) => {
  if (d.boundary && !isValidPolygon(d.boundary)) ctx.addIssue({ code: 'custom', path: ['boundary'], message: 'Boundary must be a closed GeoJSON Polygon' });
  if (!d.boundary && (d.centroid_lat === null || d.centroid_lat === undefined || d.centroid_lng === null || d.centroid_lng === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['boundary'], message: 'Draw a boundary or provide a latitude/longitude' });
  }
});

function derive(d) {
  const soil = SOIL_TYPES[d.soil_type];
  const fc = d.field_capacity ?? soil.fc;
  const wp = d.wilting_point ?? soil.wp;
  let area = d.area_ha ?? null, lat = d.centroid_lat ?? null, lng = d.centroid_lng ?? null;
  if (d.boundary) {
    area = round(polygonAreaHa(d.boundary), 3);
    const c = polygonCentroid(d.boundary);
    lat = c.lat; lng = c.lng;
  }
  const harvest = d.expected_harvest || addDays(d.planting_date, seasonLength(d.crop));
  return { fc, wp: Math.min(wp, fc - 0.02), area, lat, lng, harvest };
}

r.get('/', asyncHandler(async (req, res) => {
  const params = [];
  const where = [scopeClause(req.user, params)];
  if (req.query.farm_id) { params.push(req.query.farm_id); where.push(`f.farm_id=$${params.length}`); }
  if (req.query.crop) { params.push(req.query.crop); where.push(`f.crop=$${params.length}`); }
  const { rows } = await query(`
    SELECT f.*, fa.name AS farm_name, fa.owner_id,
      d.health_score, d.health_class, d.irrigation_mm, d.pest_risk, d.disease_risk, d.predicted_yield, d.generated_at AS last_decision_at,
      (SELECT COUNT(*) FROM alerts a WHERE a.field_id=f.id AND a.status='open')::int AS open_alerts
    FROM fields f JOIN farms fa ON fa.id=f.farm_id
    LEFT JOIN LATERAL (SELECT * FROM decisions WHERE field_id=f.id ORDER BY generated_at DESC LIMIT 1) d ON TRUE
    WHERE ${where.join(' AND ')} ORDER BY fa.name, f.name`, params);
  const t = today();
  res.json(rows.map((f) => ({ ...f, days_after_planting: daysBetween(f.planting_date, t), stage: stageOf(f.crop, daysBetween(f.planting_date, t)) })));
}));

r.get('/:id', asyncHandler(async (req, res) => {
  const field = await loadField(req.user, req.params.id);
  const [obs, sat, env, dec] = await Promise.all([
    query('SELECT COUNT(*)::int AS n, MAX(observed_at) AS last FROM observations WHERE field_id=$1', [field.id]),
    query('SELECT COUNT(*)::int AS n, MAX(acquired_on) AS last FROM satellite_observations WHERE field_id=$1', [field.id]),
    query('SELECT COUNT(*)::int AS n, MAX(date) AS last FROM environmental_data WHERE field_id=$1', [field.id]),
    query('SELECT * FROM decisions WHERE field_id=$1 ORDER BY generated_at DESC LIMIT 1', [field.id]),
  ]);
  const das = daysBetween(field.planting_date, today());
  res.json({
    ...field,
    crop_info: CROPS[field.crop],
    days_after_planting: das,
    stage: stageOf(field.crop, das),
    season_length: seasonLength(field.crop),
    data_summary: { observations: obs.rows[0], satellite: sat.rows[0], environment: env.rows[0] },
    latest_decision: dec.rows[0] || null,
  });
}));

r.post('/', asyncHandler(async (req, res) => {
  const d = fieldSchema.parse(req.body);
  await loadFarm(req.user, d.farm_id);
  const x = derive(d);
  const { rows: [field] } = await query(
    `INSERT INTO fields (farm_id,name,crop,variety,planting_date,expected_harvest,area_ha,boundary,centroid_lat,centroid_lng,
       soil_type,irrigation_type,field_capacity,wilting_point)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [d.farm_id, d.name, d.crop, d.variety || null, d.planting_date, x.harvest, x.area, d.boundary ? JSON.stringify(d.boundary) : null,
      x.lat, x.lng, d.soil_type, d.irrigation_type, x.fc, x.wp]);
  res.status(201).json(field);
}));

r.put('/:id', asyncHandler(async (req, res) => {
  const existing = await loadField(req.user, req.params.id);
  const d = fieldSchema.parse({ ...req.body, farm_id: req.body.farm_id ?? existing.farm_id });
  await loadFarm(req.user, d.farm_id);
  const x = derive(d);
  const { rows: [field] } = await query(
    `UPDATE fields SET farm_id=$1,name=$2,crop=$3,variety=$4,planting_date=$5,expected_harvest=$6,area_ha=$7,boundary=$8,
       centroid_lat=$9,centroid_lng=$10,soil_type=$11,irrigation_type=$12,field_capacity=$13,wilting_point=$14 WHERE id=$15 RETURNING *`,
    [d.farm_id, d.name, d.crop, d.variety || null, d.planting_date, x.harvest, x.area, d.boundary ? JSON.stringify(d.boundary) : null,
      x.lat, x.lng, d.soil_type, d.irrigation_type, x.fc, x.wp, existing.id]);
  res.json(field);
}));

r.delete('/:id', asyncHandler(async (req, res) => {
  const field = await loadField(req.user, req.params.id);
  await query('DELETE FROM fields WHERE id=$1', [field.id]);
  res.status(204).end();
}));

export default r;
