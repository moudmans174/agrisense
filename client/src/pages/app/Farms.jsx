import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  useFetch, Loader, ErrorBox, PageHead, Modal, Input, TextArea, Select, ConfirmButton, Empty, HealthBadge, fmt, CROP_OPTIONS, today,
} from '../../components/ui.jsx';
import { FieldsMap, BoundaryEditor } from '../../components/FieldMap.jsx';

export function FarmForm({ farm, onSaved, onClose }) {
  const { isStaff } = useAuth();
  const { data: users } = useFetch(isStaff && !farm ? '/users' : null);
  const [v, setV] = useState({
    name: farm?.name || '', location_name: farm?.location_name || '', latitude: farm?.latitude ?? '', longitude: farm?.longitude ?? '',
    description: farm?.description || '', owner_id: '',
  });
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const bind = (k) => ({ value: v[k], onChange: (e) => setV({ ...v, [k]: e.target.value }) });
  const locate = () => navigator.geolocation?.getCurrentPosition((p) => setV((x) => ({ ...x, latitude: p.coords.latitude.toFixed(5), longitude: p.coords.longitude.toFixed(5) })));
  const submit = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    const body = { ...v, latitude: v.latitude === '' ? null : v.latitude, longitude: v.longitude === '' ? null : v.longitude, owner_id: v.owner_id || undefined };
    try { onSaved(farm ? await api.put(`/farms/${farm.id}`, body) : await api.post('/farms', body)); } catch (er) { setErr(er.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={farm ? 'Edit farm' : 'New farm'} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorBox error={err} />
        <div className="form-grid">
          <Input label="Farm name" required className="span-2" {...bind('name')} />
          <Input label="Location" placeholder="District, province" className="span-2" {...bind('location_name')} />
          <Input label="Latitude" type="number" step="any" {...bind('latitude')} />
          <Input label="Longitude" type="number" step="any" {...bind('longitude')} />
          {users && <Select label="Owner (farmer)" placeholder="Me" options={users.filter((u) => u.role === 'farmer').map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))} {...bind('owner_id')} />}
          <TextArea label="Description" className="span-all" {...bind('description')} />
        </div>
        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={locate}>📍 Use my location</button>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save farm'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function FieldForm({ field, farms, defaultFarmId, onSaved, onClose }) {
  const [v, setV] = useState({
    farm_id: field?.farm_id || defaultFarmId || farms?.[0]?.id || '', name: field?.name || '', crop: field?.crop || 'maize', variety: field?.variety || '',
    planting_date: field?.planting_date || today(), expected_harvest: field?.expected_harvest || '', soil_type: field?.soil_type || 'loam',
    irrigation_type: field?.irrigation_type || 'rainfed', centroid_lat: field?.centroid_lat ?? '', centroid_lng: field?.centroid_lng ?? '',
  });
  const [boundary, setBoundary] = useState(field?.boundary || null);
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const bind = (k) => ({ value: v[k], onChange: (e) => setV({ ...v, [k]: e.target.value }) });
  const farm = farms?.find((f) => String(f.id) === String(v.farm_id));
  const center = field?.centroid_lat ? [field.centroid_lat, field.centroid_lng] : farm?.latitude ? [farm.latitude, farm.longitude] : null;
  const submit = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    const body = { ...v, boundary, expected_harvest: v.expected_harvest || null,
      centroid_lat: boundary ? null : v.centroid_lat || (farm?.latitude ?? null), centroid_lng: boundary ? null : v.centroid_lng || (farm?.longitude ?? null) };
    try { onSaved(field ? await api.put(`/fields/${field.id}`, body) : await api.post('/fields', body)); } catch (er) { setErr(er.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={field ? 'Edit field' : 'New field'} onClose={onClose} wide>
      <form onSubmit={submit}>
        <ErrorBox error={err} />
        <div className="form-grid">
          <Select label="Farm" required options={(farms || []).map((f) => ({ value: f.id, label: f.name }))} {...bind('farm_id')} />
          <Input label="Field name" required {...bind('name')} />
          <Select label="Crop" options={CROP_OPTIONS} {...bind('crop')} />
          <Input label="Variety" {...bind('variety')} />
          <Input label="Planting date" type="date" required {...bind('planting_date')} />
          <Input label="Expected harvest (optional)" type="date" {...bind('expected_harvest')} />
          <Select label="Soil type" options={['sand', 'sandy loam', 'loam', 'clay loam', 'clay']} {...bind('soil_type')} />
          <Select label="Irrigation" options={['rainfed', 'drip', 'sprinkler', 'surface', 'flood']} {...bind('irrigation_type')} />
          <div className="span-all"><BoundaryEditor value={field?.boundary} onChange={setBoundary} center={center} /></div>
          {!boundary && <>
            <Input label="…or field latitude" type="number" step="any" placeholder={farm?.latitude ?? ''} {...bind('centroid_lat')} />
            <Input label="field longitude" type="number" step="any" placeholder={farm?.longitude ?? ''} {...bind('centroid_lng')} />
          </>}
        </div>
        <p className="small muted">Area and centroid are computed from the boundary. Soil field capacity and wilting point are derived from the soil type.</p>
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save field'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Farms() {
  const [params, setParams] = useSearchParams();
  const { data, loading, error, reload } = useFetch('/farms');
  const [editing, setEditing] = useState(params.get('new') ? 'new' : null);
  const nav = useNavigate();
  const close = () => { setEditing(null); if (params.get('new')) setParams({}); };
  return (
    <>
      <PageHead title="Farms" subtitle="Farms group fields under one owner and location."><button className="btn" onClick={() => setEditing('new')}>+ New farm</button></PageHead>
      <ErrorBox error={error} />
      {loading ? <Loader /> : !data?.length ? <div className="card"><Empty>No farms yet. Create your first farm to start mapping fields.</Empty></div> : (
        <div className="grid cols-3">
          {data.map((f) => (
            <div className="card" key={f.id} style={{ marginTop: 0, cursor: 'pointer' }} onClick={() => nav(`/app/farms/${f.id}`)}>
              <h3>{f.name}</h3>
              <p className="small muted">{f.location_name || 'No location'} · owner {f.owner_name}</p>
              <div style={{ display: 'flex', gap: 8 }}><span className="badge green">{f.field_count} field(s)</span><span className="badge soil">{fmt.num(f.total_area_ha, 2)} ha</span></div>
            </div>
          ))}
        </div>
      )}
      {editing && <FarmForm farm={editing === 'new' ? null : editing} onClose={close} onSaved={(f) => { close(); reload(); if (editing === 'new') nav(`/app/farms/${f.id}?addField=1`); }} />}
    </>
  );
}

export function FarmDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data, loading, error, reload } = useFetch(`/farms/${id}`);
  const { data: farms } = useFetch('/farms');
  const [editFarm, setEditFarm] = useState(false);
  const [addField, setAddField] = useState(Boolean(params.get('addField')));
  if (loading) return <Loader />;
  if (error) return <ErrorBox error={error} />;
  const del = async () => { await api.del(`/farms/${id}`); nav('/app/farms'); };
  return (
    <>
      <PageHead title={data.name} subtitle={`${data.location_name || ''} ${data.description ? '· ' + data.description : ''}`}>
        <Link to={`/app/reports?farm=${id}`} className="btn secondary">Season report</Link>
        <button className="btn secondary" onClick={() => setEditFarm(true)}>Edit</button>
        <ConfirmButton className="btn danger" message="Delete this farm and all its fields and data?" onConfirm={del}>Delete</ConfirmButton>
        <button className="btn" onClick={() => setAddField(true)}>+ Add field</button>
      </PageHead>
      <div className="grid cols-2">
        <div className="card" style={{ marginTop: 0 }}>{data.fields.length ? <FieldsMap fields={data.fields} onSelect={(f) => nav(`/app/fields/${f.id}`)} /> : <Empty>No fields yet — add one and draw its boundary.</Empty>}</div>
        <div className="card" style={{ marginTop: 0 }}>
          <h3>Fields</h3>
          <table className="table"><thead><tr><th>Name</th><th>Crop</th><th>Area</th><th>Planted</th><th>Health</th></tr></thead>
            <tbody>{data.fields.map((f) => (
              <tr key={f.id} className="clickable" onClick={() => nav(`/app/fields/${f.id}`)}>
                <td><strong>{f.name}</strong></td><td style={{ textTransform: 'capitalize' }}>{f.crop}</td><td>{fmt.num(f.area_ha, 2)} ha</td><td>{fmt.date(f.planting_date)}</td>
                <td><HealthBadge cls={f.health_class} score={f.health_score} /></td>
              </tr>))}
            </tbody></table>
        </div>
      </div>
      {editFarm && <FarmForm farm={data} onClose={() => setEditFarm(false)} onSaved={() => { setEditFarm(false); reload(); }} />}
      {addField && <FieldForm farms={farms} defaultFarmId={Number(id)} onClose={() => { setAddField(false); setParams({}); }} onSaved={(f) => nav(`/app/fields/${f.id}?analyse=1`)} />}
    </>
  );
}
