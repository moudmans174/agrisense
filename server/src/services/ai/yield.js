// Yield prediction: ridge regression trained per crop on historical season records.
import { query } from '../../db/pool.js';
import { CROPS, expectedNdvi, seasonLength } from '../../config/crops.js';
import { fitRidge, predictRidge, crossValidate, contributions, metrics } from './regression.js';
import { simulateDay } from '../weather.js';
import { addDays, clamp, round, mean, HttpError } from '../../utils/helpers.js';

export const YIELD_FEATURES = ['mean_ndvi', 'peak_ndvi', 'cum_rain', 'gdd', 'mean_pest', 'mean_disease'];
const FEATURE_LABELS = {
  mean_ndvi: 'Season mean NDVI', peak_ndvi: 'Peak NDVI', cum_rain: 'Cumulative rainfall',
  gdd: 'Growing degree days', mean_pest: 'Mean pest pressure', mean_disease: 'Mean disease pressure',
};

export async function trainYieldModel(crop, lambda = 1.0) {
  if (!CROPS[crop]) throw new HttpError(400, `Unsupported crop ${crop}`);
  const { rows } = await query('SELECT * FROM season_records WHERE crop=$1', [crop]);
  if (rows.length < 12) throw new HttpError(400, `Need at least 12 season records for ${crop} (have ${rows.length})`);
  const X = rows.map((r) => YIELD_FEATURES.map((f) => Number(r[f])));
  const y = rows.map((r) => Number(r.yield_t_ha));
  const model = fitRidge(X, y, lambda);
  const train = metrics(y, X.map((x) => predictRidge(model, x)));
  const cv = crossValidate(X, y, lambda, 5);
  const { rows: prev } = await query('SELECT COALESCE(MAX(version),0) AS v FROM ml_models WHERE crop=$1 AND name=$2', [crop, 'yield']);
  await query('UPDATE ml_models SET active=false WHERE crop=$1 AND name=$2', [crop, 'yield']);
  const { rows: [saved] } = await query(
    `INSERT INTO ml_models (name, crop, version, algorithm, features, params, metrics, n_samples, active)
     VALUES ('yield',$1,$2,'ridge-regression',$3,$4,$5,$6,true) RETURNING *`,
    [crop, prev[0].v + 1, JSON.stringify(YIELD_FEATURES), JSON.stringify(model), JSON.stringify({ train, cv }), rows.length],
  );
  return saved;
}

export async function getActiveModel(crop) {
  const { rows } = await query(`SELECT * FROM ml_models WHERE crop=$1 AND name='yield' AND active ORDER BY version DESC LIMIT 1`, [crop]);
  return rows[0] || null;
}

// Project in-season features to end of season: remaining NDVI follows the expected curve
// scaled by the field's current vigour ratio; remaining weather from climatology.
export function projectSeasonFeatures(field, rows) {
  const crop = CROPS[field.crop];
  const len = seasonLength(field.crop);
  const grown = rows.filter((r) => r.das >= 0 && r.das <= len);
  const recentRatios = grown.filter((r) => r.ndvi_observed && r.ndvi_expected > 0.25).slice(-3).map((r) => r.ndvi / r.ndvi_expected);
  const ratio = recentRatios.length ? clamp(mean(recentRatios), 0.3, 1.2) : 1;
  const ndvis = grown.map((r) => r.ndvi ?? (r.ndvi_expected !== null ? r.ndvi_expected * ratio : null)).filter((v) => v !== null);
  let cumRain = grown.reduce((s, r) => s + (r.rainfall_mm || 0), 0);
  let gdd = grown.length ? grown[grown.length - 1].gdd_cum : 0;
  const lastDas = grown.length ? grown[grown.length - 1].das : -1;
  const lastDate = grown.length ? grown[grown.length - 1].date : field.planting_date;
  for (let das = lastDas + 1, i = 1; das < len; das++, i++) {
    ndvis.push(expectedNdvi(field.crop, das) * ratio);
    const w = simulateDay(field.centroid_lat, field.centroid_lng, addDays(lastDate, i));
    cumRain += w.rainfall_mm;
    gdd += Math.max(0, (Math.min(w.temp_max, 35) + Math.max(w.temp_min, crop.baseTemp)) / 2 - crop.baseTemp);
  }
  return {
    features: {
      mean_ndvi: round(mean(ndvis) ?? 0, 4),
      peak_ndvi: round(ndvis.length ? Math.max(...ndvis) : 0, 4),
      cum_rain: round(cumRain, 1),
      gdd: round(gdd, 1),
      mean_pest: round(mean(grown.map((r) => r.pest_index)) ?? 0, 2),
      mean_disease: round(mean(grown.map((r) => r.disease_index)) ?? 0, 2),
    },
    progress: round(clamp((lastDas + 1) / len, 0, 1), 3),
    vigourRatio: round(ratio, 3),
  };
}

export async function predictYield(field, rows) {
  const crop = CROPS[field.crop];
  const { features, progress, vigourRatio } = projectSeasonFeatures(field, rows);
  const model = await getActiveModel(field.crop);
  const x = YIELD_FEATURES.map((f) => features[f]);
  if (!model) {
    // heuristic fallback when no trained model exists
    const value = crop.typicalYield * clamp(features.peak_ndvi / crop.peakNdvi, 0.2, 1.3) * (1 - 0.06 * features.mean_pest) * (1 - 0.06 * features.mean_disease);
    return { value: round(value, 2), low: round(value * 0.7, 2), high: round(value * 1.3, 2), method: 'heuristic', features, progress, vigourRatio, contributions: [] };
  }
  const value = clamp(predictRidge(model.params, x), 0, crop.maxYield * 1.2);
  // widen the interval early in the season
  const rmse = model.metrics.cv.rmse * (1 + (1 - progress));
  return {
    value: round(value, 2), low: round(Math.max(0, value - 1.96 * rmse), 2), high: round(value + 1.96 * rmse, 2),
    method: `ridge-regression v${model.version}`, modelId: model.id, cvR2: model.metrics.cv.r2,
    features, progress, vigourRatio,
    contributions: contributions(model.params, x, YIELD_FEATURES).map((c) => ({ ...c, feature: FEATURE_LABELS[c.feature] })),
  };
}
