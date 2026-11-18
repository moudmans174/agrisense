import { useState } from 'react';
import { ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { api } from '../../api/client.js';
import { useFetch, Loader, ErrorBox, PageHead, Modal, Input, ConfirmButton, Empty, fmt, Stat, today, FieldPicker } from '../../components/ui.jsx';
import { ImportModal } from './Observations.jsx';

function ManualWeather({ field, onClose, onSaved }) {
  const [v, setV] = useState({ date: today(), rainfall_mm: '', temp_max: '', temp_min: '', humidity_pct: '' });
  const [err, setErr] = useState(null);
  const bind = (k) => ({ value: v[k], onChange: (e) => setV({ ...v, [k]: e.target.value }) });
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    try { await api.post(`/environment/field/${field.id}`, { ...v, source: 'rain-gauge' }); onSaved(); } catch (er) { setErr(er.message); }
  };
  return (
    <Modal title="On-farm weather reading" onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorBox error={err} />
        <div className="form-grid">
          <Input label="Date" type="date" required {...bind('date')} />
          <Input label="Rainfall (mm)" type="number" step="0.1" min="0" {...bind('rainfall_mm')} />
          <Input label="Max temp °C" type="number" step="0.1" {...bind('temp_max')} />
          <Input label="Min temp °C" type="number" step="0.1" {...bind('temp_min')} />
          <Input label="Humidity %" type="number" min="0" max="100" {...bind('humidity_pct')} />
        </div>
        <p className="small muted">ET₀ is computed automatically (Hargreaves) when temperatures are provided. Overrides the downloaded record for that date.</p>
        <div className="form-actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn">Save</button></div>
      </form>
    </Modal>
  );
}

