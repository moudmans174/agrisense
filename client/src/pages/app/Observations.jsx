import { useState } from 'react';
import { api } from '../../api/client.js';
import {
  useFetch, Loader, ErrorBox, PageHead, Modal, Input, Select, TextArea, ConfirmButton, Empty, fmt, today, FieldPicker,
} from '../../components/ui.jsx';

const STAGES = ['initial', 'development', 'mid-season', 'late-season', 'harvest-ready'];
const SEV = [0, 1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} — ${['none', 'very low', 'low', 'moderate', 'high', 'severe'][n]}` }));

function ObservationForm({ fieldId, fields, obs, onClose, onSaved }) {
  const [v, setV] = useState({
    field_id: obs?.field_id || fieldId || '', observed_at: (obs?.observed_at || new Date().toISOString()).slice(0, 16),
    crop_stage: obs?.crop_stage || '', plant_height_cm: obs?.plant_height_cm ?? '', canopy_cover_pct: obs?.canopy_cover_pct ?? '',
    pest_type: obs?.pest_type || '', pest_severity: obs?.pest_severity ?? 0, disease_type: obs?.disease_type || '', disease_severity: obs?.disease_severity ?? 0,
    weed_pressure: obs?.weed_pressure ?? 0, soil_moisture_pct: obs?.soil_moisture_pct ?? '', leaf_color: obs?.leaf_color || '',
    latitude: obs?.latitude ?? '', longitude: obs?.longitude ?? '', notes: obs?.notes || '',
  });
  const [photo, setPhoto] = useState(null);
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const bind = (k) => ({ value: v[k], onChange: (e) => setV({ ...v, [k]: e.target.value }) });
  const gps = () => navigator.geolocation?.getCurrentPosition((p) => setV((x) => ({ ...x, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) })), (e) => setErr(`GPS: ${e.message}`));
  const submit = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    const fd = new FormData();
    Object.entries(v).forEach(([k, val]) => fd.append(k, k === 'observed_at' && val ? new Date(val).toISOString() : val));
    if (photo) fd.append('photo', photo);
    try { onSaved(obs ? await api.put(`/observations/${obs.id}`, fd) : await api.post('/observations', fd)); } catch (er) { setErr(er.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={obs ? 'Edit observation' : 'New field observation'} onClose={onClose} wide>
      <form onSubmit={submit}>
        <ErrorBox error={err} />
        <div className="form-grid">
          {!fieldId && <label className="field span-2">Field<FieldPicker fields={fields} value={v.field_id} onChange={(x) => setV({ ...v, field_id: x })} /></label>}
          <Input label="Date & time" type="datetime-local" {...bind('observed_at')} />
          <Select label="Crop stage" placeholder="—" options={STAGES} {...bind('crop_stage')} />
          <Input label="Plant height (cm)" type="number" step="0.1" min="0" {...bind('plant_height_cm')} />
          <Input label="Canopy cover (%)" type="number" min="0" max="100" {...bind('canopy_cover_pct')} />
          <Input label="Pest observed" placeholder="e.g. fall armyworm" {...bind('pest_type')} />
          <Select label="Pest severity" options={SEV} {...bind('pest_severity')} />
          <Input label="Disease observed" placeholder="e.g. leaf blight" {...bind('disease_type')} />
          <Select label="Disease severity" options={SEV} {...bind('disease_severity')} />
          <Select label="Weed pressure" options={SEV} {...bind('weed_pressure')} />
          <Input label="Soil moisture (% vol.)" type="number" step="0.1" min="0" max="100" {...bind('soil_moisture_pct')} />
          <Select label="Leaf colour" placeholder="—" options={['dark green', 'green', 'light green', 'yellowing', 'purpling', 'brown / necrotic']} {...bind('leaf_color')} />
          <label className="field">Photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files[0])} /></label>
          <Input label="Latitude" type="number" step="any" {...bind('latitude')} />
          <Input label="Longitude" type="number" step="any" {...bind('longitude')} />
          <TextArea label="Notes" className="span-all" {...bind('notes')} />
        </div>
        <p className="small muted">Soil-moisture readings re-calibrate the water-balance model; pest/disease scores feed the risk and health models.</p>
        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={gps}>📍 Capture GPS</button><span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save observation'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ImportModal({ fieldId, fields, onClose, onDone, endpoint, template, title }) {
  const [fid, setFid] = useState(fieldId || ''); const [file, setFile] = useState(null);
  const [res, setRes] = useState(null); const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    const fd = new FormData(); fd.append('file', file); fd.append('field_id', fid);
    try { const r = await api.post(endpoint(fid), fd); setRes(r); onDone(); } catch (er) { setErr(er.message); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorBox error={err} />
        {res && <div className="success-box">Imported {res.inserted} row(s).{res.errors.length ? ` ${res.errors.length} row(s) skipped: ${res.errors.slice(0, 3).map((e) => `row ${e.row} (${e.error})`).join(', ')}` : ''}</div>}
        {!fieldId && <label className="field">Field<FieldPicker fields={fields} value={fid} onChange={setFid} /></label>}
        <label className="field" style={{ marginTop: 10 }}>CSV file<input type="file" accept=".csv,text/csv" required onChange={(e) => setFile(e.target.files[0])} /></label>
        <p className="small muted">Expected columns: <code>{template}</code></p>
        <div className="form-actions"><button type="button" className="btn ghost" onClick={onClose}>Close</button><button className="btn" disabled={!file || !fid}>Import</button></div>
      </form>
    </Modal>
  );
}
export { ImportModal };

export function ObservationsPanel({ fieldId, fields, onChange }) {
  const q = fieldId ? `?field_id=${fieldId}` : '';
  const { data, loading, error, reload } = useFetch(`/observations${q}`, [fieldId]);
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [photo, setPhoto] = useState(null);
  const changed = () => { reload(); onChange?.(); };
  return (
    <div className="card" style={{ marginTop: 0 }}>
      <div className="card-head"><h3>Field observations</h3>
        <div className="toolbar">
          <button className="btn secondary sm" onClick={() => setImporting(true)}>⤒ Import CSV</button>
          <button className="btn sm" onClick={() => setEditing('new')}>+ Record observation</button>
        </div>
      </div>
      <ErrorBox error={error} />
      {loading ? <Loader /> : !data?.length ? <Empty>No observations recorded yet.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>When</th>{!fieldId && <th>Field</th>}<th>Stage</th><th>Height / cover</th><th>Pest</th><th>Disease</th><th>Soil moist.</th><th>Notes</th><th></th></tr></thead>
          <tbody>{data.map((o) => (
            <tr key={o.id}>
              <td className="nowrap">{fmt.dateTime(o.observed_at)}<div className="small muted">{o.observer}</div></td>
              {!fieldId && <td>{o.field_name}<div className="small muted">{o.farm_name}</div></td>}
              <td>{o.crop_stage || '–'}</td>
              <td>{o.plant_height_cm ?? '–'} cm / {o.canopy_cover_pct ?? '–'}%</td>
              <td>{o.pest_severity > 0 ? <span className={`badge ${o.pest_severity >= 3 ? 'red' : 'yellow'}`}>{o.pest_type || 'pest'} · {o.pest_severity}</span> : '–'}</td>
              <td>{o.disease_severity > 0 ? <span className={`badge ${o.disease_severity >= 3 ? 'red' : 'yellow'}`}>{o.disease_type || 'disease'} · {o.disease_severity}</span> : '–'}</td>
              <td>{o.soil_moisture_pct !== null ? `${o.soil_moisture_pct}%` : '–'}</td>
              <td className="small" style={{ maxWidth: 260 }}>{o.notes}{o.photo_url && <div><button className="btn ghost sm" onClick={() => setPhoto(o.photo_url)}>📷 photo</button></div>}</td>
              <td className="nowrap">
                <button className="btn ghost sm" onClick={() => setEditing(o)}>Edit</button>
                <ConfirmButton className="btn ghost sm" onConfirm={async () => { await api.del(`/observations/${o.id}`); changed(); }}>✕</ConfirmButton>
              </td>
            </tr>))}
          </tbody>
        </table></div>
      )}
      {editing && <ObservationForm fieldId={fieldId} fields={fields} obs={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); changed(); }} />}
      {importing && <ImportModal title="Import observations" fieldId={fieldId} fields={fields} onClose={() => setImporting(false)} onDone={changed}
        endpoint={() => '/observations/import'} template="observed_at, crop_stage, plant_height_cm, canopy_cover_pct, pest_type, pest_severity, disease_type, disease_severity, weed_pressure, soil_moisture_pct, notes" />}
      {photo && <Modal title="Observation photo" onClose={() => setPhoto(null)}><img src={photo} alt="Field observation" style={{ width: '100%', borderRadius: 8 }} /></Modal>}
    </div>
  );
}

export function IrrigationPanel({ fieldId }) {
  const { data, loading, error, reload } = useFetch(`/observations/irrigation?field_id=${fieldId}`);
  const [v, setV] = useState({ date: today(), amount_mm: '', method: '', notes: '' });
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    try { await api.post('/observations/irrigation', { ...v, field_id: fieldId }); setV({ ...v, amount_mm: '', notes: '' }); reload(); } catch (er) { setErr(er.message); }
  };
  const bind = (k) => ({ value: v[k], onChange: (e) => setV({ ...v, [k]: e.target.value }) });
  const total = (data || []).reduce((s, x) => s + x.amount_mm, 0);
  return (
    <div className="card" style={{ marginTop: 0 }}>
      <h3>Irrigation log</h3>
      <p className="small muted">Logged irrigation is added to the soil-water balance, so the next recommendation accounts for it.</p>
      <form onSubmit={submit} className="form-grid" style={{ alignItems: 'end' }}>
        <Input label="Date" type="date" required {...bind('date')} />
        <Input label="Amount (mm)" type="number" step="0.1" min="0.1" required {...bind('amount_mm')} />
        <Select label="Method" placeholder="—" options={['drip', 'sprinkler', 'surface', 'flood', 'watering can']} {...bind('method')} />
        <Input label="Notes" {...bind('notes')} />
        <button className="btn">+ Log irrigation</button>
      </form>
      <ErrorBox error={err || error} />
      {loading ? <Loader /> : !data?.length ? <Empty>No irrigation logged.</Empty> : (
        <table className="table" style={{ marginTop: 12 }}>
          <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Notes</th><th /></tr></thead>
          <tbody>{data.map((x) => (
            <tr key={x.id}><td>{fmt.date(x.date)}</td><td>{x.amount_mm} mm</td><td>{x.method || '–'}</td><td>{x.notes}</td>
              <td><ConfirmButton className="btn ghost sm" onConfirm={async () => { await api.del(`/observations/irrigation/${x.id}`); reload(); }}>✕</ConfirmButton></td></tr>))}
            <tr><td><strong>Total</strong></td><td><strong>{fmt.num(total)} mm</strong></td><td colSpan={3} /></tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Observations() {
  const { data: fields } = useFetch('/fields');
  const [fieldId, setFieldId] = useState('');
  return (
    <>
      <PageHead title="Field observations" subtitle="Ground-truth scouting data — the anchor for satellite and weather signals.">
        <select value={fieldId} onChange={(e) => setFieldId(e.target.value)}><option value="">All fields</option>{fields?.map((f) => <option key={f.id} value={f.id}>{f.farm_name} — {f.name}</option>)}</select>
      </PageHead>
      <ObservationsPanel key={fieldId} fieldId={fieldId ? Number(fieldId) : undefined} fields={fields} />
      {fieldId && <div style={{ marginTop: 16 }}><IrrigationPanel key={`i${fieldId}`} fieldId={Number(fieldId)} /></div>}
    </>
  );
}
