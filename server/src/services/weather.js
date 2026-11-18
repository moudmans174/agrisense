// Environmental data service.
// Live source: Open-Meteo (free, no API key) archive + forecast APIs.
// Fallback: a deterministic tropical climate generator (West-Africa monsoon seasonality),
// so the platform keeps working offline. Every row records its `source`.
import { config } from '../config/env.js';
import { query } from '../db/pool.js';
import {
  addDays, dateRange, dayOfYear, hashSeed, prng, gaussian, round, clamp, today, daysBetween,
} from '../utils/helpers.js';

const DAILY_VARS = [
  'temperature_2m_max', 'temperature_2m_min', 'temperature_2m_mean', 'precipitation_sum',
  'relative_humidity_2m_mean', 'wind_speed_10m_max', 'shortwave_radiation_sum', 'et0_fao_evapotranspiration',
];

// Extraterrestrial radiation Ra (MJ m-2 day-1), FAO-56 eq. 21
export function extraterrestrialRadiation(latDeg, doy) {
  const phi = (latDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39);
  const ws = Math.acos(clamp(-Math.tan(phi) * Math.tan(delta), -1, 1));
  return ((24 * 60) / Math.PI) * 0.082 * dr *
    (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));
}

// Hargreaves-Samani reference evapotranspiration (mm/day), FAO-56 eq. 52
export function hargreavesEt0(tmax, tmin, latDeg, doy) {
  const tmean = (tmax + tmin) / 2;
  const ra = extraterrestrialRadiation(latDeg, doy);
  return Math.max(0, 0.0023 * (tmean + 17.8) * Math.sqrt(Math.max(tmax - tmin, 0)) * ra * 0.408);
}

// Rainy-season intensity for latitude (West African monsoon: peaks Jul–Sep near 8°N;
// southern hemisphere shifted by 6 months). Returns 0..1.
function wetness(lat, doy) {
  const peakDoy = lat >= 0 ? 222 : 40;
  const width = lat >= 0 ? 70 : 80;
  let d = Math.abs(doy - peakDoy);
  d = Math.min(d, 365 - d);
  return Math.exp(-(d * d) / (2 * width * width));
}

export function simulateDay(lat, lng, date) {
  const rand = prng(hashSeed('wx', round(lat, 2), round(lng, 2), date));
  const doy = dayOfYear(date);
  const w = wetness(lat, doy);
  const rainProb = 0.08 + 0.75 * w;
  const rains = rand() < rainProb;
  const rainfall = rains ? round(-Math.log(Math.max(rand(), 1e-6)) * (4 + 18 * w), 1) : 0;
  const tmax = round(33.5 - 4.5 * w - (rains ? 1.5 : 0) + gaussian(rand) * 1.2, 1);
  const tmin = round(22 + 1.2 * w + gaussian(rand) * 0.8, 1);
  const humidity = round(clamp(58 + 32 * w + (rains ? 6 : 0) + gaussian(rand) * 4, 30, 100), 1);
  const ra = extraterrestrialRadiation(lat, doy);
  const solar = round(ra * (0.65 - 0.25 * w - (rains ? 0.1 : 0)), 2);
  return {
    date,
    source: 'simulated',
    temp_max: tmax,
    temp_min: tmin,
    temp_mean: round((tmax + tmin) / 2, 1),
    rainfall_mm: rainfall,
    humidity_pct: humidity,
    wind_speed: round(clamp(9 + gaussian(rand) * 3 - 3 * w, 2, 30), 1),
    solar_rad: solar,
    et0_mm: round(hargreavesEt0(tmax, tmin, lat, doy), 2),
  };
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  return res.json();
}

