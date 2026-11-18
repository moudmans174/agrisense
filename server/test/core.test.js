// Unit tests for pure functions (no database needed): node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeIndices } from '../src/services/satellite.js';
import { hargreavesEt0, simulateDay } from '../src/services/weather.js';
import { fitRidge, predictRidge, crossValidate } from '../src/services/ai/regression.js';
import { fuse } from '../src/services/fusion.js';
import { cropHealth, irrigationAdvice, pestDiseaseRisk } from '../src/services/ai/models.js';
import { kcAt, stageOf, expectedNdvi } from '../src/config/crops.js';
import { polygonAreaHa, parseCsv, addDays, dateRange } from '../src/utils/helpers.js';

test('spectral indices', () => {
  const r = computeIndices({ B2: 0.04, B3: 0.07, B4: 0.05, B8: 0.45, B11: 0.2 });
  assert.equal(r.ndvi, 0.8);
  assert.ok(r.evi > 0.5 && r.evi < 1);
  assert.ok(r.ndwi > 0.3);
  assert.throws(() => computeIndices({ B4: 0.1 }));
});

test('Hargreaves ET0 is plausible for the tropics', () => {
  const et0 = hargreavesEt0(32, 22, 8.5, 320);
  assert.ok(et0 > 3 && et0 < 6, `et0=${et0}`);
});

test('simulated weather is deterministic', () => {
  assert.deepEqual(simulateDay(8, -11, '2026-08-01'), simulateDay(8, -11, '2026-08-01'));
});

test('crop phenology helpers', () => {
  assert.equal(stageOf('maize', 5), 'initial');
  assert.equal(stageOf('maize', 70), 'mid-season');
  assert.equal(kcAt('maize', 70), 1.2);
  assert.ok(expectedNdvi('maize', 70) > expectedNdvi('maize', 10));
});

test('ridge regression recovers a linear relation', () => {
  const X = [], y = [];
  for (let i = 0; i < 60; i++) { const a = i / 10, b = (i * 7) % 13; X.push([a, b]); y.push(2 + 3 * a - 0.5 * b); }
  const m = fitRidge(X, y, 0.001);
  assert.ok(Math.abs(predictRidge(m, [2, 4]) - (2 + 6 - 2)) < 0.05);
  assert.ok(crossValidate(X, y, 0.001).r2 > 0.99);
});

test('polygon area ≈ 1 ha for a 100 m square at the equator', () => {
  const d = 100 / 111320;
  const area = polygonAreaHa({ type: 'Polygon', coordinates: [[[0, 0], [d, 0], [d, d], [0, d], [0, 0]]] });
  assert.ok(Math.abs(area - 1) < 0.02, `area=${area}`);
});

test('CSV parser handles quotes', () => {
  const rows = parseCsv('date,notes\n2026-01-01,"hello, world"\n');
  assert.equal(rows[0].notes, 'hello, world');
});

test('fusion + models produce coherent decisions', () => {
  const field = { id: 1, crop: 'maize', planting_date: '2026-06-01', field_capacity: 0.3, wilting_point: 0.13, irrigation_type: 'drip', centroid_lat: 8, centroid_lng: -11 };
  const start = '2026-06-01', end = '2026-08-01';
  const env = dateRange(start, end).map((d) => ({ ...simulateDay(8, -11, d), rainfall_mm: 0 })); // drought
  const sat = [];
  for (let i = 0; i <= 60; i += 5) sat.push({ acquired_on: addDays(start, i), ndvi: expectedNdvi('maize', i) * 0.9, ndwi: 0.1, evi: 0.4, cloud_cover: 10 });
  const { rows, meta } = fuse(field, { env, sat, obs: [], irr: [] }, start, end);
  assert.equal(rows.length, 62);
  assert.ok(meta.TAW > 100);
  const last = rows[rows.length - 1];
  assert.ok(last.depletion_mm > meta.RAW, 'drought should deplete soil water');
  const forecast = dateRange('2026-08-02', '2026-08-08').map((d) => ({ ...simulateDay(8, -11, d), rainfall_mm: 0 }));
  const irr = irrigationAdvice(rows, field, forecast);
  assert.equal(irr.urgency, 'high');
  assert.ok(irr.gross_mm > 0);
  const health = cropHealth(rows, field);
  assert.ok(health.score < 95);
  const risk = pestDiseaseRisk(rows, field, forecast);
  assert.ok(risk.pest.risk >= 0 && risk.pest.risk <= 1);
});
