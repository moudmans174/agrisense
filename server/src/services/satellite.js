// Satellite data service.
// Providers:
//   - 'sentinel-hub' : Sentinel-2 L2A field statistics via the Sentinel Hub Statistical API
//                      (requires SH_CLIENT_ID / SH_CLIENT_SECRET)
//   - 'simulated'    : physically-plausible Sentinel-2-like scenes (5-day revisit, cloud cover,
//                      phenology + water/pest stress) for demos and offline use
//   - CSV import and raw band reflectance → index calculator
import { config } from '../config/env.js';
import { query } from '../db/pool.js';
import { CROPS, expectedNdvi } from '../config/crops.js';
import {
  addDays, daysBetween, dayOfYear, hashSeed, prng, gaussian, clamp, round, mean, HttpError,
} from '../utils/helpers.js';

// ---- Spectral index formulas (Sentinel-2 band reflectances 0..1) ----
export function computeIndices({ B2, B3, B4, B8, B11 }) {
  const n = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
  const blue = n(B2), green = n(B3), red = n(B4), nir = n(B8), swir = n(B11);
  if (red === null || nir === null) throw new HttpError(400, 'B4 (red) and B8 (NIR) reflectances are required');
  for (const v of [blue, green, red, nir, swir]) {
    if (v !== null && (Number.isNaN(v) || v < 0 || v > 1.5)) throw new HttpError(400, 'Reflectances must be numbers between 0 and 1');
  }
  const safe = (num, den) => (Math.abs(den) < 1e-9 ? null : num / den);
  return {
    ndvi: round(safe(nir - red, nir + red), 4),
    savi: round(safe(1.5 * (nir - red), nir + red + 0.5), 4),
    evi: blue === null ? null : round(clamp(safe(2.5 * (nir - red), nir + 6 * red - 7.5 * blue + 1), -1, 1), 4),
    ndwi: swir === null ? null : round(safe(nir - swir, nir + swir), 4),          // Gao (vegetation water)
    gndvi: green === null ? null : round(safe(nir - green, nir + green), 4),
  };
}

export function interpretNdvi(ndvi) {
  if (ndvi === null || ndvi === undefined) return 'unknown';
  if (ndvi < 0.1) return 'bare soil / water';
  if (ndvi < 0.3) return 'sparse vegetation';
  if (ndvi < 0.5) return 'moderate vegetation';
  if (ndvi < 0.7) return 'dense vegetation';
  return 'very dense, vigorous vegetation';
}

// ---- Simulation ----
async function stressContext(fieldId, start, end) {
  const env = await query(
    `SELECT date, rainfall_mm, et0_mm, humidity_pct FROM environmental_data
     WHERE field_id=$1 AND date BETWEEN $2 AND $3 ORDER BY date`, [fieldId, addDays(start, -30), end]);
  const irr = await query(
    `SELECT date, SUM(amount_mm)::float AS amount_mm FROM irrigation_events WHERE field_id=$1 AND date BETWEEN $2 AND $3 GROUP BY date`,
    [fieldId, addDays(start, -30), end]);
  const obs = await query(
    `SELECT observed_at::date AS date, pest_severity, disease_severity FROM observations
     WHERE field_id=$1 AND observed_at::date <= $2 ORDER BY observed_at`, [fieldId, end]);
  const irrBy = new Map(irr.rows.map((r) => [r.date, r.amount_mm]));
  return { env: env.rows.map((r) => ({ ...r, water_in: (r.rainfall_mm || 0) + (irrBy.get(r.date) || 0) })), obs: obs.rows };
}

function waterStressAt(env, date) {
  const win = env.filter((r) => r.date <= date && daysBetween(r.date, date) < 21);
  if (win.length < 5) return 1;
  const rain = win.reduce((s, r) => s + (r.water_in ?? r.rainfall_mm ?? 0), 0);
  const et0 = win.reduce((s, r) => s + (r.et0_mm || 4), 0);
  return clamp(0.55 + 0.45 * (rain / Math.max(et0, 1)), 0.55, 1);
}

function bioticStressAt(obs, date) {
  const past = obs.filter((o) => o.date <= date);
  if (!past.length) return 1;
  const last = past[past.length - 1];
  const age = daysBetween(last.date, date);
  const sev = Math.max(last.pest_severity || 0, last.disease_severity || 0) * Math.exp(-age / 30);
  return clamp(1 - sev * 0.06, 0.6, 1);
}

export async function simulateScenes(field, start, end) {
  const crop = CROPS[field.crop];
  if (!crop) throw new HttpError(400, `Unsupported crop ${field.crop}`);
  const ctx = await stressContext(field.id, start, end);
  // Sentinel-2A/B combined revisit ≈ 5 days; align to a fixed epoch so scenes are consistent.
  const epochOffset = ((daysBetween('2020-01-01', start) % 5) + 5) % 5;
  let d = addDays(start, epochOffset === 0 ? 0 : 5 - epochOffset);
  const scenes = [];
  while (d <= end) {
    const rand = prng(hashSeed('s2', field.id, d));
    const das = daysBetween(field.planting_date, d);
    const doy = dayOfYear(d);
    const wet = Math.exp(-(((doy - 222) / 70) ** 2) / 2);
    const cloud = round(clamp(100 * (0.15 + 0.6 * wet) + gaussian(rand) * 22, 0, 100), 1);
    if (cloud <= 70) { // scenes above 70% cloud are discarded by the L2A pipeline
      const base = das < 0 ? 0.16 : expectedNdvi(field.crop, das);
      const ws = das < 0 ? 1 : waterStressAt(ctx.env, d);
      const bs = das < 0 ? 1 : bioticStressAt(ctx.obs, d);
      const cloudBias = -0.0008 * cloud;          // residual haze lowers NDVI slightly
      const ndvi = clamp(0.16 + (base - 0.16) * ws * bs + cloudBias + gaussian(rand) * 0.02, -0.1, 0.95);
      const ndwi = clamp(-0.25 + 0.75 * (ndvi - 0.15) * ws + gaussian(rand) * 0.02, -0.5, 0.7);
      const evi = clamp(ndvi * 0.72 + gaussian(rand) * 0.015, -0.2, 0.9);
      const savi = clamp(ndvi * 0.8 + gaussian(rand) * 0.01, -0.2, 0.9);
      const lst = round(28 + 8 * (1 - ndvi) + (1 - ws) * 6 + gaussian(rand) * 0.8, 2);
      scenes.push({ acquired_on: d, source: 'simulated-s2', ndvi: round(ndvi, 4), ndwi: round(ndwi, 4), evi: round(evi, 4), savi: round(savi, 4), lst_c: lst, cloud_cover: cloud });
    }
    d = addDays(d, 5);
  }
  return scenes;
}