function mapOpenMeteo(json, lat) {
  const d = json.daily;
  return d.time.map((date, i) => {
    const tmax = d.temperature_2m_max[i], tmin = d.temperature_2m_min[i];
    if (tmax === null || tmin === null) return null;
    const et0 = d.et0_fao_evapotranspiration?.[i] ?? hargreavesEt0(tmax, tmin, lat, dayOfYear(date));
    return {
      date,
      source: 'open-meteo',
      temp_max: tmax,
      temp_min: tmin,
      temp_mean: d.temperature_2m_mean?.[i] ?? round((tmax + tmin) / 2, 1),
      rainfall_mm: d.precipitation_sum?.[i] ?? 0,
      humidity_pct: d.relative_humidity_2m_mean?.[i] ?? null,
      wind_speed: d.wind_speed_10m_max?.[i] ?? null,
      solar_rad: d.shortwave_radiation_sum?.[i] ?? null,
      et0_mm: round(et0, 2),
    };
  }).filter(Boolean);
}

// Fetch daily weather for [start, end]. Uses the archive API for dates older than 5 days
// and the forecast API (with past_days) for recent and future dates.
export async function getDailyWeather(lat, lng, start, end) {
  if (config.weatherMode !== 'simulated') {
    try {
      const t = today();
      const rows = [];
      const archiveEnd = addDays(t, -6) < end ? addDays(t, -6) : end;
      if (start <= archiveEnd) {
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}` +
          `&start_date=${start}&end_date=${archiveEnd}&daily=${DAILY_VARS.join(',')}&timezone=UTC`;
        rows.push(...mapOpenMeteo(await fetchJson(url), lat));
      }
      if (end > archiveEnd) {
        const forecastDays = clamp(daysBetween(t, end) + 1, 1, 16);
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
          `&daily=${DAILY_VARS.join(',')}&past_days=7&forecast_days=${forecastDays}&timezone=UTC`;
        const recent = mapOpenMeteo(await fetchJson(url), lat);
        const have = new Set(rows.map((r) => r.date));
        rows.push(...recent.filter((r) => r.date >= start && r.date <= end && !have.has(r.date)));
      }
      if (rows.length) {
        // fill any gaps with the generator so downstream models get continuous series
        const have = new Set(rows.map((r) => r.date));
        for (const d of dateRange(start, end)) if (!have.has(d)) rows.push(simulateDay(lat, lng, d));
        return rows.sort((a, b) => a.date.localeCompare(b.date));
      }
    } catch (err) {
      console.warn(`[weather] Open-Meteo unavailable (${err.message}); using climate generator`);
    }
  }
  return dateRange(start, end).map((d) => simulateDay(lat, lng, d));
}

export async function getForecast(lat, lng, days = 7) {
  const start = addDays(today(), 1);
  return getDailyWeather(lat, lng, start, addDays(start, days - 1));
}

// Pull and upsert environmental data for a field. Returns {inserted, source}.
export async function syncFieldWeather(field, start, end) {
  const lat = field.centroid_lat, lng = field.centroid_lng;
  if (lat === null || lng === null || lat === undefined) throw new Error('Field has no location');
  const rows = await getDailyWeather(lat, lng, start, end);
  if (!rows.length) return { inserted: 0, source: null };
  const cols = ['field_id', 'date', 'source', 'temp_max', 'temp_min', 'temp_mean', 'rainfall_mm', 'humidity_pct', 'wind_speed', 'solar_rad', 'et0_mm'];
  const values = [];
  const placeholders = rows.map((r, i) => {
    values.push(field.id, r.date, r.source, r.temp_max, r.temp_min, r.temp_mean, r.rainfall_mm, r.humidity_pct, r.wind_speed, r.solar_rad, r.et0_mm);
    return `(${cols.map((_, j) => `$${i * cols.length + j + 1}`).join(',')})`;
  });
  await query(
    `INSERT INTO environmental_data (${cols.join(',')}) VALUES ${placeholders.join(',')}
     ON CONFLICT (field_id, date) DO UPDATE SET source=EXCLUDED.source, temp_max=EXCLUDED.temp_max,
       temp_min=EXCLUDED.temp_min, temp_mean=EXCLUDED.temp_mean, rainfall_mm=EXCLUDED.rainfall_mm,
       humidity_pct=EXCLUDED.humidity_pct, wind_speed=EXCLUDED.wind_speed, solar_rad=EXCLUDED.solar_rad,
       et0_mm=EXCLUDED.et0_mm`,
    values,
  );
  const sources = [...new Set(rows.map((r) => r.source))];
  return { inserted: rows.length, source: sources.join('+') };
}
