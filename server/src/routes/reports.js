import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate, loadFarm, scopeClause } from '../middleware/auth.js';
import { stageOf } from '../config/crops.js';
import { asyncHandler, daysBetween, today, toCsv, addDays } from '../utils/helpers.js';

const r = Router();
r.use(authenticate);

// Dashboard overview
r.get('/overview', asyncHandler(async (req, res) => {
  const params = [];
  const scope = scopeClause(req.user, params);
  const base = `FROM fields f JOIN farms fa ON fa.id=f.farm_id WHERE ${scope}`;
  const [totals, byCrop, health, alerts, obs7, recentObs, healthTrend, rain] = await Promise.all([
    query(`SELECT COUNT(DISTINCT fa.id)::int AS farms, COUNT(f.id)::int AS fields, COALESCE(SUM(f.area_ha),0)::float AS area_ha ${base}`, params),
    query(`SELECT f.crop, COUNT(*)::int AS fields, COALESCE(SUM(f.area_ha),0)::float AS area_ha ${base} GROUP BY f.crop ORDER BY area_ha DESC`, params),
    query(`SELECT d.health_class, COUNT(*)::int AS n, ROUND(AVG(d.health_score)::numeric,1)::float AS avg ${base.replace('WHERE', `JOIN LATERAL (SELECT * FROM decisions WHERE field_id=f.id ORDER BY generated_at DESC LIMIT 1) d ON TRUE WHERE`)} GROUP BY d.health_class`, params),
    query(`SELECT a.severity, COUNT(*)::int AS n FROM alerts a JOIN fields f ON f.id=a.field_id JOIN farms fa ON fa.id=f.farm_id WHERE ${scope} AND a.status='open' GROUP BY a.severity`, params),
    query(`SELECT COUNT(*)::int AS n FROM observations o JOIN fields f ON f.id=o.field_id JOIN farms fa ON fa.id=f.farm_id WHERE ${scope} AND o.observed_at > NOW() - INTERVAL '7 days'`, params),
    query(`SELECT o.id, o.observed_at, o.pest_type, o.pest_severity, o.disease_type, o.disease_severity, o.notes, f.name AS field_name
           FROM observations o JOIN fields f ON f.id=o.field_id JOIN farms fa ON fa.id=f.farm_id WHERE ${scope} ORDER BY o.observed_at DESC LIMIT 5`, params),
    query(`SELECT d.generated_at::date AS date, ROUND(AVG(d.health_score)::numeric,1)::float AS avg_health
           FROM decisions d JOIN fields f ON f.id=d.field_id JOIN farms fa ON fa.id=f.farm_id
           WHERE ${scope} AND d.generated_at > NOW() - INTERVAL '60 days' GROUP BY 1 ORDER BY 1`, params),
    query(`SELECT e.date, ROUND(AVG(e.rainfall_mm)::numeric,1)::float AS rain, ROUND(AVG(e.temp_mean)::numeric,1)::float AS temp
           FROM environmental_data e JOIN fields f ON f.id=e.field_id JOIN farms fa ON fa.id=f.farm_id
           WHERE ${scope} AND e.date BETWEEN $${params.length + 1} AND $${params.length + 2} GROUP BY e.date ORDER BY e.date`, [...params, addDays(today(), -30), today()]),
  ]);
  res.json({
    totals: { ...totals.rows[0], observations_7d: obs7.rows[0].n },
    byCrop: byCrop.rows, health: health.rows, openAlerts: alerts.rows,
    recentObservations: recentObs.rows, healthTrend: healthTrend.rows, weather30d: rain.rows,
  });
}));

// Farm season report
r.get('/farm/:farmId', asyncHandler(async (req, res) => {
  const farm = await loadFarm(req.user, req.params.farmId);
  const { rows: fields } = await query(`
    SELECT f.id, f.name, f.crop, f.variety, f.area_ha, f.planting_date, f.expected_harvest, f.irrigation_type,
      d.health_score, d.health_class, d.predicted_yield, d.yield_low, d.yield_high, d.pest_risk, d.disease_risk, d.irrigation_mm, d.generated_at,
      (SELECT COUNT(*) FROM observations o WHERE o.field_id=f.id)::int AS observations,
      (SELECT COUNT(*) FROM satellite_observations s WHERE s.field_id=f.id)::int AS scenes,
      (SELECT ROUND(SUM(rainfall_mm)::numeric,1)::float FROM environmental_data e WHERE e.field_id=f.id AND e.date >= f.planting_date) AS season_rain,
      (SELECT COALESCE(SUM(amount_mm),0)::float FROM irrigation_events i WHERE i.field_id=f.id AND i.date >= f.planting_date) AS season_irrigation,
      (SELECT COUNT(*) FROM alerts a WHERE a.field_id=f.id AND a.status<>'resolved')::int AS active_alerts
    FROM fields f
    LEFT JOIN LATERAL (SELECT * FROM decisions WHERE field_id=f.id ORDER BY generated_at DESC LIMIT 1) d ON TRUE
    WHERE f.farm_id=$1 ORDER BY f.name`, [farm.id]);
  const t = today();
  const enriched = fields.map((f) => ({
    ...f,
    days_after_planting: daysBetween(f.planting_date, t),
    stage: stageOf(f.crop, daysBetween(f.planting_date, t)),
    expected_production_t: f.predicted_yield && f.area_ha ? Math.round(f.predicted_yield * f.area_ha * 100) / 100 : null,
  }));
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="agrisense-farm-${farm.id}-report.csv"`);
    return res.send(toCsv(enriched));
  }
  res.json({
    farm, generated_at: new Date().toISOString(), fields: enriched,
    totals: {
      area_ha: enriched.reduce((s, f) => s + (f.area_ha || 0), 0),
      expected_production_t: Math.round(enriched.reduce((s, f) => s + (f.expected_production_t || 0), 0) * 100) / 100,
      active_alerts: enriched.reduce((s, f) => s + f.active_alerts, 0),
    },
  });
}));

export default r;
