// Data fusion: aligns the three data streams onto a single daily time series per field.
//   • satellite indices → cloud-filtered, linearly interpolated between acquisitions
//   • weather           → daily, drives an FAO-56 soil-water balance and growing degree days
//   • field observations→ ground truth; soil-moisture readings re-initialise the water balance,
//                          pest/disease scores are carried forward with exponential decay
import { query } from '../db/pool.js';
import { CROPS, kcAt, stageOf, expectedNdvi } from '../config/crops.js';
import { addDays, dateRange, daysBetween, clamp, round, mean, today, HttpError } from '../utils/helpers.js';

const CLOUD_LIMIT = 60; // ignore scenes with more cloud than this

export async function loadFieldData(fieldId, start, end) {
  const [env, sat, obs, irr] = await Promise.all([
    query(`SELECT * FROM environmental_data WHERE field_id=$1 AND date BETWEEN $2 AND $3 ORDER BY date`, [fieldId, start, end]),
    query(`SELECT * FROM satellite_observations WHERE field_id=$1 AND acquired_on BETWEEN $2 AND $3 ORDER BY acquired_on`, [fieldId, addDays(start, -20), addDays(end, 20)]),
    query(`SELECT *, observed_at::date AS obs_date FROM observations WHERE field_id=$1 AND observed_at::date <= $2 ORDER BY observed_at`, [fieldId, end]),
    query(`SELECT date, SUM(amount_mm)::float AS amount_mm FROM irrigation_events WHERE field_id=$1 AND date BETWEEN $2 AND $3 GROUP BY date`, [fieldId, start, end]),
  ]);
  return { env: env.rows, sat: sat.rows, obs: obs.rows, irr: irr.rows };
}

function interpolator(points) {
  // points: [{date, value}] sorted; returns fn(date) -> {value, observed}
  return (date) => {
    if (!points.length) return { value: null, observed: false };
    let lo = null, hi = null;
    for (const p of points) {
      if (p.date === date) return { value: p.value, observed: true };
      if (p.date < date) lo = p; else { hi = p; break; }
    }
    if (lo && hi) {
      const t = daysBetween(lo.date, date) / daysBetween(lo.date, hi.date);
      return { value: lo.value + t * (hi.value - lo.value), observed: false };
    }
    const nearest = lo || hi;
    return daysBetween(nearest.date, date) <= 10 ? { value: nearest.value, observed: false } : { value: null, observed: false };
  };
}

export function effectiveRain(p) {
  if (!p || p <= 0) return 0;
  return p <= 5 ? p * 0.5 : p * 0.8; // simple runoff/interception loss
}

/**
 * Build the fused daily series.
 * @returns {{rows: object[], meta: object}}
 */