// ---- Sentinel Hub Statistical API ----
const EVALSCRIPT = `//VERSION=3
function setup() {
  return { input: [{ bands: ["B02","B04","B08","B11","SCL","dataMask"] }],
           output: [{ id: "indices", bands: 3, sampleType: "FLOAT32" }, { id: "dataMask", bands: 1 }] };
}
function evaluatePixel(s) {
  const cloud = [3,8,9,10].includes(s.SCL);
  const ndvi = (s.B08 - s.B04) / (s.B08 + s.B04);
  const ndwi = (s.B08 - s.B11) / (s.B08 + s.B11);
  const evi = 2.5 * (s.B08 - s.B04) / (s.B08 + 6 * s.B04 - 7.5 * s.B02 + 1);
  return { indices: [ndvi, ndwi, evi], dataMask: [s.dataMask && !cloud ? 1 : 0] };
}`;

let shToken = null;
async function sentinelHubToken() {
  if (shToken && shToken.exp > Date.now() + 60000) return shToken.value;
  const body = new URLSearchParams({
    grant_type: 'client_credentials', client_id: config.sentinelHub.clientId, client_secret: config.sentinelHub.clientSecret,
  });
  const res = await fetch('https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new HttpError(502, `Sentinel Hub auth failed (${res.status})`);
  const json = await res.json();
  shToken = { value: json.access_token, exp: Date.now() + json.expires_in * 1000 };
  return shToken.value;
}

export const sentinelHubEnabled = () => Boolean(config.sentinelHub.clientId && config.sentinelHub.clientSecret);

export async function fetchSentinelHub(field, start, end) {
  if (!sentinelHubEnabled()) throw new HttpError(400, 'Sentinel Hub credentials are not configured (SH_CLIENT_ID / SH_CLIENT_SECRET)');
  if (!field.boundary) throw new HttpError(400, 'Field boundary polygon is required for satellite statistics');
  const token = await sentinelHubToken();
  const payload = {
    input: {
      bounds: { geometry: field.boundary, properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' } },
      data: [{ type: 'sentinel-2-l2a', dataFilter: { maxCloudCoverage: 80 } }],
    },
    aggregation: {
      timeRange: { from: `${start}T00:00:00Z`, to: `${end}T23:59:59Z` },
      aggregationInterval: { of: 'P1D' },
      evalscript: EVALSCRIPT,
      resx: 10, resy: 10,
    },
  };
  const res = await fetch('https://services.sentinel-hub.com/api/v1/statistics', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new HttpError(502, `Sentinel Hub statistics failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return (json.data || []).map((item) => {
    const b = item.outputs?.indices?.bands;
    if (!b) return null;
    const st = b.B0.stats;
    if (!st || st.sampleCount === 0 || st.sampleCount === st.noDataCount) return null;
    return {
      acquired_on: item.interval.from.slice(0, 10),
      source: 'sentinel-2',
      ndvi: round(b.B0.stats.mean, 4),
      ndwi: round(b.B1.stats.mean, 4),
      evi: round(clamp(b.B2.stats.mean, -1, 1), 4),
      savi: null,
      lst_c: null,
      cloud_cover: round((st.noDataCount / st.sampleCount) * 100, 1),
    };
  }).filter((r) => r && r.ndvi !== null && !Number.isNaN(r.ndvi));
}

export async function upsertScenes(fieldId, scenes) {
  let n = 0;
  for (const s of scenes) {
    await query(
      `INSERT INTO satellite_observations (field_id, acquired_on, source, ndvi, ndwi, evi, savi, lst_c, cloud_cover)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (field_id, acquired_on, source) DO UPDATE SET ndvi=EXCLUDED.ndvi, ndwi=EXCLUDED.ndwi,
         evi=EXCLUDED.evi, savi=EXCLUDED.savi, lst_c=EXCLUDED.lst_c, cloud_cover=EXCLUDED.cloud_cover`,
      [fieldId, s.acquired_on, s.source, s.ndvi, s.ndwi, s.evi, s.savi ?? null, s.lst_c ?? null, s.cloud_cover ?? null],
    );
    n++;
  }
  return n;
}

export function summarizeScenes(scenes) {
  const ndvis = scenes.map((s) => s.ndvi).filter((v) => v !== null);
  return {
    count: scenes.length,
    meanNdvi: round(mean(ndvis), 3),
    maxNdvi: ndvis.length ? round(Math.max(...ndvis), 3) : null,
    latest: scenes[scenes.length - 1] || null,
  };
}