export function EnvironmentPanel({ field }) {
  const [range, setRange] = useState(90);
  const from = new Date(Date.now() - range * 864e5).toISOString().slice(0, 10);
  const { data, loading, error, reload } = useFetch(`/environment/field/${field.id}?from=${from}`, [range]);
  const { data: forecast, loading: fl } = useFetch(`/environment/field/${field.id}/forecast?days=7`);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null); const [err, setErr] = useState(null);
  const [manual, setManual] = useState(false); const [importing, setImporting] = useState(false);
  const sync = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try { const r = await api.post(`/environment/field/${field.id}/sync`, {}); setMsg(`Synced ${r.inserted} day(s) from ${r.source} (${r.start} → ${r.end}).`); reload(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const s = data?.summary;
  return (
    <>
      <div className="card" style={{ marginTop: 0 }}>
        <div className="toolbar">
          <select value={range} onChange={(e) => setRange(Number(e.target.value))} style={{ minWidth: 140 }}>{[30, 90, 180, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select>
          <span className="spacer" />
          <button className="btn secondary sm" onClick={() => setManual(true)}>+ Rain gauge entry</button>
          <button className="btn secondary sm" onClick={() => setImporting(true)}>⤒ Import station CSV</button>
          <button className="btn" onClick={sync} disabled={busy}>{busy ? 'Syncing…' : '☁ Sync from Open-Meteo'}</button>
        </div>
        {msg && <div className="success-box" style={{ marginTop: 10 }}>{msg}</div>}
        <ErrorBox error={err || error} />
      </div>
      {loading ? <Loader /> : (
        <>
          <div className="grid cols-4" style={{ marginTop: 16 }}>
            <Stat label="Total rainfall" value={`${fmt.num(s.total_rain)} mm`} sub={`${s.rain_days ?? 0} rain days`} accent="var(--sky)" />
            <Stat label="Reference ET₀" value={`${fmt.num(s.total_et0)} mm`} sub="atmospheric water demand" accent="var(--wheat)" />
            <Stat label="Climatic water balance" value={`${fmt.num(s.water_balance)} mm`} sub="rain − ET₀" accent={s.water_balance < 0 ? 'var(--danger)' : 'var(--leaf)'} />
            <Stat label="Temperature" value={`${fmt.num(s.avg_temp)}°C`} sub={`range ${fmt.num(s.min_temp)}–${fmt.num(s.max_temp)}°C · RH ${fmt.num(s.avg_humidity, 0)}%`} accent="var(--soil)" />
          </div>
          <div className="card">
            <h3>Daily weather</h3>
            {!data.rows.length ? <Empty>No weather data — click Sync.</Empty> : (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={data.rows}>
                  <CartesianGrid stroke="#eee" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} fontSize={11} minTickGap={20} />
                  <YAxis yAxisId="r" fontSize={11} />
                  <YAxis yAxisId="t" orientation="right" fontSize={11} domain={['auto', 'auto']} />
                  <Tooltip /><Legend />
                  <Bar yAxisId="r" dataKey="rainfall_mm" name="Rain mm" fill="#5fb3b9" />
                  <Line yAxisId="r" dataKey="et0_mm" name="ET₀ mm" stroke="#8b5e3c" dot={false} />
                  <Line yAxisId="t" dataKey="temp_max" name="Max °C" stroke="#c7841b" dot={false} />
                  <Line yAxisId="t" dataKey="temp_min" name="Min °C" stroke="#2a7f86" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card" style={{ marginTop: 0 }}>
          <h3>7-day forecast</h3>
          {fl ? <Loader /> : (
            <table className="table"><thead><tr><th>Date</th><th>°C</th><th>Rain</th><th>RH</th><th>ET₀</th></tr></thead>
              <tbody>{(forecast || []).map((f) => <tr key={f.date}><td>{fmt.date(f.date)}</td><td>{f.temp_max}/{f.temp_min}</td><td>{f.rainfall_mm} mm</td><td>{f.humidity_pct ?? '–'}%</td><td>{f.et0_mm}</td></tr>)}</tbody></table>
          )}
          <p className="small muted">Source: {[...new Set((forecast || []).map((f) => f.source))].join(', ')}</p>
        </div>
        <div className="card" style={{ marginTop: 0 }}>
          <h3>Recent records</h3>
          <div className="table-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}>
            <table className="table"><thead><tr><th>Date</th><th>Source</th><th>Rain</th><th>°C</th><th /></tr></thead>
              <tbody>{[...(data?.rows || [])].reverse().slice(0, 40).map((r) => (
                <tr key={r.id}><td>{fmt.date(r.date)}</td><td><span className={`badge ${r.source === 'open-meteo' ? 'green' : r.source === 'simulated' ? '' : 'yellow'}`}>{r.source}</span></td><td>{r.rainfall_mm}</td><td>{r.temp_max}/{r.temp_min}</td>
                  <td><ConfirmButton className="btn ghost sm" onConfirm={async () => { await api.del(`/environment/${r.id}`); reload(); }}>✕</ConfirmButton></td></tr>))}
              </tbody></table>
          </div>
        </div>
      </div>
      {manual && <ManualWeather field={field} onClose={() => setManual(false)} onSaved={() => { setManual(false); reload(); }} />}
      {importing && <ImportModal title="Import weather station data" fieldId={field.id} onClose={() => setImporting(false)} onDone={reload}
        endpoint={(fid) => `/environment/field/${fid}/import`} template="date, temp_max, temp_min, rainfall_mm, humidity_pct, wind_speed, solar_rad, et0_mm" />}
    </>
  );
}

export default function Environment() {
  const { data: fields } = useFetch('/fields');
  const [fieldId, setFieldId] = useState('');
  const field = fields?.find((f) => String(f.id) === String(fieldId));
  return (
    <>
      <PageHead title="Weather & climate" subtitle="Daily environmental data per field, from Open-Meteo, station uploads or rain gauges.">
        <FieldPicker fields={fields} value={fieldId} onChange={setFieldId} />
      </PageHead>
      {!field ? <div className="card"><Empty>Select a field to view weather data.</Empty>{fields?.length > 0 && <div style={{ textAlign: 'center' }}><button className="btn" onClick={() => setFieldId(fields[0].id)}>Open {fields[0].name}</button></div>}</div> : <EnvironmentPanel key={field.id} field={field} />}
    </>
  );
}
