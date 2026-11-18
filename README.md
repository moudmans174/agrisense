# AgriSense
**Integrating Agricultural Field Observations, Satellite and Environmental Data for AI-Enabled Agricultural Decisions**

AgriSense is a full PERN-stack platform (PostgreSQL · Express · React · Node.js). It brings three data streams onto one daily timeline per field:

1. **Field observations**: scouting visits, pest/disease severity, soil moisture, photos with GPS
2. **Satellite data**: Sentinel-2 NDVI, NDWI, EVI and SAVI, clipped to each field boundary and cloud-filtered
3. **Environmental data**: daily weather from Open-Meteo, station/rain-gauge uploads and a 7-day forecast

An **explainable AI decision engine** uses this fused timeline to produce crop-health scores, irrigation schedules, pest and disease risk, canopy-anomaly flags and yield forecasts. Urgent recommendations become alerts. A **public website** gives visitors live platform stats, crop advisories, free calculators and a contact form.

---

## Quick start

### Option A: Docker (one command)
```bash
docker compose up --build
# open http://localhost:5000
```

### Option B: Local development
Prerequisites: Node 18+ and PostgreSQL 13+.

```bash
createdb agrisense                       # or create it in pgAdmin
cp server/.env.example server/.env       # set DATABASE_URL and JWT_SECRET
npm run install:all
npm run setup                            # creates the tables and loads demo data
npm run dev:server                       # API on http://localhost:5000
npm run dev:client                       # web app on http://localhost:5173
```
To run in production: `npm run build && npm start`. Express then serves the built React app on port 5000.

### Demo accounts
| Role | Email | Password |
|---|---|---|
| Admin | admin@agrisense.local | Admin@123 |
| Agronomist | agronomist@agrisense.local | Agro@1234 |
| Farmer | farmer@agrisense.local | Farmer@123 |
| Farmer (cooperative) | cooperative@agrisense.local | Farmer@123 |

The seed data has 2 farms and 5 fields in Sierra Leone (rice, maize, cassava, groundnut, tomato). It also includes 72 historical seasons per crop and a trained yield model for each crop.

---

## Modules

| Module | What it does | API |
|---|---|---|
| **Public website** | Landing page with live stats, platform explainer, advisories, free NDVI and crop-water calculators, contact form | `/api/public/*` |
| **Auth & users** | JWT login and registration, profile, password change. Roles: admin, agronomist, farmer. Admins manage users and contact messages | `/api/auth`, `/api/users` |
| **Farms & fields** | Farm CRUD. Fields: draw the boundary on a satellite map, which auto-computes area and centroid. Crop calendar, soil and irrigation settings | `/api/farms`, `/api/fields` |
| **Field observations** | Scouting records with a photo upload, GPS, ODK/Kobo CSV import, and an irrigation log | `/api/observations` |
| **Satellite data** | Sentinel Hub Statistical API (real Sentinel-2) or a simulated provider. Manual entry from index values or raw band reflectances. CSV import | `/api/satellite` |
| **Weather & climate** | Open-Meteo archive and forecast sync, rain-gauge entry, station CSV import. Hargreaves ET₀ is computed when missing | `/api/environment` |
| **Data integration** | Daily fused dataset: interpolated indices, FAO-56 water balance, growing degree days (GDD), decayed pest/disease index. CSV export | `/api/integration` |
| **AI decision engine** | Health index, irrigation, pest/disease risk, anomaly detection, yield forecast, ranked recommendations with evidence | `/api/ai` |
| **Yield models** | Ridge regression per crop with 5-fold cross-validation and versioning. Training data CRUD and CSV import | `/api/ai/models`, `/api/ai/seasons` |
| **Alerts** | Raised automatically from priority-1 and priority-2 recommendations and de-duplicated. Acknowledge, resolve, re-open | `/api/alerts` |
| **Reports** | Dashboard overview; farm season report with expected production (print/PDF, CSV) | `/api/reports` |
| **Advisories** | Agronomists write advisories and publish them to the public site | `/api/advisories` |
| **Scheduler** | Refreshes data and re-runs decisions for every field every 24 h (set `DISABLE_SCHEDULER=true` to turn off) | — |

