// Explainable agronomic models. Each returns a score plus the factors that produced it,
// so every recommendation can be traced back to the data streams that drove it.
import { CROPS, STAGE_SUSCEPTIBILITY, IRRIGATION_EFFICIENCY, kcAt } from '../../config/crops.js';
import { clamp, round, mean, std, sigmoid } from '../../utils/helpers.js';
import { effectiveRain } from '../fusion.js';

// ---------------- Crop health index (0-100) ----------------
export function cropHealth(rows, field) {
  // compare the latest *observed* scene with the expected value on that date (avoids interpolation lag)
  const last = [...rows].reverse().find((r) => r.ndvi_observed) || rows[rows.length - 1];
  const latest = rows[rows.length - 1];
  const factors = [];
  const ndviRatio = last.ndvi !== null && last.ndvi_expected ? clamp(last.ndvi / last.ndvi_expected, 0, 1.2) : null;
  const vigour = ndviRatio === null ? 0.75 : clamp(ndviRatio, 0, 1);
  factors.push({ factor: 'Canopy vigour (NDVI vs expected)', source: 'satellite', weight: 0.45, score: round(vigour, 3),
    detail: last.ndvi === null ? 'No cloud-free imagery yet' : `NDVI ${last.ndvi} vs expected ${last.ndvi_expected} for ${last.stage}` });
  // expected canopy water index scales with expected greenness
  const ndwiExpected = last.ndvi_expected !== null ? -0.25 + 0.75 * (last.ndvi_expected - 0.15) : 0.2;
  const ndwiScore = last.ndwi === null ? 0.75 : clamp(1 - (ndwiExpected - last.ndwi) / 0.25, 0, 1);
  factors.push({ factor: 'Canopy water content (NDWI)', source: 'satellite', weight: 0.15, score: round(ndwiScore, 3),
    detail: last.ndwi === null ? 'n/a' : `NDWI ${last.ndwi} vs expected ${round(ndwiExpected, 3)}` });
  // stress coefficient from end-of-day depletion (FAO-56 eq. 84)
  const dr = latest.depletion_mm, TAW = latest.taw_mm, RAW = latest.raw_mm;
  const ks = dr === null || dr === undefined ? 1 : dr > RAW ? clamp((TAW - dr) / (TAW - RAW), 0, 1) : 1;
  factors.push({ factor: 'Root-zone water stress (Ks)', source: 'weather + soil model', weight: 0.2, score: round(ks, 3),
    detail: `Depletion ${latest.depletion_mm ?? '–'} mm of ${latest.taw_mm} mm available` });
  const biotic = 1 - Math.max(latest.pest_index, latest.disease_index) / 5;
  factors.push({ factor: 'Pest & disease pressure', source: 'field observations', weight: 0.2, score: round(biotic, 3),
    detail: `Pest index ${latest.pest_index}/5, disease index ${latest.disease_index}/5` });
  const score = 100 * factors.reduce((s, f) => s + f.weight * f.score, 0);
  const cls = score >= 75 ? 'Healthy' : score >= 55 ? 'Moderate stress' : score >= 35 ? 'High stress' : 'Critical';
  return { score: round(score, 1), class: cls, factors, ndviRatio: round(ndviRatio, 3) };
}

// ---------------- NDVI anomaly detection ----------------
export function ndviAnomaly(rows) {
  const obs = rows.filter((r) => r.ndvi_observed && r.ndvi_expected !== null && r.das > 10);
  if (obs.length < 4) return { anomaly: false, reason: 'Insufficient imagery for anomaly detection', z: null };
  const resid = obs.map((r) => r.ndvi - r.ndvi_expected);
  const hist = resid.slice(0, -1);
  const m = mean(hist), s = Math.max(std(hist), 0.03);
  const z = (resid[resid.length - 1] - m) / s;
  const lastTwo = obs.slice(-2);
  const drop = lastTwo[0].ndvi - lastTwo[1].ndvi;
  const expectedDrop = lastTwo[0].ndvi_expected - lastTwo[1].ndvi_expected;
  const suddenDrop = drop - expectedDrop > 0.08 && lastTwo[1].stage !== 'late-season';
  const anomaly = z < -2 || suddenDrop;
  return {
    anomaly, z: round(z, 2), drop: round(drop, 3),
    reason: anomaly
      ? (suddenDrop ? `NDVI fell ${round(drop, 2)} between ${lastTwo[0].date} and ${lastTwo[1].date}, more than phenology explains` : `Latest NDVI is ${round(Math.abs(z), 1)}σ below this field's usual deviation from the crop curve`)
      : 'NDVI trajectory consistent with crop phenology',
  };
}

