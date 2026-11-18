// ---------- dates ----------
export const DAY_MS = 86400000;

export function toISODate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
}
export function addDays(dateStr, n) {
  return toISODate(new Date(new Date(dateStr + 'T00:00:00Z').getTime() + n * DAY_MS));
}
export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / DAY_MS);
}
export function dateRange(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
export function dayOfYear(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / DAY_MS);
}
export const today = () => toISODate(new Date());

// ---------- math ----------
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round = (v, dp = 2) => (v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp);
export const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);
export const sum = (arr) => arr.reduce((s, x) => s + x, 0);
export function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// Deterministic PRNG (mulberry32) so simulated data is reproducible per field/date.
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashSeed(...parts) {
  const s = parts.join('|');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function gaussian(rand) {
  const u = Math.max(rand(), 1e-12), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------- geo ----------
// Area of a GeoJSON polygon ring (lng/lat) in hectares using a spherical excess approximation.
export function polygonAreaHa(geojson) {
  const ring = geojson?.coordinates?.[0];
  if (!ring || ring.length < 4) return null;
  const R = 6378137;
  const rad = (d) => (d * Math.PI) / 180;
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    area += rad(lng2 - lng1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return Math.abs((area * R * R) / 2) / 10000;
}
export function polygonCentroid(geojson) {
  const ring = geojson?.coordinates?.[0];
  if (!ring || !ring.length) return null;
  const pts = ring.slice(0, -1);
  return {
    lat: mean(pts.map((p) => p[1])),
    lng: mean(pts.map((p) => p[0])),
  };
}
export function isValidPolygon(geojson) {
  if (!geojson || geojson.type !== 'Polygon' || !Array.isArray(geojson.coordinates)) return false;
  const ring = geojson.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 4) return false;
  const first = ring[0], last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] &&
    ring.every((p) => Array.isArray(p) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90);
}

// ---------- http ----------
export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Minimal CSV parser (handles quoted fields)
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQ = false;
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}
export function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
