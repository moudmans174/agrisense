import { useState } from 'react';
import { ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { api } from '../../api/client.js';
import { useFetch, Loader, ErrorBox, PageHead, Modal, Input, ConfirmButton, Empty, fmt, Stat, today, FieldPicker } from '../../components/ui.jsx';
import { ImportModal } from './Observations.jsx';

function ManualScene({ field, onClose, onSaved }) {
  const [mode, setMode] = useState('indices');
  const [v, setV] = useState({ acquired_on: today(), ndvi: '', ndwi: '', evi: '', cloud_cover: '', B2: '', B3: '', B4: '', B8: '', B11: '' });
  const [err, setErr] = useState(null);
  const bind = (k) => ({ value: v[k], onChange: (e) => setV({ ...v, [k]: e.target.value }) });
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    const body = mode === 'indices'
      ? { acquired_on: v.acquired_on, ndvi: v.ndvi, ndwi: v.ndwi, evi: v.evi, cloud_cover: v.cloud_cover, source: 'manual' }
      : { acquired_on: v.acquired_on, B2: v.B2 || undefined, B3: v.B3 || undefined, B4: v.B4, B8: v.B8, B11: v.B11 || undefined, cloud_cover: v.cloud_cover, source: 'manual-bands' };
    try { await api.post(`/satellite/field/${field.id}`, body); onSaved(); } catch (er) { setErr(er.message); }
  };
  return (
    <Modal title="Add satellite / drone reading" onClose={onClose}>
      <div className="tabs"><button className={mode === 'indices' ? 'active' : ''} onClick={() => setMode('indices')}>Index values</button><button className={mode === 'bands' ? 'active' : ''} onClick={() => setMode('bands')}>Band reflectances</button></div>
      <form onSubmit={submit}>
        <ErrorBox error={err} />
        <div className="form-grid">
          <Input label="Acquisition date" type="date" required {...bind('acquired_on')} />
          <Input label="Cloud cover %" type="number" min="0" max="100" {...bind('cloud_cover')} />
          {mode === 'indices' ? <>
            <Input label="NDVI *" type="number" step="0.0001" min="-1" max="1" required {...bind('ndvi')} />
            <Input label="NDWI" type="number" step="0.0001" min="-1" max="1" {...bind('ndwi')} />
            <Input label="EVI" type="number" step="0.0001" min="-1" max="1" {...bind('evi')} />
          </> : <>
            <Input label="B2 Blue" type="number" step="0.0001" {...bind('B2')} />
            <Input label="B3 Green" type="number" step="0.0001" {...bind('B3')} />
            <Input label="B4 Red *" type="number" step="0.0001" required {...bind('B4')} />
            <Input label="B8 NIR *" type="number" step="0.0001" required {...bind('B8')} />
            <Input label="B11 SWIR" type="number" step="0.0001" {...bind('B11')} />
          </>}
        </div>
        <div className="form-actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn">Save</button></div>
      </form>
    </Modal>
  );
}

