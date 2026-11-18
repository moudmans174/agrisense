// AI decision engine: orchestrates data refresh → fusion → models → recommendations → alerts.
import { query } from '../../db/pool.js';
import { CROPS, seasonLength } from '../../config/crops.js';
import { buildFieldTimeseries } from '../fusion.js';
import { syncFieldWeather, getForecast } from '../weather.js';
import { simulateScenes, fetchSentinelHub, upsertScenes, sentinelHubEnabled } from '../satellite.js';
import { cropHealth, ndviAnomaly, irrigationAdvice, pestDiseaseRisk, synthesize } from './models.js';
import { predictYield } from './yield.js';
import { addDays, daysBetween, today, round } from '../../utils/helpers.js';

export async function ensureFieldData(field) {
  const t = today();
  const start = addDays(field.planting_date, -30);
  const report = { weather: null, satellite: null };
  const { rows: [w] } = await query('SELECT MAX(date) AS last, MIN(date) AS first FROM environmental_data WHERE field_id=$1', [field.id]);
  if (!w.last || w.first > start) {
    report.weather = await syncFieldWeather(field, start, t);
  } else if (w.last < t) {
    // re-pull the last week too: recent values may have been provisional
    report.weather = await syncFieldWeather(field, addDays(w.last, -6), t);
  }
  const { rows: [s] } = await query('SELECT MAX(acquired_on) AS last FROM satellite_observations WHERE field_id=$1', [field.id]);
  const mode = process.env.SATELLITE_AUTO || (sentinelHubEnabled() ? 'sentinel-hub' : 'simulated');
  if (mode !== 'off' && (!s.last || daysBetween(s.last, t) > 5)) {
    const from = s.last ? addDays(s.last, 1) : start;
    try {
      const scenes = mode === 'sentinel-hub' ? await fetchSentinelHub(field, from, t) : await simulateScenes(field, from, t);
      report.satellite = { inserted: await upsertScenes(field.id, scenes), source: mode };
    } catch (err) {
      report.satellite = { error: err.message };
    }
  }
  return report;
}

export async function runDecision(field, { refresh = true, createAlerts = true } = {}) {
  if (!CROPS[field.crop]) throw new Error(`Unsupported crop ${field.crop}`);
  const dataRefresh = refresh ? await ensureFieldData(field) : null;
  const t = today();
  const end = t;
  const start = addDays(field.planting_date, -10) < addDays(t, -400) ? addDays(t, -400) : addDays(field.planting_date, -10);
  const { rows, meta } = await buildFieldTimeseries(field, start, end);
  const latest = rows[rows.length - 1];
  const forecast = await getForecast(field.centroid_lat, field.centroid_lng, 7);

  const health = cropHealth(rows, field);
  const anomaly = ndviAnomaly(rows);
  const irrigation = irrigationAdvice(rows, field, forecast);
  const risk = pestDiseaseRisk(rows, field, forecast);
  const yieldPred = latest.das >= 0 ? await predictYield(field, rows) : null;

  const { rows: [lastObs] } = await query('SELECT MAX(observed_at)::date AS d FROM observations WHERE field_id=$1', [field.id]);
  const lastScene = [...rows].reverse().find((r) => r.ndvi_observed);
  const observationAgeDays = lastObs?.d ? daysBetween(lastObs.d, t) : null;
  const sceneAgeDays = lastScene ? daysBetween(lastScene.date, t) : null;

  const recommendations = synthesize({ field, health, anomaly, irrigation, risk, yieldPred, latest, observationAgeDays, sceneAgeDays });

  const explanation = {
    health, anomaly,
    irrigation: { ...irrigation },
    risk,
    yield: yieldPred,
    dataQuality: { ...meta, observationAgeDays, sceneAgeDays, refresh: dataRefresh },
    forecast: forecast.map((f) => ({ date: f.date, temp_max: f.temp_max, temp_min: f.temp_min, rainfall_mm: f.rainfall_mm, et0_mm: f.et0_mm, humidity_pct: f.humidity_pct, source: f.source })),
    seasonProgress: round(Math.min(1, Math.max(0, latest.das / seasonLength(field.crop))), 3),
  };

  const { rows: [decision] } = await query(
    `INSERT INTO decisions (field_id, crop_stage, days_after_planting, health_score, health_class, water_deficit_mm, irrigation_mm,
       pest_risk, disease_risk, predicted_yield, yield_low, yield_high, anomaly, recommendations, explanation)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [field.id, latest.stage, latest.das, health.score, health.class, irrigation.deficit_mm, irrigation.gross_mm,
      risk.pest.risk, risk.disease.risk, yieldPred?.value ?? null, yieldPred?.low ?? null, yieldPred?.high ?? null,
      anomaly.anomaly, JSON.stringify(recommendations), JSON.stringify(explanation)],
  );

  const alerts = createAlerts ? await raiseAlerts(field, decision, recommendations) : [];
  return { decision, alerts };
}

const SEVERITY_BY_PRIORITY = { 1: 'high', 2: 'medium', 3: 'low' };

async function raiseAlerts(field, decision, recommendations) {
  const created = [];
  for (const r of recommendations.filter((x) => x.priority <= 2)) {
    let severity = SEVERITY_BY_PRIORITY[r.priority];
    if (r.category === 'health' && /critical/i.test(r.title)) severity = 'critical';
    // de-duplicate: refresh an open alert of the same category from the last 3 days instead of creating a new one
    const { rows: existing } = await query(
      `SELECT id FROM alerts WHERE field_id=$1 AND type=$2 AND status<>'resolved' AND created_at > NOW() - INTERVAL '3 days' ORDER BY created_at DESC LIMIT 1`,
      [field.id, r.category]);
    if (existing.length) {
      await query('UPDATE alerts SET title=$1, message=$2, severity=$3, decision_id=$4, updated_at=NOW() WHERE id=$5',
        [`${field.name}: ${r.title}`, r.action, severity, decision.id, existing[0].id]);
      continue;
    }
    const { rows: [a] } = await query(
      `INSERT INTO alerts (field_id, decision_id, type, severity, title, message) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [field.id, decision.id, r.category, severity, `${field.name}: ${r.title}`, r.action]);
    created.push(a);
  }
  return created;
}
