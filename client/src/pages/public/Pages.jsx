import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useFetch, fmt, SeverityBadge, Input, Select, TextArea, ErrorBox, Loader, Empty, CROP_OPTIONS, today } from '../../components/ui.jsx';

export function Platform() {
  const { data: crops } = useFetch('/public/crops');
  return (
    <div className="container section-pad">
      <div className="eyebrow">The platform</div>
      <h1 style={{ fontSize: '2.6rem', maxWidth: 760 }}>Three data streams. One integrated picture of every field.</h1>
      <p className="muted" style={{ maxWidth: 700, fontSize: '1.05rem' }}>Each source alone is incomplete: satellites miss what happens under clouds, weather stations don't see pests, and scouts can't visit every hectare every day. AgriSense aligns them on a single daily timeline per field and lets each fill the others' gaps.</p>
      <div className="grid cols-3" style={{ marginTop: 32 }}>
        <div className="feature"><span className="badge yellow">Ground truth</span><h3 style={{ marginTop: 10 }}>Field observations</h3><p className="muted">Crop stage, plant height, canopy cover, pest & disease type and severity (0–5), weed pressure, soil moisture, leaf colour, GPS and photos. Bulk import from ODK/KoboToolbox CSV.</p><p className="small"><strong>Used for:</strong> resetting the soil-water model, biotic stress in the health index, pest/disease risk, and validating satellite anomalies.</p></div>
        <div className="feature"><span className="badge blue">Remote sensing</span><h3 style={{ marginTop: 10 }}>Satellite indices</h3><p className="muted">Sentinel-2 L2A statistics over each field polygon: NDVI (vigour), NDWI (canopy water), EVI and SAVI, with cloud masking from the scene classification layer. CSV and raw-band import supported.</p><p className="small"><strong>Used for:</strong> canopy vigour vs. expected phenology, anomaly detection, yield model features.</p></div>
        <div className="feature"><span className="badge green">Environment</span><h3 style={{ marginTop: 10 }}>Weather & climate</h3><p className="muted">Daily max/min/mean temperature, rainfall, humidity, wind, solar radiation and FAO reference evapotranspiration (ET₀) from Open-Meteo, plus on-farm rain gauge entries and a 7-day forecast.</p><p className="small"><strong>Used for:</strong> water balance, growing degree days, leaf-wetness disease windows, pest temperature windows.</p></div>
      </div>

      <h2 style={{ marginTop: 56 }}>The AI decision engine</h2>
      <div className="card">
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Model</th><th>Method</th><th>Inputs</th><th>Output</th></tr></thead>
          <tbody>
            <tr><td><strong>Crop health index</strong></td><td>Weighted, explainable score</td><td>NDVI vs. stage-expected curve, NDWI, water-stress coefficient Ks, pest/disease index</td><td>0–100 score + class + factor breakdown</td></tr>
            <tr><td><strong>Irrigation scheduler</strong></td><td>FAO-56 root-zone soil-water balance</td><td>ET₀, crop coefficient Kc by stage, rainfall, irrigation log, soil FC/WP, observed soil moisture, forecast</td><td>Depletion, days-to-stress, net & gross mm to apply</td></tr>
            <tr><td><strong>Pest & disease risk</strong></td><td>Logistic risk model</td><td>Favourable wet days, temperature windows, dry spells, scouting severity, stage susceptibility</td><td>Probability 0–1, level, likely organisms</td></tr>
            <tr><td><strong>Canopy anomaly</strong></td><td>Residual z-score vs. phenology</td><td>Cloud-free NDVI series, expected crop curve</td><td>Anomaly flag + reason</td></tr>
            <tr><td><strong>Yield forecast</strong></td><td>Ridge regression, 5-fold CV, per crop</td><td>Season mean/peak NDVI, cumulative rain, GDD, pest & disease pressure (projected to season end)</td><td>t/ha with 95% interval + feature contributions</td></tr>
          </tbody>
        </table></div>
      </div>

      <h2 style={{ marginTop: 56 }}>Supported crops</h2>
      <div className="grid cols-3">
        {(crops || []).map((c) => (
          <div className="card" key={c.key} style={{ marginTop: 0 }}>
            <h3>{c.label}</h3>
            <p className="small muted">{c.seasonDays}-day season · Kc {c.kc.ini}/{c.kc.mid}/{c.kc.end} · typical {c.typicalYield} t/ha</p>
            <p className="small" style={{ margin: 0 }}><strong>Pests:</strong> {c.pests.join(', ')}<br /><strong>Diseases:</strong> {c.diseases.join(', ')}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Tools() {
  const [bands, setBands] = useState({ B2: '0.04', B3: '0.07', B4: '0.05', B8: '0.42', B11: '0.21' });
  const [idx, setIdx] = useState(null); const [idxErr, setIdxErr] = useState(null);
  const [w, setW] = useState({ crop: 'maize', planting_date: new Date(Date.now() - 50 * 864e5).toISOString().slice(0, 10), latitude: '8.48', temp_max: '31', temp_min: '23', date: today() });
  const [wn, setWn] = useState(null); const [wnErr, setWnErr] = useState(null);
  const calcIdx = async (e) => { e.preventDefault(); setIdxErr(null); try { setIdx(await api.post('/public/tools/indices', bands)); } catch (er) { setIdxErr(er.message); } };
  const calcW = async (e) => { e.preventDefault(); setWnErr(null); try { setWn(await api.post('/public/tools/water-need', w)); } catch (er) { setWnErr(er.message); } };
  const bind = (s, set) => (k) => ({ value: s[k], onChange: (e) => set({ ...s, [k]: e.target.value }) });
  const b = bind(bands, setBands), ww = bind(w, setW);
  return (
    <div className="container section-pad">
      <div className="eyebrow">Free tools</div>
      <h1 style={{ fontSize: '2.4rem' }}>Agronomy calculators</h1>
      <p className="muted">The same formulas that power the platform, free to use without an account.</p>
      <div className="grid cols-2" style={{ marginTop: 24, alignItems: 'start' }}>
        <form className="card" onSubmit={calcIdx}>
          <h3>Vegetation index calculator</h3>
          <p className="small muted">Enter Sentinel-2 surface reflectances (0–1).</p>
          <ErrorBox error={idxErr} />
          <div className="form-grid">
            <Input label="B2 – Blue" type="number" step="0.001" {...b('B2')} />
            <Input label="B3 – Green" type="number" step="0.001" {...b('B3')} />
            <Input label="B4 – Red *" type="number" step="0.001" required {...b('B4')} />
            <Input label="B8 – NIR *" type="number" step="0.001" required {...b('B8')} />
            <Input label="B11 – SWIR" type="number" step="0.001" {...b('B11')} />
          </div>
          <div className="form-actions"><button className="btn">Calculate</button></div>
          {idx && (
            <div className="grid cols-3" style={{ marginTop: 12 }}>
              {['ndvi', 'evi', 'savi', 'ndwi', 'gndvi'].map((k) => <div key={k} className="stat"><div className="label">{k}</div><div className="value">{idx[k] ?? '–'}</div></div>)}
              <div className="stat" style={{ '--accent': 'var(--wheat)' }}><div className="label">Reading</div><div className="sub" style={{ color: 'var(--ink)', marginTop: 6 }}>{idx.interpretation}</div></div>
            </div>
          )}
        </form>
        <form className="card" onSubmit={calcW}>
          <h3>Crop water need estimator</h3>
          <p className="small muted">FAO-56 Hargreaves ET₀ × crop coefficient for today's growth stage.</p>
          <ErrorBox error={wnErr} />
          <div className="form-grid">
            <Select label="Crop" options={CROP_OPTIONS} {...ww('crop')} />
            <Input label="Planting date" type="date" {...ww('planting_date')} />
            <Input label="Date" type="date" {...ww('date')} />
            <Input label="Latitude" type="number" step="0.01" {...ww('latitude')} />
            <Input label="Max temp °C" type="number" step="0.1" {...ww('temp_max')} />
            <Input label="Min temp °C" type="number" step="0.1" {...ww('temp_min')} />
          </div>
          <div className="form-actions"><button className="btn">Estimate</button></div>
          {wn && (
            <div className="grid cols-3" style={{ marginTop: 12 }}>
              <div className="stat"><div className="label">Stage</div><div className="value" style={{ fontSize: '1.1rem' }}>{wn.stage}</div><div className="sub">day {wn.days_after_planting}</div></div>
              <div className="stat"><div className="label">ET₀</div><div className="value">{wn.et0_mm}</div><div className="sub">mm/day · Kc {wn.kc}</div></div>
              <div className="stat" style={{ '--accent': 'var(--sky)' }}><div className="label">Crop need</div><div className="value">{wn.etc_mm_day}</div><div className="sub">mm/day · {fmt.num(wn.litres_per_ha_day, 0)} L/ha</div></div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

export function Advisories() {
  const [crop, setCrop] = useState('');
  const { data, loading } = useFetch(`/public/advisories${crop ? `?crop=${crop}` : ''}`, [crop]);
  return (
    <div className="container section-pad">
      <div className="eyebrow">Public advisories</div>
      <div className="page-head"><h1 style={{ fontSize: '2.4rem' }}>Crop advisories</h1>
        <div className="toolbar"><select value={crop} onChange={(e) => setCrop(e.target.value)}><option value="">All crops</option>{CROP_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
      </div>
      {loading ? <Loader /> : !data?.length ? <Empty>No advisories published yet.</Empty> : (
        <div className="grid" style={{ gap: 14 }}>
          {data.map((a) => (
            <article key={a.id} className={`advisory ${a.severity}`}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                <SeverityBadge level={a.severity} />{a.crop && <span className="badge soil">{a.crop}</span>}{a.region && <span className="badge">{a.region}</span>}
                <span className="small muted" style={{ marginLeft: 'auto' }}>{fmt.date(a.created_at)}</span>
              </div>
              <h3>{a.title}</h3>
              <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{a.body}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function About() {
  return (
    <div className="container section-pad" style={{ maxWidth: 820 }}>
      <div className="eyebrow">About</div>
      <h1 style={{ fontSize: '2.4rem' }}>Why integrate field, satellite and environmental data?</h1>
      <p style={{ fontSize: '1.08rem' }}>Smallholder farms produce most of the food in West Africa, yet decisions about irrigation, crop protection and harvest are often made with little timely information. Free Earth-observation and weather data now cover every field on the planet — but on their own they are hard to interpret and easy to misread.</p>
      <p>AgriSense was built to close that gap. Ground observations anchor satellite and weather signals to what is actually happening in the field, while remote data extends a single scouting visit across space and time. The result is decision support that is <strong>timely</strong>, <strong>explainable</strong> and <strong>grounded</strong>.</p>
      <h3 style={{ marginTop: 32 }}>Principles</h3>
      <ul>
        <li><strong>Explainable by design</strong> — every score shows the factors and data sources behind it.</li>
        <li><strong>Works offline-first</strong> — when live services are unavailable the platform falls back to climatology and keeps running.</li>
        <li><strong>Open science</strong> — FAO-56 methods, Copernicus Sentinel-2 and Open-Meteo data; integrated datasets export to CSV.</li>
        <li><strong>Farmer-owned data</strong> — farmers only see their own farms; agronomists support across farms.</li>
      </ul>
      <div className="cta" style={{ marginTop: 32 }}><h3 style={{ margin: 0 }}>Partner with us</h3><Link to="/contact" className="btn">Get in touch</Link></div>
    </div>
  );
}

export function Contact() {
  const [v, setV] = useState({ name: '', email: '', subject: '', message: '' });
  const [status, setStatus] = useState(null); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { const r = await api.post('/public/contact', v); setStatus(r.message); setV({ name: '', email: '', subject: '', message: '' }); }
    catch (er) { setErr(er.message); } finally { setBusy(false); }
  };
  const bind = (k) => ({ value: v[k], onChange: (e) => setV({ ...v, [k]: e.target.value }) });
  return (
    <div className="container section-pad" style={{ maxWidth: 760 }}>
      <div className="eyebrow">Contact</div>
      <h1 style={{ fontSize: '2.4rem' }}>Talk to our team</h1>
      <p className="muted">Questions about the platform, partnerships with cooperatives or research institutes, or a demo for your organisation.</p>
      <form className="card" onSubmit={submit}>
        {status && <div className="success-box">{status}</div>}
        <ErrorBox error={err} />
        <div className="form-grid">
          <Input label="Your name" required {...bind('name')} />
          <Input label="Email" type="email" required {...bind('email')} />
          <Input label="Subject" className="span-all" {...bind('subject')} />
          <TextArea label="Message" className="span-all" required minLength={10} {...bind('message')} />
        </div>
        <div className="form-actions"><button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Send message'}</button></div>
      </form>
    </div>
  );
}

const DEMO = [['Admin', 'admin@agrisense.local', 'Admin@123'], ['Agronomist', 'agronomist@agrisense.local', 'Agro@1234'], ['Farmer', 'farmer@agrisense.local', 'Farmer@123']];

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate(); const loc = useLocation();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await login(email, password); nav(loc.state?.from || '/app', { replace: true }); } catch (er) { setErr(er.message); } finally { setBusy(false); }
  };
  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <h2>Sign in</h2>
        <p className="muted small">Welcome back to AgriSense.</p>
        <ErrorBox error={err} />
        <div className="grid">
          <Input label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <Input label="Password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          <button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </div>
        <p className="small" style={{ marginTop: 14 }}>No account? <Link to="/register">Create one</Link></p>
        <div className="demo-logins"><strong>Demo accounts:</strong>{DEMO.map(([r, e, p]) => <div key={e}>{r}: <button type="button" onClick={() => { setEmail(e); setPassword(p); }}>{e}</button></div>)}</div>
      </form>
    </div>
  );
}

export function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [v, setV] = useState({ name: '', email: '', password: '', phone: '', organization: '' });
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const bind = (k) => ({ value: v[k], onChange: (e) => setV({ ...v, [k]: e.target.value }) });
  const submit = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await register(v); nav('/app/farms?new=1'); } catch (er) { setErr(er.message); } finally { setBusy(false); }
  };
  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <h2>Create your account</h2>
        <p className="muted small">Free for farmers and cooperatives.</p>
        <ErrorBox error={err} />
        <div className="grid">
          <Input label="Full name" required {...bind('name')} />
          <Input label="Email" type="email" required {...bind('email')} />
          <Input label="Password (min. 8 characters)" type="password" required minLength={8} {...bind('password')} />
          <Input label="Phone (optional)" {...bind('phone')} />
          <Input label="Farm / organisation (optional)" {...bind('organization')} />
          <button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        </div>
        <p className="small" style={{ marginTop: 14 }}>Already registered? <Link to="/login">Sign in</Link></p>
      </form>
    </div>
  );
}
