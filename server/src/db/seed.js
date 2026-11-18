// Seeds demo users, farms (Sierra Leone), fields, observations, irrigation logs, historical
// season records, trains yield models and runs the AI engine once for every field.
// Usage: npm run seed            (adds demo data if the database is empty)
//        npm run seed -- --reset (wipes all data first)
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { pool, query } from './pool.js';
import { migrate } from './migrate.js';
import { CROPS, seasonLength, stageOf, SOIL_TYPES } from '../config/crops.js';
import { trainYieldModel } from '../services/ai/yield.js';
import { runDecision } from '../services/ai/engine.js';
import { addDays, today, prng, gaussian, clamp, round, polygonAreaHa, polygonCentroid } from '../utils/helpers.js';

function rectangle(lat, lng, hectares) {
  const side = Math.sqrt(hectares * 10000);
  const dLat = side / 111320 / 2;
  const dLng = side / (111320 * Math.cos((lat * Math.PI) / 180)) / 2;
  const ring = [[lng - dLng, lat - dLat], [lng + dLng, lat - dLat], [lng + dLng * 0.9, lat + dLat], [lng - dLng * 1.05, lat + dLat], [lng - dLng, lat - dLat]]
    .map(([x, y]) => [round(x, 6), round(y, 6)]);
  return { type: 'Polygon', coordinates: [ring] };
}

const OPT_RAIN = { rice: 1200, maize: 700, cassava: 1400, groundnut: 600, sorghum: 550, tomato: 600 };

function seasonRecords(crop, n, rand) {
  const c = CROPS[crop];
  const out = [];
  for (let i = 0; i < n; i++) {
    const peak = c.peakNdvi * (0.62 + rand() * 0.42);
    const meanNdvi = peak * (0.55 + rand() * 0.13);
    const rain = OPT_RAIN[crop] * (0.45 + rand() * 1.2);
    const gdd = seasonLength(crop) * (14 + rand() * 5);
    const pest = rand() * 3.2, disease = rand() * 3;
    const vigour = clamp((peak / c.peakNdvi - 0.55) / 0.5, 0, 1);
    const rainF = clamp(1 - 0.45 * ((rain - OPT_RAIN[crop]) / OPT_RAIN[crop]) ** 2, 0.3, 1);
    const gddF = clamp(0.85 + 0.15 * (gdd / (seasonLength(crop) * 16.5)), 0.8, 1.05);
    let y = c.maxYield * (0.12 + 0.88 * vigour) * rainF * gddF * (1 - 0.075 * pest) * (1 - 0.065 * disease);
    y *= 1 + gaussian(rand) * 0.06;
    out.push({
      crop, season_year: 2008 + (i % 18), mean_ndvi: round(meanNdvi, 4), peak_ndvi: round(peak, 4), cum_rain: round(rain, 1),
      gdd: round(gdd, 1), mean_pest: round(pest, 2), mean_disease: round(disease, 2), yield_t_ha: round(Math.max(0.1, y), 2),
    });
  }
  return out;
}