## How the AI works

- **Crop health index (0–100):** a weighted score of four parts. Canopy vigour is 45% (latest cloud-free NDVI ÷ the NDVI expected for the crop's growth stage). Canopy water (NDWI vs expected) is 15%. Root-zone water stress (FAO-56 Ks) is 20%. Biotic pressure from scouting is 20%. Every factor shows its score, its data source and its detail.
- **Irrigation:** an FAO-56 single-bucket root-zone water balance. TAW = 1000·(FC−WP)·Zr and RAW = p·TAW. ETc = Ks·Kc·ET₀, with the crop coefficient Kc following the crop's growth stage. Effective rainfall and logged irrigation refill the bucket. A soil-moisture observation re-initialises the depletion on the day it is recorded. The bucket is projected 7 days ahead with the forecast, which gives days-to-stress and the net and gross mm to apply (gross is adjusted for irrigation efficiency).
- **Pest & disease risk:** logistic models. Disease uses favourable leaf-wetness days (RH ≥ 85% or rain ≥ 2 mm, inside the crop's optimal temperature band). Pest uses days in the pest's optimal temperature band and dry days. Both add the observed severity and the stage susceptibility, over the past 7 days plus 3 forecast days.
- **Canopy anomaly:** a z-score of the latest NDVI residual against the field's own history, plus a check for a drop faster than phenology explains.
- **Yield:** ridge regression on season mean NDVI, peak NDVI, cumulative rain, GDD, pest pressure and disease pressure. In-season features are projected to the end of the season (expected NDVI curve × current vigour, plus climatology). The 95% interval widens early in the season. Per-feature contributions are shown in the UI.

## Configuration (`server/.env`)
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Set this to a long random string in production |
| `CORS_ORIGIN` | Front-end origin(s), comma-separated |
| `WEATHER_MODE` | `live` (Open-Meteo, falls back to the built-in climate generator when offline) or `simulated` |
| `SH_CLIENT_ID`, `SH_CLIENT_SECRET` | Optional [Sentinel Hub](https://www.sentinel-hub.com/) OAuth client. Enables real Sentinel-2 statistics |
| `SATELLITE_AUTO` | Imagery source the engine uses for auto-refresh: `sentinel-hub`, `simulated` or `off` (default: sentinel-hub if credentials exist, otherwise simulated) |

Every record stores its `source`, such as `open-meteo`, `simulated`, `sentinel-2` or `csv-import`, so you can always tell real data from generated data.

## Testing
```bash
npm test                         # unit tests: indices, ET₀, regression, fusion, models
cd server && npm run smoke       # end-to-end test of every module against a running API
```

Sample CSVs for every importer are in `samples/`.

## Project structure
```
server/
  src/config      crop parameters (FAO-56 Kc, stages), environment
  src/db          schema.sql, migrate, seed
  src/services    weather, satellite, fusion, ai/{models,regression,yield,engine}
  src/routes      one router per module
  test/, scripts/smoke.js
client/
  src/pages/public   Home, Platform, Tools, Advisories, About, Contact, Login, Register
  src/pages/app      Dashboard, Farms, Fields, FieldDetail, Observations, Satellite, Environment,
                     Insights, Alerts, Reports, Models, Advisories, Users, Profile
  src/components     Leaflet maps (boundary editor), UI kit, layouts
```

## Notes
- The Sentinel Hub integration follows the Statistical API specification, but it was not tested against live credentials. The simulated provider is used by default.
- The demo historical seasons are synthetic. Replace them with real yield records (CSV import on the Yield models page) and retrain before using forecasts in practice.