// ---------------- Irrigation scheduling (FAO-56 water balance) ----------------
export function irrigationAdvice(rows, field, forecast) {
  const crop = CROPS[field.crop];
  const latest = rows[rows.length - 1];
  const dr = latest.depletion_mm ?? 0;
  const RAW = latest.raw_mm, TAW = latest.taw_mm;
  const das = latest.das;
  // project the bucket through the forecast horizon
  let projected = dr;
  let rainNext3 = 0, etcNext3 = 0;
  const projection = forecast.slice(0, 7).map((f, i) => {
    const kc = kcAt(field.crop, das + i + 1);
    const etc = kc * (f.et0_mm ?? 4);
    projected = clamp(projected - effectiveRain(f.rainfall_mm) + etc, 0, TAW);
    if (i < 3) { rainNext3 += f.rainfall_mm || 0; etcNext3 += etc; }
    return { date: f.date, rainfall_mm: f.rainfall_mm, etc_mm: round(etc, 2), depletion_mm: round(projected, 1) };
  });
  const daysToStress = projection.findIndex((p) => p.depletion_mm > RAW);
  const efficiency = IRRIGATION_EFFICIENCY[field.irrigation_type] ?? 0.6;
  const trigger = field.crop === 'rice' ? RAW * 0.6 : RAW * 0.85;
  let netMm = 0, urgency = 'none', action;
  if (das < 0 || latest.stage === 'harvest-ready') {
    action = 'No irrigation needed outside the growing period.';
  } else if (dr >= trigger && rainNext3 < dr * 0.6) {
    netMm = Math.max(0, dr - effectiveRain(rainNext3) * 0.5);
    urgency = dr > RAW ? 'high' : 'medium';
    action = field.irrigation_type === 'rainfed'
      ? `Root zone is ${round((dr / TAW) * 100, 0)}% depleted. Field is rainfed — consider supplemental irrigation or mulching to conserve moisture.`
      : `Apply ~${round(netMm / efficiency, 0)} mm gross (${round(netMm, 0)} mm net) via ${field.irrigation_type} irrigation within ${urgency === 'high' ? '24 hours' : '2–3 days'}.`;
  } else if (daysToStress >= 0) {
    urgency = 'low';
    action = `Soil water adequate now; stress expected in ~${daysToStress + 1} day(s) if forecast rain (${round(rainNext3, 0)} mm/3d) does not materialise.`;
  } else {
    action = `Soil water adequate (${round((dr / TAW) * 100, 0)}% depleted). Forecast rain ${round(rainNext3, 0)} mm over 3 days.`;
  }
  return {
    depletion_mm: round(dr, 1), raw_mm: RAW, taw_mm: TAW,
    deficit_mm: round(Math.max(0, dr - RAW), 1),
    net_mm: round(netMm, 1), gross_mm: round(netMm / efficiency, 1),
    efficiency, urgency, action, daysToStress: daysToStress < 0 ? null : daysToStress + 1,
    rainNext3: round(rainNext3, 1), etcNext3: round(etcNext3, 1), projection,
  };
}

// ---------------- Pest & disease risk ----------------
export function pestDiseaseRisk(rows, field, forecast = []) {
  const crop = CROPS[field.crop];
  const latest = rows[rows.length - 1];
  const recent = rows.slice(-7).filter((r) => r.temp_mean !== null);
  const ahead = forecast.slice(0, 3);
  const window = [...recent, ...ahead.map((f) => ({ temp_mean: f.temp_mean, humidity_pct: f.humidity_pct, rainfall_mm: f.rainfall_mm }))];
  const [dLo, dHi] = crop.diseaseOptTemp;
  const [pLo, pHi] = crop.pestOptTemp;
  // leaf-wetness proxy: humid or rainy days at favourable temperature
  const wetDays = window.filter((r) => ((r.humidity_pct ?? 0) >= 85 || (r.rainfall_mm ?? 0) >= 2) && r.temp_mean >= dLo && r.temp_mean <= dHi).length;
  const warmDays = window.filter((r) => r.temp_mean >= pLo && r.temp_mean <= pHi).length;
  const dryDays = window.filter((r) => (r.rainfall_mm ?? 0) < 1).length;
  const susc = STAGE_SUSCEPTIBILITY[latest.stage] ?? 0.5;
  const n = Math.max(window.length, 1);

  const dz = -3.2 + 3.0 * (wetDays / n) + 0.55 * latest.disease_index + 1.2 * susc;
  const pz = -3.8 + 1.6 * (warmDays / n) + 0.9 * (dryDays / n) + 0.6 * latest.pest_index + 1.0 * susc;
  const diseaseRisk = sigmoid(dz), pestRisk = sigmoid(pz);
  const level = (r) => (r >= 0.7 ? 'high' : r >= 0.4 ? 'medium' : 'low');
  return {
    disease: {
      risk: round(diseaseRisk, 3), level: level(diseaseRisk), likely: crop.diseases.slice(0, 2),
      drivers: [`${wetDays}/${n} favourable wet days (${dLo}–${dHi}°C)`, `observed disease index ${latest.disease_index}/5`, `stage susceptibility ${susc}`],
    },
    pest: {
      risk: round(pestRisk, 3), level: level(pestRisk), likely: crop.pests.slice(0, 2),
      drivers: [`${warmDays}/${n} days in pest optimum (${pLo}–${pHi}°C)`, `${dryDays}/${n} dry days`, `observed pest index ${latest.pest_index}/5`],
    },
  };
}

