import { Link } from 'react-router-dom';
import { useFetch, fmt, SeverityBadge } from '../../components/ui.jsx';

function Contours() {
  const lines = Array.from({ length: 14 }, (_, i) => i);
  return (
    <svg className="contours" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {lines.map((i) => (
        <path key={i} fill="none" stroke="#e9c46a" strokeWidth="1"
          d={`M-50 ${120 + i * 34} C 250 ${60 + i * 30}, 450 ${220 + i * 28}, 700 ${140 + i * 32} S 1100 ${80 + i * 36}, 1300 ${160 + i * 30}`} />
      ))}
    </svg>
  );
}

const STREAMS = [
  { ico: '✎', bg: '#e9c46a', title: 'Field observations', text: 'Scouting reports, pest & disease scores, soil moisture, photos' },
  { ico: '◎', bg: '#5fb3b9', title: 'Satellite imagery', text: 'Sentinel-2 NDVI, NDWI & EVI every 5 days, cloud-filtered' },
  { ico: '☁', bg: '#8bc34a', title: 'Environmental data', text: 'Daily rainfall, temperature, humidity & evapotranspiration' },
];

export default function Home() {
  const { data: stats } = useFetch('/public/stats');
  const { data: advisories } = useFetch('/public/advisories');
  return (
    <>
      <section className="hero">
        <Contours />
        <div className="container">
          <div>
            <div className="eyebrow">Agricultural decision intelligence</div>
            <h1>Every field, seen from the <em>ground</em>, the <em>sky</em> and the <em>weather</em>.</h1>
            <p className="lead">AgriSense fuses what farmers observe, what satellites measure and what the climate is doing into clear, explainable recommendations — when to irrigate, where pests are likely, and what yield to expect.</p>
            <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
              <Link to="/register" className="btn wheat lg">Start monitoring free</Link>
              <Link to="/platform" className="btn lg" style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.3)' }}>See how it works</Link>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            {STREAMS.map((s) => (
              <div className="stream-card" key={s.title}>
                <div className="ico" style={{ background: s.bg, color: '#1f3b2d' }}>{s.ico}</div>
                <div><h4>{s.title}</h4><p>{s.text}</p></div>
                <span style={{ color: '#e9c46a', fontSize: '1.2rem' }}>→</span>
              </div>
            ))}
            <div className="stream-card" style={{ background: 'rgba(233,196,106,.14)', borderColor: 'rgba(233,196,106,.4)' }}>
              <div className="ico" style={{ background: '#fff', color: '#1f3b2d' }}>✦</div>
              <div><h4>AI decision engine</h4><p>Crop health · irrigation · pest & disease risk · yield forecast</p></div>
              <span />
            </div>
          </div>
        </div>
      </section>

      <section className="stats-band">
        <div className="container">
          <div><div className="num">{fmt.num(stats?.hectares)}</div><div className="lbl">hectares monitored</div></div>
          <div><div className="num">{fmt.num(stats?.observations, 0)}</div><div className="lbl">field observations</div></div>
          <div><div className="num">{fmt.num(stats?.satellite_scenes, 0)}</div><div className="lbl">satellite scenes analysed</div></div>
          <div><div className="num">{fmt.num(stats?.decisions, 0)}</div><div className="lbl">AI decisions delivered</div></div>
        </div>
      </section>

      <section className="section-pad">
        <div className="container">
          <div className="eyebrow">How it works</div>
          <h2 style={{ fontSize: '2rem', maxWidth: 640 }}>From scattered data to one decision you can act on today.</h2>
          <div className="pipeline" style={{ marginTop: 32 }}>
            <div><h3>Observe</h3><p className="muted">Farmers and extension officers log scouting visits from any phone — pest and disease scores, soil moisture, photos with GPS.</p></div>
            <div><h3>Sense</h3><p className="muted">Sentinel-2 imagery is clipped to each field boundary and converted to vegetation indices; daily weather is pulled for the field centroid.</p></div>
            <div><h3>Fuse</h3><p className="muted">All streams are aligned day by day. A soil-water balance model runs on the weather and is corrected by ground-truth readings.</p></div>
            <div><h3>Decide</h3><p className="muted">Models score crop health, irrigation need, pest & disease risk and yield — each recommendation shows the evidence behind it.</p></div>
          </div>
        </div>
      </section>

      <section style={{ paddingBottom: '4rem' }}>
        <div className="container grid cols-3">
          {[
            ['💧', 'Irrigation scheduling', 'FAO-56 water balance projects root-zone depletion 7 days ahead using the forecast, and tells you how many millimetres to apply.'],
            ['🐛', 'Pest & disease early warning', 'Leaf-wetness and temperature windows combined with your own scouting scores flag outbreaks before they spread.'],
            ['🛰', 'Canopy anomaly detection', 'NDVI is compared against the expected crop curve for each growth stage, so sudden declines stand out immediately.'],
            ['🌾', 'Yield forecasting', 'Ridge-regression models trained on historical seasons project end-of-season yield with an uncertainty range.'],
            ['🔔', 'Prioritised alerts', 'High-priority recommendations become alerts that can be acknowledged and resolved by the farm team.'],
            ['📊', 'Reports & exports', 'Farm season reports and the full integrated daily dataset export to CSV for research and planning.'],
          ].map(([ico, t, d]) => (
            <div className="feature" key={t}><div className="ico">{ico}</div><h3>{t}</h3><p className="muted" style={{ margin: 0 }}>{d}</p></div>
          ))}
        </div>
      </section>

      <section style={{ paddingBottom: '4rem' }}>
        <div className="container">
          <div className="card-head"><div><div className="eyebrow">Latest advisories</div><h2 style={{ margin: 0 }}>From our agronomists</h2></div><Link to="/advisories">All advisories →</Link></div>
          <div className="grid cols-3">
            {(advisories || []).slice(0, 3).map((a) => (
              <div key={a.id} className={`advisory ${a.severity}`}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}><SeverityBadge level={a.severity} />{a.crop && <span className="badge soil">{a.crop}</span>}</div>
                <h4>{a.title}</h4>
                <p className="small muted" style={{ margin: 0 }}>{a.body.slice(0, 150)}{a.body.length > 150 ? '…' : ''}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="container">
          <div className="cta">
            <div><h2 style={{ margin: 0 }}>Map your first field in two minutes.</h2><p style={{ margin: '0.3rem 0 0' }}>Draw the boundary, choose the crop — weather, satellite and AI analysis start automatically.</p></div>
            <Link to="/register" className="btn lg">Create a free account</Link>
          </div>
        </div>
      </section>
    </>
  );
}
