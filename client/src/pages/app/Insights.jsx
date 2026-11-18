import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Legend } from 'recharts';
import { api } from '../../api/client.js';
import { useFetch, Loader, ErrorBox, PageHead, HealthBadge, RiskMeter, fmt, Empty } from '../../components/ui.jsx';

const CAT_COLOR = { water: '#2a7f86', disease: '#8a5a0e', pest: '#b5402f', anomaly: '#b5402f', health: '#b5402f', nutrition: '#4e8f3a', harvest: '#e9c46a', data: '#7c8680', yield: '#c7841b', general: '#4e8f3a' };
const PRIORITY = { 1: 'Urgent', 2: 'Soon', 3: 'Plan', 4: 'Info' };
const SOURCE_BADGE = { satellite: 'blue', 'field observations': 'yellow', 'weather + soil model': 'green' };

export function Recommendations({ recs }) {
  return recs.map((r, i) => (
    <div className="rec" key={i}>
      <div className="bar" style={{ background: CAT_COLOR[r.category] || '#999' }} />
      <div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
          <span className={`badge ${r.priority === 1 ? 'red' : r.priority === 2 ? 'yellow' : 'green'}`}>{PRIORITY[r.priority]}</span>
          <span className="badge">{r.category}</span>
        </div>
        <h4>{r.title}</h4>
        <div style={{ fontSize: '0.92rem' }}>{r.action}</div>
        {r.evidence?.length > 0 && <ul>{r.evidence.map((e, j) => <li key={j}>{e}</li>)}</ul>}
      </div>
    </div>
  ));
}