// ---------------- Recommendation synthesis ----------------
export function synthesize({ field, health, anomaly, irrigation, risk, yieldPred, latest, observationAgeDays, sceneAgeDays }) {
  const recs = [];
  const add = (priority, category, title, action, evidence) => recs.push({ priority, category, title, action, evidence });
  const crop = CROPS[field.crop];

  if (irrigation.urgency === 'high' || irrigation.urgency === 'medium') {
    add(irrigation.urgency === 'high' ? 1 : 2, 'water', field.irrigation_type === 'rainfed' ? 'Soil moisture deficit' : 'Irrigation required', irrigation.action,
      [`Root-zone depletion ${irrigation.depletion_mm} mm (readily available ${irrigation.raw_mm} mm)`, `Forecast rain next 3 days: ${irrigation.rainNext3} mm`]);
  } else if (irrigation.urgency === 'low') {
    add(3, 'water', 'Monitor soil moisture', irrigation.action, [`Projected stress in ${irrigation.daysToStress} day(s)`]);
  }
  if (risk.disease.level !== 'low') {
    add(risk.disease.level === 'high' ? 1 : 2, 'disease', `Elevated disease risk (${risk.disease.likely.join(', ')})`,
      risk.disease.level === 'high'
        ? 'Scout lower canopy within 48 h; if symptoms confirmed apply a registered fungicide/bactericide and remove infected plants. Avoid overhead irrigation.'
        : 'Increase scouting frequency to twice weekly, focusing on humid, shaded parts of the field.',
      risk.disease.drivers);
  }
  if (risk.pest.level !== 'low') {
    add(risk.pest.level === 'high' ? 1 : 2, 'pest', `Elevated pest risk (${risk.pest.likely.join(', ')})`,
      risk.pest.level === 'high'
        ? 'Scout 5 points × 10 plants; if threshold exceeded use targeted biological or registered chemical control. Conserve natural enemies.'
        : 'Set or check pheromone/sticky traps and scout weekly.',
      risk.pest.drivers);
  }
  if (anomaly.anomaly) {
    add(1, 'anomaly', 'Unexpected canopy decline detected', 'Visit the field and record an observation (photo, pest/disease, soil moisture) to confirm the cause.', [anomaly.reason]);
  }
  if (health.class === 'High stress' || health.class === 'Critical') {
    const worst = [...health.factors].sort((a, b) => a.score - b.score)[0];
    add(1, 'health', `Crop health ${health.class.toLowerCase()} (${health.score}/100)`,
      `Main driver: ${worst.factor.toLowerCase()}. Address this first.`, health.factors.map((f) => `${f.factor}: ${round(f.score * 100, 0)}%`));
  }
  if (latest.stage === 'development' || latest.stage === 'initial') {
    if (latest.das >= 18 && latest.das <= 45 && ['maize', 'sorghum', 'rice'].includes(field.crop)) {
      add(3, 'nutrition', 'Top-dress nitrogen window', `At ${latest.das} days after planting, ${crop.label.toLowerCase()} benefits from split N top-dressing if soil is moist.`, [`Stage: ${latest.stage}`]);
    }
  }
  if (latest.stage === 'harvest-ready' || (latest.stage === 'late-season' && latest.ndvi !== null && latest.ndvi < 0.45)) {
    add(2, 'harvest', 'Plan harvest', 'Canopy senescence indicates approaching maturity. Arrange labour, drying and storage; avoid harvesting during forecast rain.', [`NDVI ${latest.ndvi}`, `Stage ${latest.stage}`]);
  }
  if (observationAgeDays === null || observationAgeDays > 14) {
    add(3, 'data', 'Field observation overdue', 'Record a scouting observation — ground truth improves model accuracy and resets the soil-water balance.',
      [observationAgeDays === null ? 'No observations yet' : `Last observation ${observationAgeDays} days ago`]);
  }
  if (sceneAgeDays !== null && sceneAgeDays > 15) {
    add(3, 'data', 'Satellite data stale', 'Fetch newer imagery (cloud cover may be blocking acquisitions).', [`Last usable scene ${sceneAgeDays} days ago`]);
  }
  if (yieldPred && yieldPred.value !== null && yieldPred.value < crop.typicalYield * 0.8) {
    add(2, 'yield', 'Yield outlook below typical', `Predicted ${yieldPred.value} t/ha vs typical ${crop.typicalYield} t/ha. Prioritise the actions above to protect yield.`,
      (yieldPred.contributions || []).slice(0, 3).map((c) => `${c.feature}: ${c.contribution > 0 ? '+' : ''}${c.contribution} t/ha`));
  }
  if (!recs.length) add(4, 'general', 'No action required', 'All indicators within normal range. Continue routine monitoring.', [`Health ${health.score}/100`]);
  return recs.sort((a, b) => a.priority - b.priority);
}
