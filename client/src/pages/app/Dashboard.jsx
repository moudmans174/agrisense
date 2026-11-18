import { useNavigate, Link } from 'react-router-dom';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { useFetch, Loader, ErrorBox, PageHead, Stat, HealthBadge, fmt, SeverityBadge, Empty } from '../../components/ui.jsx';
import { FieldsMap } from '../../components/FieldMap.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

const HEALTH_COLORS = { Healthy: '#4e8f3a', 'Moderate stress': '#c7841b', 'High stress': '#d0603f', Critical: '#b5402f', null: '#b9b3a4' };

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { data, loading, error } = useFetch('/reports/overview');
  const { data: fields } = useFetch('/fields');
  const { data: alerts } = useFetch('/alerts?status=open');
  if (loading) return <Loader />;
  if (error) return <ErrorBox error={error} />;
  const open = data.openAlerts.reduce((s, a) => s + a.n, 0);
  const avgHealth = data.health.length ? data.health.reduce((s, h) => s + (h.avg || 0) * h.n, 0) / data.health.reduce((s, h) => s + h.n, 0) : null;
  return (
    <>
      <PageHead title={`Good day, ${user.name.split(' ')[0]}`} subtitle="Integrated view of your fields across ground, satellite and weather data.">
        <Link to="/app/insights" className="btn">✦ AI insights</Link>
      </PageHead>
      {data.totals.fields === 0 && (
        <div className="card" style={{ marginBottom: 16, background: 'var(--wheat-soft)' }}>
          <h3>Let's set up your first farm</h3>
          <p>Create a farm, then draw a field boundary. Weather and satellite data are fetched automatically and the AI engine produces its first recommendations.</p>
          <Link to="/app/farms?new=1" className="btn">Add a farm</Link>
        </div>
      )}
      <div className="grid cols-4">
        <Stat label="Fields monitored" value={data.totals.fields} sub={`${data.totals.farms} farm(s) · ${fmt.num(data.totals.area_ha)} ha`} />
        <Stat label="Average crop health" value={avgHealth !== null ? Math.round(avgHealth) : '–'} sub="0–100 integrated index" accent="var(--sky)" />
        <Stat label="Open alerts" value={open} sub={data.openAlerts.map((a) => `${a.n} ${a.severity}`).join(' · ') || 'all clear'} accent={open ? 'var(--danger)' : 'var(--leaf)'} />
        <Stat label="Observations (7 days)" value={data.totals.observations_7d} sub="ground-truth visits" accent="var(--wheat)" />
      </div>

      <div className="grid cols-3" style={{ marginTop: 16 }}>
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <div className="card-head"><h3>Field map</h3><span className="small muted">Colour = latest crop health · click a field to open</span></div>
          {fields?.length ? <FieldsMap fields={fields} onSelect={(f) => nav(`/app/fields/${f.id}`)} /> : <Empty>No fields yet.</Empty>}
        </div>
        <div className="card" style={{ marginTop: 0 }}>
          <h3>Health distribution</h3>
          {data.health.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={data.health.map((h) => ({ name: h.health_class || 'Not analysed', value: h.n }))} dataKey="value" innerRadius={60} outerRadius={95} paddingAngle={data.health.length > 1 ? 2 : 0}>
                  {data.health.map((h) => <Cell key={h.health_class} fill={HEALTH_COLORS[h.health_class]} />)}
                </Pie>
                <Legend verticalAlign="bottom" />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : <Empty>Run the AI engine to score fields.</Empty>}
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card" style={{ marginTop: 0 }}>
          <div className="card-head"><h3>Weather — last 30 days</h3><span className="small muted">average across your fields</span></div>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={data.weather30d}>
              <CartesianGrid stroke="#eee" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} fontSize={11} />
              <YAxis yAxisId="r" fontSize={11} label={{ value: 'mm', angle: -90, position: 'insideLeft', fontSize: 11 }} />
              <YAxis yAxisId="t" orientation="right" fontSize={11} domain={['auto', 'auto']} />
              <Tooltip />
              <Bar yAxisId="r" dataKey="rain" name="Rain (mm)" fill="#5fb3b9" />
              <Line yAxisId="t" dataKey="temp" name="Mean temp (°C)" stroke="#c7841b" dot={false} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="card" style={{ marginTop: 0 }}>
          <div className="card-head"><h3>Priority alerts</h3><Link to="/app/alerts" className="small">View all →</Link></div>
          {!alerts?.length ? <Empty>No open alerts 🎉</Empty> : alerts.slice(0, 5).map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '0.55rem 0', borderBottom: '1px solid #efeadf' }}>
              <SeverityBadge level={a.severity} />
              <div><div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{a.title}</div><div className="small muted">{a.message.slice(0, 110)}</div></div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h3>Fields at a glance</h3><Link to="/app/fields" className="small">Manage fields →</Link></div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Field</th><th>Crop</th><th>Stage</th><th>Health</th><th>Irrigation</th><th>Pest / disease risk</th><th>Yield forecast</th><th>Alerts</th></tr></thead>
          <tbody>
            {(fields || []).map((f) => (
              <tr key={f.id} className="clickable" onClick={() => nav(`/app/fields/${f.id}`)}>
                <td><strong>{f.name}</strong><div className="small muted">{f.farm_name}</div></td>
                <td style={{ textTransform: 'capitalize' }}>{f.crop}</td>
                <td>{f.stage} <span className="muted small">d{f.days_after_planting}</span></td>
                <td><HealthBadge cls={f.health_class} score={f.health_score} /></td>
                <td>{f.irrigation_mm > 0 ? <span className="badge blue">{fmt.num(f.irrigation_mm, 0)} mm</span> : <span className="muted">—</span>}</td>
                <td>{fmt.pct(f.pest_risk)} / {fmt.pct(f.disease_risk)}</td>
                <td>{f.predicted_yield ? `${fmt.num(f.predicted_yield, 2)} t/ha` : '–'}</td>
                <td>{f.open_alerts ? <span className="badge red">{f.open_alerts}</span> : '0'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </>
  );
}