export function DecisionPanel({ field, autoRun, onRan }) {
  const { data: history, reload: reloadHistory } = useFetch(`/ai/fields/${field.id}/decisions?limit=30`);
  const [decision, setDecision] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const latestId = field.latest_decision?.id;
    if (autoRun) { run(); return; }
    if (latestId) api.get(`/ai/decisions/${latestId}`).then(setDecision).catch((e) => setErr(e.message)).finally(() => setLoading(false));
    else setLoading(false);
  }, [field.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run() {
    setBusy(true); setErr(null);
    try {
      const { decision: d } = await api.post(`/ai/fields/${field.id}/decide`, {});
      setDecision(d); reloadHistory(); onRan?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); setLoading(false); }
  }

  if (loading || (busy && !decision)) return <Loader text="Refreshing weather & satellite data and running models…" />;
  const ex = decision?.explanation;
  return (
    <>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <span className="small muted">{decision ? `Last analysis ${fmt.dateTime(decision.generated_at)}` : 'Not analysed yet'}</span>
        <span className="spacer" />
        <button className="btn" onClick={run} disabled={busy}>{busy ? 'Analysing…' : '✦ Run AI analysis'}</button>
      </div>
      <ErrorBox error={err} />
      {!decision ? <div className="card"><Empty>Run the analysis to generate recommendations.</Empty></div> : (
        <>
          <div className="grid cols-4">
            <div className="stat"><div className="label">Crop health</div><div className="value">{fmt.num(decision.health_score, 0)}</div><HealthBadge cls={decision.health_class} /></div>
            <div className="stat" style={{ '--accent': 'var(--sky)' }}><div className="label">Irrigation advice</div><div className="value">{decision.irrigation_mm > 0 ? `${fmt.num(decision.irrigation_mm, 0)} mm` : 'None'}</div><div className="sub">{ex.irrigation.urgency !== 'none' ? `${ex.irrigation.urgency} urgency` : `depletion ${ex.irrigation.depletion_mm} / ${ex.irrigation.raw_mm} mm RAW`}</div></div>
            <div className="stat" style={{ '--accent': 'var(--wheat)' }}><div className="label">Yield forecast</div><div className="value">{decision.predicted_yield ? fmt.num(decision.predicted_yield, 2) : '–'}<span style={{ fontSize: '0.9rem' }}> t/ha</span></div><div className="sub">95% range {fmt.num(decision.yield_low, 2)}–{fmt.num(decision.yield_high, 2)}</div></div>
            <div className="stat" style={{ '--accent': decision.anomaly ? 'var(--danger)' : 'var(--leaf)' }}><div className="label">Canopy anomaly</div><div className="value" style={{ fontSize: '1.3rem' }}>{decision.anomaly ? 'Detected' : 'None'}</div><div className="sub">{ex.anomaly.reason}</div></div>
          </div>

          <div className="grid cols-3" style={{ marginTop: 16 }}>
            <div className="card" style={{ gridColumn: 'span 2', marginTop: 0 }}>
              <div className="card-head"><h3>Recommendations</h3><span className="small muted">{decision.crop_stage} · day {decision.days_after_planting}</span></div>
              <Recommendations recs={decision.recommendations} />
            </div>
            <div className="card" style={{ marginTop: 0 }}>
              <h3>Why this health score?</h3>
              {ex.health.factors.map((f) => (
                <div key={f.factor} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.86rem' }}>
                    <span>{f.factor}</span><strong>{Math.round(f.score * 100)}%</strong>
                  </div>
                  <div className="meter" style={{ margin: '4px 0' }}><span style={{ width: `${f.score * 100}%`, background: f.score > 0.75 ? 'var(--leaf)' : f.score > 0.5 ? 'var(--warn)' : 'var(--danger)' }} /></div>
                  <div className="small muted"><span className={`badge ${SOURCE_BADGE[f.source] || ''}`} style={{ fontSize: '0.68rem' }}>{f.source}</span> weight {f.weight} · {f.detail}</div>
                </div>
              ))}
              <h3 style={{ marginTop: 18 }}>Risk outlook</h3>
              <div className="grid" style={{ gap: 12 }}>
                <RiskMeter label={`Pest — ${ex.risk.pest.likely.join(', ')}`} value={ex.risk.pest.risk} />
                <RiskMeter label={`Disease — ${ex.risk.disease.likely.join(', ')}`} value={ex.risk.disease.risk} />
              </div>
            </div>
          </div>

          <div className="grid cols-2" style={{ marginTop: 16 }}>
            <div className="card" style={{ marginTop: 0 }}>
              <h3>7-day soil-water projection</h3>
              <p className="small muted">{ex.irrigation.action}</p>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={ex.irrigation.projection}>
                  <CartesianGrid stroke="#eee" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} fontSize={11} />
                  <YAxis yAxisId="d" reversed fontSize={11} />
                  <YAxis yAxisId="r" orientation="right" fontSize={11} />
                  <Tooltip /><Legend />
                  <Bar yAxisId="r" dataKey="rainfall_mm" name="Forecast rain" fill="#5fb3b9" />
                  <Line yAxisId="d" dataKey="depletion_mm" name="Depletion (mm)" stroke="#8b5e3c" strokeWidth={2} />
                  <ReferenceLine yAxisId="d" y={ex.irrigation.raw_mm} stroke="#c7841b" strokeDasharray="4 3" label={{ value: 'stress threshold', fontSize: 10, fill: '#c7841b' }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="card" style={{ marginTop: 0 }}>
              <h3>Yield forecast drivers</h3>
              {ex.yield ? (
                <>
                  <p className="small muted">{ex.yield.method}{ex.yield.cvR2 ? ` · cross-validated R² ${ex.yield.cvR2}` : ''} · season {Math.round(ex.yield.progress * 100)}% complete · vigour ratio {ex.yield.vigourRatio}</p>
                  {(ex.yield.contributions || []).map((c) => (
                    <div key={c.feature} style={{ display: 'grid', gridTemplateColumns: '170px 1fr 70px', gap: 8, alignItems: 'center', fontSize: '0.85rem', marginBottom: 6 }}>
                      <span>{c.feature}</span>
                      <div style={{ display: 'flex', justifyContent: c.contribution >= 0 ? 'flex-start' : 'flex-end', background: '#f3efe4', borderRadius: 4, height: 10, position: 'relative' }}>
                        <span style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#bbb' }} />
                        <span style={{ height: '100%', width: `${Math.min(50, Math.abs(c.contribution) * 25)}%`, marginLeft: c.contribution >= 0 ? '50%' : 0, marginRight: c.contribution < 0 ? '50%' : 0, background: c.contribution >= 0 ? 'var(--leaf)' : 'var(--danger)', borderRadius: 4 }} />
                      </div>
                      <span className="mono" style={{ textAlign: 'right' }}>{c.contribution > 0 ? '+' : ''}{c.contribution}</span>
                    </div>
                  ))}
                  {!ex.yield.contributions?.length && <p className="small">Heuristic estimate (no trained model for this crop yet).</p>}
                </>
              ) : <Empty>Crop not yet planted.</Empty>}
            </div>
          </div>

          <div className="grid cols-2" style={{ marginTop: 16 }}>
            <div className="card" style={{ marginTop: 0 }}>
              <h3>Weather forecast</h3>
              <table className="table"><thead><tr><th>Date</th><th>Max/Min °C</th><th>Rain</th><th>RH</th><th>ET₀</th></tr></thead>
                <tbody>{ex.forecast.map((f) => <tr key={f.date}><td>{fmt.date(f.date)}</td><td>{f.temp_max} / {f.temp_min}</td><td>{f.rainfall_mm} mm</td><td>{f.humidity_pct ?? '–'}%</td><td>{f.et0_mm}</td></tr>)}</tbody></table>
              <p className="small muted">Source: {[...new Set(ex.forecast.map((f) => f.source))].join(', ')}</p>
            </div>
            <div className="card" style={{ marginTop: 0 }}>
              <h3>Health history</h3>
              {history?.length > 1 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={[...history].reverse().map((h) => ({ ...h, t: fmt.dateTime(h.generated_at) }))}>
                    <CartesianGrid stroke="#eee" vertical={false} />
                    <XAxis dataKey="t" fontSize={10} minTickGap={30} />
                    <YAxis domain={[0, 100]} fontSize={11} />
                    <Tooltip />
                    <Line dataKey="health_score" name="Health" stroke="#4e8f3a" strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : <Empty>History builds up as the analysis runs daily.</Empty>}
              <p className="small muted">Data quality: weather {fmt.pct(ex.dataQuality.coverage.weather)}, satellite {fmt.pct(ex.dataQuality.coverage.satellite)} coverage · last scene {ex.dataQuality.sceneAgeDays ?? '–'} d ago · last observation {ex.dataQuality.observationAgeDays ?? '–'} d ago</p>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default function Insights() {
  const nav = useNavigate();
  const { data, loading, error, reload } = useFetch('/ai/decisions');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const runAll = async () => {
    setBusy(true); setMsg(null);
    try { const r = await api.post('/ai/run-all', {}); setMsg(`Analysed ${r.processed} field(s).`); reload(); } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHead title="AI insights" subtitle="Latest decision for every field, sorted by most stressed first.">
        <button className="btn" onClick={runAll} disabled={busy}>{busy ? 'Analysing all fields…' : '✦ Re-analyse all fields'}</button>
      </PageHead>
      {msg && <div className="success-box">{msg}</div>}
      <ErrorBox error={error} />
      {loading ? <Loader /> : !data?.length ? <div className="card"><Empty>No analyses yet.</Empty></div> : (
        <div className="grid cols-2">
          {data.map((d) => (
            <div className="card" key={d.id} style={{ marginTop: 0, cursor: 'pointer' }} onClick={() => nav(`/app/fields/${d.field_id}`)}>
              <div className="card-head">
                <div><h3>{d.field_name}</h3><div className="small muted">{d.farm_name} · <span style={{ textTransform: 'capitalize' }}>{d.crop}</span> · {d.crop_stage} (day {d.days_after_planting})</div></div>
                <HealthBadge cls={d.health_class} score={d.health_score} />
              </div>
              <div className="grid cols-3" style={{ gap: 10, marginBottom: 10 }}>
                <div><div className="small muted">Irrigation</div><strong>{d.irrigation_mm > 0 ? `${fmt.num(d.irrigation_mm, 0)} mm` : 'none'}</strong></div>
                <div><div className="small muted">Yield</div><strong>{d.predicted_yield ? `${fmt.num(d.predicted_yield, 2)} t/ha` : '–'}</strong></div>
                <div><div className="small muted">Anomaly</div><strong>{d.anomaly ? '⚠ yes' : 'no'}</strong></div>
              </div>
              <div className="grid cols-2" style={{ gap: 12 }}><RiskMeter label="Pest risk" value={d.pest_risk} /><RiskMeter label="Disease risk" value={d.disease_risk} /></div>
              <div style={{ marginTop: 10 }}><Recommendations recs={d.recommendations.slice(0, 2)} /></div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
