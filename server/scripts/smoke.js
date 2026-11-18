// End-to-end smoke test against a running API (default http://localhost:5000).
// Exercises every module: auth, farms, fields, observations (+photo), irrigation, satellite,
// environment, integration, AI, models, alerts, advisories, reports, users, public.
const BASE = process.env.API_URL || 'http://localhost:5000/api';
let token = '';
let failures = 0;

async function call(method, path, body, { form, expect = [200, 201, 204], raw } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const text = await res.text();
  const ok = expect.includes(res.status);
  console.log(`${ok ? '✔' : '✘'} ${method.padEnd(6)} ${path} → ${res.status}`);
  if (!ok) { failures++; console.log('   ', text.slice(0, 300)); }
  if (raw) return text;
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

const login = async (email, password) => { token = (await call('POST', '/auth/login', { email, password })).token; };

(async () => {
  // public
  await call('GET', '/health');
  await call('GET', '/public/stats');
  await call('GET', '/public/advisories');
  await call('GET', '/public/crops');
  await call('POST', '/public/contact', { name: 'Test User', email: 't@example.com', subject: 'Hi', message: 'I would like a demo for my cooperative.' });
  await call('POST', '/public/tools/indices', { B2: 0.04, B3: 0.07, B4: 0.05, B8: 0.45, B11: 0.2 });
  await call('POST', '/public/tools/water-need', { crop: 'maize', planting_date: '2026-09-01', latitude: 8.4, temp_max: 32, temp_min: 23 });
  await call('GET', '/farms', undefined, { expect: [401] });

  // register a new farmer and run through the full workflow
  const email = `smoke${Date.now()}@example.com`;
  token = (await call('POST', '/auth/register', { name: 'Smoke Farmer', email, password: 'Password123' })).token;
  await call('GET', '/auth/me');
  await call('PUT', '/auth/me', { name: 'Smoke Farmer', phone: '+232 1', organization: 'Test' });
  const farm = await call('POST', '/farms', { name: 'Smoke Farm', location_name: 'Kenema', latitude: 7.87, longitude: -11.19 });
  await call('PUT', `/farms/${farm.id}`, { name: 'Smoke Farm Updated', location_name: 'Kenema', latitude: 7.87, longitude: -11.19 });
  const d = 0.0015;
  const boundary = { type: 'Polygon', coordinates: [[[-11.19, 7.87], [-11.19 + d, 7.87], [-11.19 + d, 7.87 + d], [-11.19, 7.87 + d], [-11.19, 7.87]]] };
  const plant = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
  const field = await call('POST', '/fields', { farm_id: farm.id, name: 'Smoke Maize', crop: 'maize', planting_date: plant, boundary, soil_type: 'loam', irrigation_type: 'drip' });
  await call('POST', '/fields', { farm_id: farm.id, name: 'Bad', crop: 'maize', planting_date: plant }, { expect: [400] });
  await call('GET', '/fields');
  await call('GET', `/fields/${field.id}`);

  await call('POST', `/environment/field/${field.id}/sync`, {});
  await call('POST', `/environment/field/${field.id}`, { date: new Date().toISOString().slice(0, 10), rainfall_mm: 12, temp_max: 31, temp_min: 23 });
  await call('GET', `/environment/field/${field.id}`);
  await call('GET', `/environment/field/${field.id}/forecast`);
  const envCsv = new FormData();
  envCsv.append('file', new Blob(['date,temp_max,temp_min,rainfall_mm\n' + plant + ',30,22,5\n'], { type: 'text/csv' }), 'env.csv');
  await call('POST', `/environment/field/${field.id}/import`, undefined, { form: envCsv });

  await call('GET', '/satellite/providers');
  await call('POST', `/satellite/field/${field.id}/fetch`, { provider: 'simulated' });
  await call('POST', `/satellite/field/${field.id}`, { acquired_on: plant, B2: 0.05, B4: 0.08, B8: 0.3, B11: 0.2 });
  const satCsv = new FormData();
  satCsv.append('file', new Blob(['date,ndvi,ndwi,cloud_cover\n' + plant + ',0.21,-0.1,5\n'], { type: 'text/csv' }), 's.csv');
  await call('POST', `/satellite/field/${field.id}/import`, undefined, { form: satCsv });
  const sat = await call('GET', `/satellite/field/${field.id}`);
  await call('POST', '/satellite/indices', { B4: 0.1, B8: 0.4 });

  const fd = new FormData();
  fd.append('field_id', field.id); fd.append('pest_type', 'fall armyworm'); fd.append('pest_severity', '3');
  fd.append('soil_moisture_pct', '18'); fd.append('canopy_cover_pct', '55'); fd.append('notes', 'smoke');
  // 1x1 PNG
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  fd.append('photo', new Blob([png], { type: 'image/png' }), 'leaf.png');
  const obs = await call('POST', '/observations', undefined, { form: fd });
  if (obs?.photo_url) await fetch(BASE.replace('/api', '') + obs.photo_url).then((r) => console.log(`${r.ok ? '✔' : '✘'} GET    ${obs.photo_url} → ${r.status}`));
  const fd2 = new FormData(); fd2.append('notes', 'edited'); fd2.append('pest_severity', '2');
  await call('PUT', `/observations/${obs.id}`, undefined, { form: fd2 });
  await call('GET', `/observations?field_id=${field.id}`);
  const irr = await call('POST', '/observations/irrigation', { field_id: field.id, date: new Date().toISOString().slice(0, 10), amount_mm: 20, method: 'drip' });
  await call('GET', `/observations/irrigation?field_id=${field.id}`);

  const ts = await call('GET', `/integration/field/${field.id}/timeseries`);
  console.log(`   fused rows: ${ts.rows.length}, satellite coverage ${ts.meta.coverage.satellite}`);
  await call('GET', `/integration/field/${field.id}/export.csv`, undefined, { raw: true });

  const dec = await call('POST', `/ai/fields/${field.id}/decide`, {});
  console.log(`   decision: health ${dec.decision.health_score} (${dec.decision.health_class}), yield ${dec.decision.predicted_yield} t/ha, ${dec.decision.recommendations.length} recs`);
  await call('GET', `/ai/fields/${field.id}/decisions`);
  await call('GET', `/ai/decisions/${dec.decision.id}`);
  await call('GET', '/ai/decisions');
  await call('GET', `/ai/fields/${field.id}/yield`);
  await call('GET', '/ai/models');
  await call('POST', '/ai/models/train', { crop: 'maize' }, { expect: [403] });
  const alerts = await call('GET', '/alerts');
  if (alerts.length) await call('PATCH', `/alerts/${alerts[0].id}`, { status: 'acknowledged' });
  await call('GET', '/reports/overview');
  await call('GET', `/reports/farm/${farm.id}`);
  await call('GET', `/reports/farm/${farm.id}?format=csv`, undefined, { raw: true });
  await call('GET', '/users', undefined, { expect: [403] });
  await call('GET', '/fields/1', undefined, { expect: [403] }); // another farmer's field

  // cleanup pieces
  await call('DELETE', `/observations/irrigation/${irr.id}`);
  await call('DELETE', `/observations/${obs.id}`);
  if (sat.scenes.length) await call('DELETE', `/satellite/${sat.scenes[0].id}`);

  // staff
  await login('admin@agrisense.local', 'Admin@123');
  await call('GET', '/users');
  const nu = await call('POST', '/users', { name: 'Temp Agro', email: `agro${Date.now()}@x.com`, password: 'Password123', role: 'agronomist' });
  await call('PATCH', `/users/${nu.id}`, { active: false });
  await call('DELETE', `/users/${nu.id}`);
  const msgs = await call('GET', '/users/messages/all');
  if (msgs.length) await call('PATCH', `/users/messages/${msgs[0].id}`, { handled: true });
  const adv = await call('POST', '/advisories', { title: 'Smoke advisory', body: 'This is only a test advisory.', severity: 'low', published: false });
  await call('PUT', `/advisories/${adv.id}`, { title: 'Smoke advisory', body: 'This is only a test advisory.', severity: 'medium', published: true });
  await call('GET', '/advisories');
  await call('DELETE', `/advisories/${adv.id}`);
  const m = await call('POST', '/ai/models/train', { crop: 'maize', lambda: 0.5 });
  console.log(`   retrained maize v${m.version}: CV R² ${m.metrics.cv.r2}`);
  await call('GET', '/ai/seasons?crop=maize');
  const season = await call('POST', '/ai/seasons', { crop: 'maize', season_year: 2025, mean_ndvi: 0.5, peak_ndvi: 0.78, cum_rain: 700, gdd: 1900, yield_t_ha: 4.2 });
  await call('DELETE', `/ai/seasons/${season.id}`);
  const run = await call('POST', '/ai/run-all', {});
  console.log(`   run-all processed ${run.processed} fields`);
  await call('DELETE', `/fields/${field.id}`);
  await call('DELETE', `/farms/${farm.id}`);

  console.log(failures ? `\n✘ ${failures} check(s) failed` : '\n✔ All smoke checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