export async function seed({ reset = false } = {}) {
  await migrate();
  if (reset) {
    await query(`TRUNCATE contact_messages, advisories, alerts, decisions, ml_models, season_records, environmental_data,
      satellite_observations, irrigation_events, observations, fields, farms, users RESTART IDENTITY CASCADE`);
  }
  const { rows: [{ n }] } = await query('SELECT COUNT(*)::int AS n FROM users');
  if (n > 0) { console.log('Database already has data — skipping seed (use --reset to wipe).'); return; }

  const t = today();
  const hash = (p) => bcrypt.hash(p, 10);
  const users = {};
  for (const u of [
    { key: 'admin', name: 'Platform Admin', email: 'admin@agrisense.local', role: 'admin', pw: 'Admin@123', org: 'AgriSense' },
    { key: 'agro', name: 'Dr. Fatmata Bangura', email: 'agronomist@agrisense.local', role: 'agronomist', pw: 'Agro@1234', org: 'Sierra Leone Agricultural Research Institute' },
    { key: 'f1', name: 'Aminata Kamara', email: 'farmer@agrisense.local', role: 'farmer', pw: 'Farmer@123', org: 'Kpaka Family Farm', phone: '+232 76 000 001' },
    { key: 'f2', name: 'Mohamed Sesay', email: 'cooperative@agrisense.local', role: 'farmer', pw: 'Farmer@123', org: 'Makeni Agro Cooperative', phone: '+232 77 000 002' },
  ]) {
    const { rows: [row] } = await query(
      'INSERT INTO users (name,email,password_hash,role,organization,phone) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [u.name, u.email, await hash(u.pw), u.role, u.org, u.phone || null]);
    users[u.key] = row;
  }

  const farmsDef = [
    { owner: 'f1', name: 'Kpaka Family Farm', location: 'Bo District, Southern Province', lat: 7.9647, lng: -11.7383,
      desc: 'Family-run lowland rice and upland maize farm near Bo.',
      fields: [
        { name: 'Lowland Rice Block A', crop: 'rice', variety: 'NERICA-L19', das: 74, ha: 2.4, soil: 'clay loam', irr: 'flood', dLat: 0.004, dLng: -0.003 },
        { name: 'Upland Maize Plot', crop: 'maize', variety: 'Obatanpa', das: 52, ha: 1.6, soil: 'sandy loam', irr: 'rainfed', dLat: -0.003, dLng: 0.004, pestOutbreak: true },
      ] },
    { owner: 'f2', name: 'Makeni Agro Cooperative', location: 'Bombali District, Northern Province', lat: 8.8806, lng: -12.0442,
      desc: 'Cooperative of 40 smallholders growing cassava, groundnut and vegetables.',
      fields: [
        { name: 'Cassava North', crop: 'cassava', variety: 'SLICASS 6', das: 168, ha: 5.2, soil: 'loam', irr: 'rainfed', dLat: 0.006, dLng: 0.002 },
        { name: 'Groundnut East', crop: 'groundnut', variety: 'Samnut 23', das: 96, ha: 3.1, soil: 'sandy loam', irr: 'sprinkler', dLat: -0.002, dLng: 0.007, diseaseOutbreak: true },
        { name: 'Tomato Garden', crop: 'tomato', variety: 'Roma VF', das: 41, ha: 0.6, soil: 'loam', irr: 'drip', dLat: -0.005, dLng: -0.004 },
      ] },
  ];

  const fields = [];
  for (const fd of farmsDef) {
    const { rows: [farm] } = await query(
      'INSERT INTO farms (owner_id,name,location_name,latitude,longitude,description) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [users[fd.owner].id, fd.name, fd.location, fd.lat, fd.lng, fd.desc]);
    for (const f of fd.fields) {
      const boundary = rectangle(fd.lat + f.dLat, fd.lng + f.dLng, f.ha);
      const c = polygonCentroid(boundary);
      const planting = addDays(t, -f.das);
      const soil = SOIL_TYPES[f.soil];
      const { rows: [field] } = await query(
        `INSERT INTO fields (farm_id,name,crop,variety,planting_date,expected_harvest,area_ha,boundary,centroid_lat,centroid_lng,soil_type,irrigation_type,field_capacity,wilting_point)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [farm.id, f.name, f.crop, f.variety, planting, addDays(planting, seasonLength(f.crop)), round(polygonAreaHa(boundary), 3),
          JSON.stringify(boundary), c.lat, c.lng, f.soil, f.irr, soil.fc, soil.wp]);
      fields.push({ ...field, def: f, owner: users[fd.owner] });
    }
  }

  // Field observations (scouting every ~12 days) + irrigation logs
  for (const f of fields) {
    const rand = prng(f.id * 7919);
    const crop = CROPS[f.crop];
    for (let das = 8; das <= f.def.das; das += 10 + Math.floor(rand() * 5)) {
      const date = addDays(f.planting_date, das);
      const recent = f.def.das - das < 16;
      const pestSev = f.def.pestOutbreak && recent ? 3 : rand() < 0.25 ? 1 : 0;
      const disSev = f.def.diseaseOutbreak && recent ? 3 : rand() < 0.2 ? 1 : 0;
      const progress = Math.min(1, das / (crop.stages.initial + crop.stages.development));
      await query(
        `INSERT INTO observations (field_id,user_id,observed_at,crop_stage,plant_height_cm,canopy_cover_pct,pest_type,pest_severity,
           disease_type,disease_severity,weed_pressure,soil_moisture_pct,leaf_color,latitude,longitude,notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [f.id, f.owner.id, `${date}T09:30:00Z`, stageOf(f.crop, das), round(5 + progress * (f.crop === 'cassava' ? 180 : f.crop === 'maize' ? 210 : 90) * (0.9 + rand() * 0.2), 0),
          round(clamp(progress * 90 + gaussian(rand) * 5, 3, 98), 0),
          pestSev ? crop.pests[0] : null, pestSev, disSev ? crop.diseases[0] : null, disSev, Math.floor(rand() * 3),
          rand() < 0.4 ? round((Number(f.wilting_point) + (Number(f.field_capacity) - Number(f.wilting_point)) * (0.35 + rand() * 0.55)) * 100, 1) : null,
          pestSev >= 3 || disSev >= 3 ? 'yellowing' : 'green',
          f.centroid_lat + gaussian(rand) * 0.0004, f.centroid_lng + gaussian(rand) * 0.0004,
          pestSev >= 3 ? `Fresh ${crop.pests[0]} damage observed on ~30% of plants.` : disSev >= 3 ? `${crop.diseases[0]} lesions spreading on lower leaves.` : 'Routine scouting. Crop looks even.']);
    }
    if (f.irrigation_type !== 'rainfed') {
      for (let das = 5; das <= f.def.das - 4; das += 7 + Math.floor(rand() * 4)) {
        await query('INSERT INTO irrigation_events (field_id,user_id,date,amount_mm,method) VALUES ($1,$2,$3,$4,$5)',
          [f.id, f.owner.id, addDays(f.planting_date, das), f.irrigation_type === 'flood' ? 40 : 18 + Math.round(rand() * 8), f.irrigation_type]);
      }
    }
  }

  // Historical training data and models
  const rand = prng(20261118);
  for (const crop of Object.keys(CROPS)) {
    for (const s of seasonRecords(crop, 72, rand)) {
      await query(`INSERT INTO season_records (crop,season_year,mean_ndvi,peak_ndvi,cum_rain,gdd,mean_pest,mean_disease,yield_t_ha)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [s.crop, s.season_year, s.mean_ndvi, s.peak_ndvi, s.cum_rain, s.gdd, s.mean_pest, s.mean_disease, s.yield_t_ha]);
    }
    const m = await trainYieldModel(crop);
    console.log(`  ✔ trained yield model for ${crop}: CV R²=${m.metrics.cv.r2}, RMSE=${m.metrics.cv.rmse} t/ha`);
  }

  // Run the AI engine (pulls weather + satellite, fuses, decides, raises alerts)
  for (const f of fields) {
    const { decision, alerts } = await runDecision(f);
    console.log(`  ✔ ${f.name}: health ${decision.health_score} (${decision.health_class}), ${alerts.length} alert(s)`);
  }

  const adv = [
    { title: 'Fall armyworm activity rising in Bo and Moyamba', crop: 'maize', region: 'Southern Province', severity: 'high',
      body: 'Field scouts report fresh fall armyworm feeding on young maize. Inspect the whorl of 10 plants at 5 points per field twice a week. Act when more than 20% of plants show fresh damage: hand-pick egg masses, apply sand/ash to the whorl, or use a registered biopesticide (Bt or neem-based).' },
    { title: 'Dry-season transition: plan supplemental irrigation', crop: null, region: 'National', severity: 'medium',
      body: 'Rainfall is declining as the dry season begins. Vegetable and late-planted crops will rely on stored soil moisture. Mulch beds, irrigate early morning or late afternoon, and monitor soil moisture weekly.' },
    { title: 'Groundnut leaf spot — favourable conditions', crop: 'groundnut', region: 'Northern Province', severity: 'medium',
      body: 'Warm, humid nights favour early leaf spot. Remove volunteer plants, rotate with cereals next season, and apply a recommended fungicide at first sign of spots on lower leaves.' },
  ];
  for (const a of adv) {
    await query('INSERT INTO advisories (title,body,region,crop,severity,published,author_id) VALUES ($1,$2,$3,$4,$5,true,$6)',
      [a.title, a.body, a.region, a.crop, a.severity, users.agro.id]);
  }
  console.log('\n✔ Seed complete. Demo logins:');
  console.log('   admin@agrisense.local / Admin@123');
  console.log('   agronomist@agrisense.local / Agro@1234');
  console.log('   farmer@agrisense.local / Farmer@123');
  console.log('   cooperative@agrisense.local / Farmer@123');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed({ reset: process.argv.includes('--reset') })
    .then(() => pool.end())
    .catch((err) => { console.error('Seed failed:', err); process.exit(1); });
}