export function SatellitePanel({ field }) {
  const [maxCloud, setMaxCloud] = useState('100');
  const { data, loading, error, reload } = useFetch(`/satellite/field/${field.id}?max_cloud=${maxCloud}`, [maxCloud]);
  const { data: providers } = useFetch('/satellite/providers');
  const [fetchState, setFetchState] = useState({ provider: 'simulated', start: '', end: '' });
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null); const [err, setErr] = useState(null);
  const [manual, setManual] = useState(false); const [importing, setImporting] = useState(false);
  const fetchScenes = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await api.post(`/satellite/field/${field.id}/fetch`, { provider: fetchState.provider, start: fetchState.start || undefined, end: fetchState.end || undefined });
      setMsg(`Retrieved ${r.inserted} scene(s) from ${r.provider} (${r.start} → ${r.end}).`); reload();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const scenes = data?.scenes || [];
  return (
    <>
      <div className="card" style={{ marginTop: 0 }}>
        <div className="card-head"><h3>Acquire imagery</h3>
          <div className="toolbar">
            <button className="btn secondary sm" onClick={() => setManual(true)}>+ Manual reading</button>
            <button className="btn secondary sm" onClick={() => setImporting(true)}>⤒ Import CSV</button>
          </div>
        </div>
        <div className="toolbar">
          <select value={fetchState.provider} onChange={(e) => setFetchState({ ...fetchState, provider: e.target.value })}>
            {(providers || []).map((p) => <option key={p.id} value={p.id} disabled={!p.enabled}>{p.name}{p.enabled ? '' : ' — not configured'}</option>)}
          </select>
          <input type="date" value={fetchState.start} onChange={(e) => setFetchState({ ...fetchState, start: e.target.value })} title="Start (default: planting − 20 d)" />
          <input type="date" value={fetchState.end} onChange={(e) => setFetchState({ ...fetchState, end: e.target.value })} title="End (default: today)" />
          <button className="btn" onClick={fetchScenes} disabled={busy}>{busy ? 'Fetching…' : '◎ Fetch scenes'}</button>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>{providers?.find((p) => p.id === fetchState.provider)?.note}</p>
        {msg && <div className="success-box">{msg}</div>}
        <ErrorBox error={err || error} />
      </div>
      {loading ? <Loader /> : (
        <>
          <div className="grid cols-4" style={{ marginTop: 16 }}>
            <Stat label="Scenes" value={data.summary.count} accent="var(--sky)" />
            <Stat label="Latest NDVI" value={data.summary.latest?.ndvi ?? '–'} sub={data.summary.latest ? fmt.date(data.summary.latest.acquired_on) : ''} />
            <Stat label="Season mean NDVI" value={data.summary.meanNdvi ?? '–'} />
            <Stat label="Peak NDVI" value={data.summary.maxNdvi ?? '–'} accent="var(--wheat)" />
          </div>
          <div className="card">
            <div className="card-head"><h3>Vegetation index time series</h3>
              <label className="small">Max cloud&nbsp;<select value={maxCloud} onChange={(e) => setMaxCloud(e.target.value)} style={{ width: 'auto' }}>{['100', '60', '30', '10'].map((c) => <option key={c} value={c}>{c}%</option>)}</select></label>
            </div>
            {!scenes.length ? <Empty>No scenes yet — fetch imagery above.</Empty> : (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={scenes}>
                  <CartesianGrid stroke="#eee" vertical={false} />
                  <XAxis dataKey="acquired_on" tickFormatter={(d) => d.slice(5)} fontSize={11} />
                  <YAxis yAxisId="i" domain={[-0.3, 1]} fontSize={11} />
                  <YAxis yAxisId="c" orientation="right" domain={[0, 100]} fontSize={11} />
                  <Tooltip /><Legend />
                  <Bar yAxisId="c" dataKey="cloud_cover" name="Cloud %" fill="#e4dfd2" />
                  <Line yAxisId="i" dataKey="ndvi" name="NDVI" stroke="#4e8f3a" strokeWidth={2} />
                  <Line yAxisId="i" dataKey="evi" name="EVI" stroke="#c7841b" />
                  <Line yAxisId="i" dataKey="ndwi" name="NDWI" stroke="#2a7f86" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
          {scenes.length > 0 && (
            <div className="card"><div className="table-wrap"><table className="table">
              <thead><tr><th>Date</th><th>Source</th><th>NDVI</th><th>NDWI</th><th>EVI</th><th>SAVI</th><th>LST °C</th><th>Cloud</th><th>Interpretation</th><th /></tr></thead>
              <tbody>{[...scenes].reverse().map((s) => (
                <tr key={s.id}><td>{fmt.date(s.acquired_on)}</td><td><span className="badge blue">{s.source}</span></td><td className="mono">{s.ndvi}</td><td className="mono">{s.ndwi ?? '–'}</td><td className="mono">{s.evi ?? '–'}</td><td className="mono">{s.savi ?? '–'}</td><td>{s.lst_c ?? '–'}</td><td>{s.cloud_cover ?? '–'}%</td><td className="small">{s.interpretation}</td>
                  <td><ConfirmButton className="btn ghost sm" onConfirm={async () => { await api.del(`/satellite/${s.id}`); reload(); }}>✕</ConfirmButton></td></tr>))}
              </tbody></table></div></div>
          )}
        </>
      )}
      {manual && <ManualScene field={field} onClose={() => setManual(false)} onSaved={() => { setManual(false); reload(); }} />}
      {importing && <ImportModal title="Import satellite indices" fieldId={field.id} onClose={() => setImporting(false)} onDone={reload}
        endpoint={(fid) => `/satellite/field/${fid}/import`} template="date, ndvi, ndwi, evi, savi, cloud_cover — or date, b2, b3, b4, b8, b11" />}
    </>
  );
}

export default function Satellite() {
  const { data: fields } = useFetch('/fields');
  const [fieldId, setFieldId] = useState('');
  const field = fields?.find((f) => String(f.id) === String(fieldId));
  return (
    <>
      <PageHead title="Satellite data" subtitle="Sentinel-2 vegetation indices clipped to each field boundary.">
        <FieldPicker fields={fields} value={fieldId} onChange={setFieldId} />
      </PageHead>
      {!field ? <div className="card"><Empty>Select a field to view and acquire satellite data.</Empty>{fields?.length > 0 && <div style={{ textAlign: 'center' }}><button className="btn" onClick={() => setFieldId(fields[0].id)}>Open {fields[0].name}</button></div>}</div> : <SatellitePanel key={field.id} field={field} />}
    </>
  );
}
