-- AgriSense database schema (PostgreSQL 13+)
-- Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(160) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'farmer' CHECK (role IN ('admin','agronomist','farmer')),
  phone         VARCHAR(40),
  organization  VARCHAR(160),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS farms (
  id            SERIAL PRIMARY KEY,
  owner_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(160) NOT NULL,
  location_name VARCHAR(160),
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fields (
  id               SERIAL PRIMARY KEY,
  farm_id          INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name             VARCHAR(160) NOT NULL,
  crop             VARCHAR(40) NOT NULL,
  variety          VARCHAR(120),
  planting_date    DATE NOT NULL,
  expected_harvest DATE,
  area_ha          NUMERIC(10,3),
  boundary         JSONB,                  -- GeoJSON Polygon
  centroid_lat     DOUBLE PRECISION,
  centroid_lng     DOUBLE PRECISION,
  soil_type        VARCHAR(40) DEFAULT 'loam',
  irrigation_type  VARCHAR(20) DEFAULT 'rainfed' CHECK (irrigation_type IN ('rainfed','drip','sprinkler','surface','flood')),
  field_capacity   NUMERIC(4,3) NOT NULL DEFAULT 0.30,  -- volumetric m3/m3
  wilting_point    NUMERIC(4,3) NOT NULL DEFAULT 0.13,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fields_farm ON fields(farm_id);

-- 1) Ground-truth field observations collected by scouts / farmers
CREATE TABLE IF NOT EXISTS observations (
  id                SERIAL PRIMARY KEY,
  field_id          INTEGER NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  observed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  crop_stage        VARCHAR(40),
  plant_height_cm   NUMERIC(6,1),
  canopy_cover_pct  NUMERIC(5,1) CHECK (canopy_cover_pct BETWEEN 0 AND 100),
  pest_type         VARCHAR(80),
  pest_severity     SMALLINT DEFAULT 0 CHECK (pest_severity BETWEEN 0 AND 5),
  disease_type      VARCHAR(80),
  disease_severity  SMALLINT DEFAULT 0 CHECK (disease_severity BETWEEN 0 AND 5),
  weed_pressure     SMALLINT DEFAULT 0 CHECK (weed_pressure BETWEEN 0 AND 5),
  soil_moisture_pct NUMERIC(5,1) CHECK (soil_moisture_pct BETWEEN 0 AND 100),
  leaf_color        VARCHAR(30),
  latitude          DOUBLE PRECISION,
  longitude         DOUBLE PRECISION,
  photo_url         TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_obs_field_time ON observations(field_id, observed_at DESC);

-- Management log (feeds the soil water balance)
CREATE TABLE IF NOT EXISTS irrigation_events (
  id         SERIAL PRIMARY KEY,
  field_id   INTEGER NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  date       DATE NOT NULL,
  amount_mm  NUMERIC(6,1) NOT NULL CHECK (amount_mm > 0),
  method     VARCHAR(30),
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_irr_field_date ON irrigation_events(field_id, date);

-- 2) Satellite-derived vegetation indices, per field per acquisition
CREATE TABLE IF NOT EXISTS satellite_observations (
  id          SERIAL PRIMARY KEY,
  field_id    INTEGER NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  acquired_on DATE NOT NULL,
  source      VARCHAR(40) NOT NULL DEFAULT 'sentinel-2',
  ndvi        NUMERIC(5,4),
  ndwi        NUMERIC(5,4),
  evi         NUMERIC(5,4),
  savi        NUMERIC(5,4),
  lst_c       NUMERIC(5,2),
  cloud_cover NUMERIC(5,1),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (field_id, acquired_on, source)
);
CREATE INDEX IF NOT EXISTS idx_sat_field_date ON satellite_observations(field_id, acquired_on);

-- 3) Environmental / weather data, daily per field
CREATE TABLE IF NOT EXISTS environmental_data (
  id           SERIAL PRIMARY KEY,
  field_id     INTEGER NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  source       VARCHAR(40) NOT NULL DEFAULT 'open-meteo',
  temp_max     NUMERIC(5,2),
  temp_min     NUMERIC(5,2),
  temp_mean    NUMERIC(5,2),
  rainfall_mm  NUMERIC(6,2),
  humidity_pct NUMERIC(5,2),
  wind_speed   NUMERIC(5,2),
  solar_rad    NUMERIC(6,2),   -- MJ/m2/day
  et0_mm       NUMERIC(5,2),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (field_id, date)
);
CREATE INDEX IF NOT EXISTS idx_env_field_date ON environmental_data(field_id, date);

-- Historical season outcomes used to train yield models
CREATE TABLE IF NOT EXISTS season_records (
  id           SERIAL PRIMARY KEY,
  field_id     INTEGER REFERENCES fields(id) ON DELETE SET NULL,
  crop         VARCHAR(40) NOT NULL,
  season_year  INTEGER NOT NULL,
  mean_ndvi    NUMERIC(5,4) NOT NULL,
  peak_ndvi    NUMERIC(5,4) NOT NULL,
  cum_rain     NUMERIC(7,1) NOT NULL,
  gdd          NUMERIC(7,1) NOT NULL,
  mean_pest    NUMERIC(4,2) NOT NULL DEFAULT 0,
  mean_disease NUMERIC(4,2) NOT NULL DEFAULT 0,
  yield_t_ha   NUMERIC(6,2) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_season_crop ON season_records(crop);

CREATE TABLE IF NOT EXISTS ml_models (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(80) NOT NULL,
  crop         VARCHAR(40) NOT NULL,
  version      INTEGER NOT NULL,
  algorithm    VARCHAR(60) NOT NULL,
  features     JSONB NOT NULL,
  params       JSONB NOT NULL,
  metrics      JSONB NOT NULL,
  n_samples    INTEGER NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  trained_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AI decision snapshots
CREATE TABLE IF NOT EXISTS decisions (
  id               SERIAL PRIMARY KEY,
  field_id         INTEGER NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  generated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  crop_stage       VARCHAR(30),
  days_after_planting INTEGER,
  health_score     NUMERIC(5,1),
  health_class     VARCHAR(30),
  water_deficit_mm NUMERIC(6,1),
  irrigation_mm    NUMERIC(6,1),
  pest_risk        NUMERIC(4,3),
  disease_risk     NUMERIC(4,3),
  predicted_yield  NUMERIC(7,2),
  yield_low        NUMERIC(7,2),
  yield_high       NUMERIC(7,2),
  anomaly          BOOLEAN DEFAULT FALSE,
  recommendations  JSONB NOT NULL DEFAULT '[]',
  explanation      JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_dec_field_time ON decisions(field_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id          SERIAL PRIMARY KEY,
  field_id    INTEGER NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  decision_id INTEGER REFERENCES decisions(id) ON DELETE SET NULL,
  type        VARCHAR(30) NOT NULL,
  severity    VARCHAR(10) NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  title       VARCHAR(200) NOT NULL,
  message     TEXT NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status, created_at DESC);

-- Public advisories shown on the public website
CREATE TABLE IF NOT EXISTS advisories (
  id         SERIAL PRIMARY KEY,
  title      VARCHAR(200) NOT NULL,
  body       TEXT NOT NULL,
  region     VARCHAR(120),
  crop       VARCHAR(40),
  severity   VARCHAR(10) NOT NULL DEFAULT 'low' CHECK (severity IN ('low','medium','high','critical')),
  published  BOOLEAN NOT NULL DEFAULT FALSE,
  author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  email      VARCHAR(160) NOT NULL,
  subject    VARCHAR(200),
  message    TEXT NOT NULL,
  handled    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
