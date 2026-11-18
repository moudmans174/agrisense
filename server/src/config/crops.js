// Crop agronomic parameters.
// Stage lengths and Kc values follow FAO-56 (Allen et al., 1998) Table 11/12, adapted
// for West African tropical conditions. Yields are typical attainable on-farm (t/ha);
// cassava and tomato are fresh weight.
export const CROPS = {
  rice: {
    label: 'Rice (lowland)', stages: { initial: 30, development: 30, mid: 40, late: 20 },
    kc: { ini: 1.05, mid: 1.2, end: 0.9 }, baseTemp: 10, peakNdvi: 0.84, rootDepth: 0.5,
    depletionFraction: 0.2, maxYield: 6.5, typicalYield: 3.2,
    pests: ['stem borer', 'rice bug', 'African rice gall midge'], diseases: ['rice blast', 'brown spot', 'bacterial leaf blight'],
    diseaseOptTemp: [22, 30], pestOptTemp: [25, 32],
  },
  maize: {
    label: 'Maize', stages: { initial: 20, development: 35, mid: 40, late: 25 },
    kc: { ini: 0.3, mid: 1.2, end: 0.6 }, baseTemp: 10, peakNdvi: 0.82, rootDepth: 1.0,
    depletionFraction: 0.55, maxYield: 7.5, typicalYield: 2.8,
    pests: ['fall armyworm', 'stem borer', 'maize weevil'], diseases: ['northern leaf blight', 'maize streak virus', 'gray leaf spot'],
    diseaseOptTemp: [20, 30], pestOptTemp: [24, 32],
  },
  cassava: {
    label: 'Cassava', stages: { initial: 60, development: 90, mid: 100, late: 50 },
    kc: { ini: 0.3, mid: 0.85, end: 0.4 }, baseTemp: 12, peakNdvi: 0.78, rootDepth: 0.8,
    depletionFraction: 0.35, maxYield: 30, typicalYield: 12,
    pests: ['whitefly', 'cassava mealybug', 'green mite'], diseases: ['cassava mosaic disease', 'cassava brown streak', 'bacterial blight'],
    diseaseOptTemp: [24, 32], pestOptTemp: [25, 33],
  },
  groundnut: {
    label: 'Groundnut', stages: { initial: 25, development: 35, mid: 45, late: 25 },
    kc: { ini: 0.4, mid: 1.15, end: 0.6 }, baseTemp: 10, peakNdvi: 0.8, rootDepth: 0.5,
    depletionFraction: 0.5, maxYield: 4, typicalYield: 1.4,
    pests: ['aphids', 'termites', 'leaf miner'], diseases: ['early leaf spot', 'rosette virus', 'rust'],
    diseaseOptTemp: [22, 30], pestOptTemp: [24, 32],
  },
  sorghum: {
    label: 'Sorghum', stages: { initial: 20, development: 35, mid: 40, late: 25 },
    kc: { ini: 0.3, mid: 1.0, end: 0.55 }, baseTemp: 10, peakNdvi: 0.78, rootDepth: 1.0,
    depletionFraction: 0.55, maxYield: 5, typicalYield: 1.6,
    pests: ['sorghum midge', 'stem borer', 'aphids'], diseases: ['anthracnose', 'grain mold', 'downy mildew'],
    diseaseOptTemp: [22, 30], pestOptTemp: [25, 33],
  },
  tomato: {
    label: 'Tomato', stages: { initial: 30, development: 40, mid: 40, late: 25 },
    kc: { ini: 0.6, mid: 1.15, end: 0.8 }, baseTemp: 10, peakNdvi: 0.8, rootDepth: 0.7,
    depletionFraction: 0.4, maxYield: 45, typicalYield: 15,
    pests: ['tomato leafminer (Tuta absoluta)', 'whitefly', 'fruit worm'], diseases: ['early blight', 'late blight', 'bacterial wilt'],
    diseaseOptTemp: [18, 28], pestOptTemp: [24, 32],
  },
};

export const CROP_KEYS = Object.keys(CROPS);

export const SOIL_TYPES = {
  sand: { fc: 0.12, wp: 0.05 },
  'sandy loam': { fc: 0.20, wp: 0.09 },
  loam: { fc: 0.30, wp: 0.13 },
  'clay loam': { fc: 0.34, wp: 0.19 },
  clay: { fc: 0.40, wp: 0.25 },
};

export const IRRIGATION_EFFICIENCY = { drip: 0.9, sprinkler: 0.75, surface: 0.6, flood: 0.5, rainfed: 0.6 };

export function seasonLength(crop) {
  const s = CROPS[crop].stages;
  return s.initial + s.development + s.mid + s.late;
}

export function stageOf(crop, das) {
  const c = CROPS[crop];
  if (!c || das < 0) return 'pre-planting';
  const { initial, development, mid, late } = c.stages;
  if (das < initial) return 'initial';
  if (das < initial + development) return 'development';
  if (das < initial + development + mid) return 'mid-season';
  if (das < initial + development + mid + late) return 'late-season';
  return 'harvest-ready';
}

// FAO-56 crop coefficient curve (linear in development and late stages)
export function kcAt(crop, das) {
  const c = CROPS[crop];
  const { initial, development, mid, late } = c.stages;
  const { ini, mid: kmid, end } = c.kc;
  if (das < initial) return ini;
  if (das < initial + development) return ini + ((das - initial) / development) * (kmid - ini);
  if (das < initial + development + mid) return kmid;
  if (das < initial + development + mid + late) {
    return kmid + ((das - initial - development - mid) / late) * (end - kmid);
  }
  return end;
}

// Expected NDVI trajectory for a healthy crop (double-logistic phenology curve).
export function expectedNdvi(crop, das) {
  const c = CROPS[crop];
  const base = 0.18;
  const { initial, development, mid, late } = c.stages;
  const greenUp = initial + development * 0.5;          // inflection of green-up
  const senesce = initial + development + mid + late * 0.5; // inflection of senescence
  const rise = 1 / (1 + Math.exp(-(das - greenUp) / (development / 6)));
  const fall = 1 / (1 + Math.exp((das - senesce) / (late / 5)));
  return base + (c.peakNdvi - base) * rise * fall;
}

// Relative susceptibility of each stage to pest/disease damage (0..1)
export const STAGE_SUSCEPTIBILITY = {
  'pre-planting': 0, initial: 0.5, development: 0.8, 'mid-season': 1, 'late-season': 0.5, 'harvest-ready': 0.2,
};