export function fuse(field, data, start, end) {
  const crop = CROPS[field.crop];
  if (!crop) throw new HttpError(400, `Unsupported crop ${field.crop}`);
  const fc = Number(field.field_capacity), wp = Number(field.wilting_point);
  const zr = crop.rootDepth;
  const TAW = 1000 * (fc - wp) * zr;           // total available water (mm)
  const p = crop.depletionFraction;
  const RAW = p * TAW;                          // readily available water (mm)

  const envByDate = new Map(data.env.map((r) => [r.date, r]));
  const irrByDate = new Map(data.irr.map((r) => [r.date, r.amount_mm]));
  const clean = data.sat.filter((s) => s.ndvi !== null && (s.cloud_cover === null || s.cloud_cover <= CLOUD_LIMIT));
  const ndviI = interpolator(clean.map((s) => ({ date: s.acquired_on, value: s.ndvi })));
  const ndwiI = interpolator(clean.filter((s) => s.ndwi !== null).map((s) => ({ date: s.acquired_on, value: s.ndwi })));
  const eviI = interpolator(clean.filter((s) => s.evi !== null).map((s) => ({ date: s.acquired_on, value: s.evi })));
  const smByDate = new Map();
  for (const o of data.obs) if (o.soil_moisture_pct !== null) smByDate.set(o.obs_date, o.soil_moisture_pct / 100);

  let dr = RAW * 0.5;   // initial depletion assumption
  let gdd = 0;
  let pestState = 0, diseaseState = 0, obsIdx = 0;
  const rows = [];
  for (const date of dateRange(start, end)) {
    const e = envByDate.get(date);
    const das = daysBetween(field.planting_date, date);
    const kc = das >= 0 ? kcAt(field.crop, das) : 0.3;
    // carry observations forward with 21-day e-folding decay
    pestState *= Math.exp(-1 / 21); diseaseState *= Math.exp(-1 / 21);
    while (obsIdx < data.obs.length && data.obs[obsIdx].obs_date <= date) {
      const o = data.obs[obsIdx++];
      pestState = Math.max(pestState, o.pest_severity || 0);
      diseaseState = Math.max(diseaseState, o.disease_severity || 0);
    }
    let et0 = null, etc = null, ks = null, rain = null;
    if (e) {
      et0 = e.et0_mm ?? 4; rain = e.rainfall_mm ?? 0;
      const irrigation = irrByDate.get(date) || 0;
      if (smByDate.has(date)) {
        // ground-truth reset: depletion from measured volumetric moisture
        dr = clamp(1000 * (fc - smByDate.get(date)) * zr, 0, TAW);
      }
      ks = dr > RAW ? clamp((TAW - dr) / ((1 - p) * TAW), 0, 1) : 1;
      etc = ks * kc * et0;
      dr = clamp(dr - effectiveRain(rain) - irrigation + etc, 0, TAW);
      if (e.temp_max !== null && e.temp_min !== null && das >= 0) {
        gdd += Math.max(0, (Math.min(e.temp_max, 35) + Math.max(e.temp_min, crop.baseTemp)) / 2 - crop.baseTemp);
      }
    }
    const ndvi = ndviI(date), ndwi = ndwiI(date), evi = eviI(date);
    rows.push({
      date, das, stage: stageOf(field.crop, das), kc: round(kc, 3),
      ndvi: round(ndvi.value, 4), ndvi_observed: ndvi.observed, ndvi_expected: das >= 0 ? round(expectedNdvi(field.crop, das), 4) : null,
      ndwi: round(ndwi.value, 4), evi: round(evi.value, 4),
      temp_max: e?.temp_max ?? null, temp_min: e?.temp_min ?? null, temp_mean: e?.temp_mean ?? null,
      rainfall_mm: rain, humidity_pct: e?.humidity_pct ?? null, et0_mm: et0, etc_mm: round(etc, 2),
      irrigation_mm: irrByDate.get(date) || 0,
      depletion_mm: e ? round(dr, 1) : null, taw_mm: round(TAW, 1), raw_mm: round(RAW, 1), ks: round(ks, 3),
      soil_moisture: e ? round(fc - dr / (1000 * zr), 3) : null,
      soil_moisture_observed: smByDate.has(date) ? smByDate.get(date) : null,
      gdd_cum: round(gdd, 1),
      pest_index: round(pestState, 2), disease_index: round(diseaseState, 2),
    });
  }
  return {
    rows,
    meta: {
      TAW: round(TAW, 1), RAW: round(RAW, 1), rootDepth: zr, fc, wp,
      sceneCount: clean.length, observationCount: data.obs.length, weatherDays: data.env.length,
      coverage: {
        weather: round(rows.filter((r) => r.et0_mm !== null).length / rows.length, 3),
        satellite: round(rows.filter((r) => r.ndvi !== null).length / rows.length, 3),
      },
    },
  };
}

export async function buildFieldTimeseries(field, start, end) {
  const s = start || field.planting_date;
  const e = end || today();
  if (daysBetween(s, e) > 400) throw new HttpError(400, 'Date range too long (max 400 days)');
  const data = await loadFieldData(field.id, s, e);
  return fuse(field, data, s, e);
}

export function seasonFeatures(rows) {
  const grown = rows.filter((r) => r.das >= 0);
  const nd = grown.map((r) => r.ndvi).filter((v) => v !== null);
  return {
    mean_ndvi: round(mean(nd) ?? 0, 4),
    peak_ndvi: round(nd.length ? Math.max(...nd) : 0, 4),
    cum_rain: round(grown.reduce((s, r) => s + (r.rainfall_mm || 0), 0), 1),
    gdd: grown.length ? grown[grown.length - 1].gdd_cum : 0,
    mean_pest: round(mean(grown.map((r) => r.pest_index)) ?? 0, 2),
    mean_disease: round(mean(grown.map((r) => r.disease_index)) ?? 0, 2),
  };
}
