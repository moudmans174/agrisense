import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  useFetch, Loader, ErrorBox, PageHead, Modal, Input, Select, TextArea, ConfirmButton, Empty, fmt, SeverityBadge, HealthBadge, Stat, CROP_OPTIONS,
} from '../../components/ui.jsx';
import { ImportModal } from './Observations.jsx';

// ---------------- Alerts ----------------
export function Alerts() {
  const [status, setStatus] = useState('open');
  const [severity, setSeverity] = useState('');
  const q = new URLSearchParams({ ...(status && { status }), ...(severity && { severity }) }).toString();
  const { data, loading, error, reload } = useFetch(`/alerts?${q}`, [q]);
  const setAlert = async (id, s) => { await api.patch(`/alerts/${id}`, { status: s }); reload(); };
  return (
    <>
      <PageHead title="Alerts" subtitle="High-priority recommendations raised by the AI engine.">
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option></select>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)}><option value="">All severities</option>{['critical', 'high', 'medium', 'low'].map((s) => <option key={s}>{s}</option>)}</select>
      </PageHead>
      <ErrorBox error={error} />
      <div className="card">
        {loading ? <Loader /> : !data?.length ? <Empty>No alerts match these filters.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Severity</th><th>Alert</th><th>Field</th><th>Type</th><th>Updated</th><th>Status</th><th /></tr></thead>
            <tbody>{data.map((a) => (
              <tr key={a.id}>
                <td><SeverityBadge level={a.severity} /></td>
                <td style={{ maxWidth: 440 }}><strong>{a.title}</strong><div className="small muted">{a.message}</div></td>
                <td><Link to={`/app/fields/${a.field_id}`}>{a.field_name}</Link><div className="small muted">{a.farm_name}</div></td>
                <td><span className="badge">{a.type}</span></td>
                <td className="small nowrap">{fmt.dateTime(a.updated_at)}</td>
                <td><span className={`badge ${a.status === 'open' ? 'red' : a.status === 'acknowledged' ? 'yellow' : 'green'}`}>{a.status}</span></td>
                <td className="nowrap">
                  {a.status === 'open' && <button className="btn secondary sm" onClick={() => setAlert(a.id, 'acknowledged')}>Acknowledge</button>}{' '}
                  {a.status !== 'resolved' ? <button className="btn sm" onClick={() => setAlert(a.id, 'resolved')}>Resolve</button> : <button className="btn ghost sm" onClick={() => setAlert(a.id, 'open')}>Re-open</button>}
                </td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

// ---------------- Reports ----------------
export function Reports() {
  const [params, setParams] = useSearchParams();
  const { data: farms } = useFetch('/farms');
  const farmId = params.get('farm') || '';
  useEffect(() => { if (!farmId && farms?.length) setParams({ farm: farms[0].id }, { replace: true }); }, [farms]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data, loading, error } = useFetch(farmId ? `/reports/farm/${farmId}` : null, [farmId]);
  return (
    <>
      <PageHead title="Season reports" subtitle="Farm-level summary of crop status, inputs and expected production.">
        <select value={farmId} onChange={(e) => setParams({ farm: e.target.value })}>{farms?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        {data && <>
          <button className="btn secondary no-print" onClick={() => api.download(`/reports/farm/${farmId}?format=csv`, `farm-${farmId}-report.csv`)}>⤓ CSV</button>
          <button className="btn no-print" onClick={() => window.print()}>🖨 Print / PDF</button>
        </>}
      </PageHead>
      <ErrorBox error={error} />
      {!farmId ? <div className="card"><Empty>Create a farm to generate reports.</Empty></div> : loading || !data ? <Loader /> : (
        <>
          <div className="card">
            <h2 style={{ marginBottom: 2 }}>{data.farm.name}</h2>
            <p className="muted small">{data.farm.location_name} · generated {fmt.dateTime(data.generated_at)}</p>
            <div className="grid cols-4">
              <Stat label="Fields" value={data.fields.length} />
              <Stat label="Area" value={`${fmt.num(data.totals.area_ha, 2)} ha`} accent="var(--soil)" />
              <Stat label="Expected production" value={`${fmt.num(data.totals.expected_production_t, 1)} t`} accent="var(--wheat)" />
              <Stat label="Active alerts" value={data.totals.active_alerts} accent={data.totals.active_alerts ? 'var(--danger)' : 'var(--leaf)'} />
            </div>
          </div>
          <div className="card"><div className="table-wrap"><table className="table">
            <thead><tr><th>Field</th><th>Crop</th><th>Area</th><th>Stage</th><th>Health</th><th>Season rain</th><th>Irrigation</th><th>Obs / scenes</th><th>Yield (t/ha)</th><th>Production</th></tr></thead>
            <tbody>{data.fields.map((f) => (
              <tr key={f.id}>
                <td><strong>{f.name}</strong><div className="small muted">planted {fmt.date(f.planting_date)}</div></td>
                <td style={{ textTransform: 'capitalize' }}>{f.crop}{f.variety && <div className="small muted">{f.variety}</div>}</td>
                <td>{fmt.num(f.area_ha, 2)} ha</td><td>{f.stage}<div className="small muted">day {f.days_after_planting}</div></td>
                <td><HealthBadge cls={f.health_class} score={f.health_score} /></td>
                <td>{fmt.num(f.season_rain)} mm</td><td>{fmt.num(f.season_irrigation)} mm</td><td>{f.observations} / {f.scenes}</td>
                <td>{f.predicted_yield ? <>{fmt.num(f.predicted_yield, 2)}<div className="small muted">{fmt.num(f.yield_low, 1)}–{fmt.num(f.yield_high, 1)}</div></> : '–'}</td>
                <td><strong>{f.expected_production_t ? `${fmt.num(f.expected_production_t, 1)} t` : '–'}</strong></td>
              </tr>))}
            </tbody>
          </table></div></div>
        </>
      )}
    </>
  );
}

// ---------------- Yield models ----------------
export function Models() {
  const { isStaff } = useAuth();
  const [crop, setCrop] = useState('maize');
  const { data: models, reload: reloadModels } = useFetch('/ai/models');
  const { data: seasons, loading, reload } = useFetch(`/ai/seasons?crop=${crop}`, [crop]);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null); const [err, setErr] = useState(null);
  const [lambda, setLambda] = useState('1');
  const [adding, setAdding] = useState(false); const [importing, setImporting] = useState(false);
  const train = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try { const m = await api.post('/ai/models/train', { crop, lambda }); setMsg(`Trained ${crop} v${m.version}: cross-validated R² ${m.metrics.cv.r2}, RMSE ${m.metrics.cv.rmse} t/ha on ${m.n_samples} seasons.`); reloadModels(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const active = models?.find((m) => m.crop === crop && m.active);
  return (
    <>
      <PageHead title="Yield models" subtitle="Ridge-regression yield models trained on historical seasons, one per crop.">
        <select value={crop} onChange={(e) => setCrop(e.target.value)}>{CROP_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
        {isStaff && <>
          <label className="small">λ <input type="number" step="0.1" min="0" value={lambda} onChange={(e) => setLambda(e.target.value)} style={{ width: 70, minWidth: 0 }} /></label>
          <button className="btn" onClick={train} disabled={busy}>{busy ? 'Training…' : '∿ Train model'}</button>
        </>}
      </PageHead>
      {msg && <div className="success-box">{msg}</div>}
      <ErrorBox error={err} />
      <div className="grid cols-4">
        <Stat label="Active version" value={active ? `v${active.version}` : '–'} sub={active ? fmt.dateTime(active.trained_at) : 'not trained'} />
        <Stat label="CV R²" value={active?.metrics.cv.r2 ?? '–'} sub="5-fold cross-validation" accent="var(--sky)" />
        <Stat label="CV RMSE" value={active ? `${active.metrics.cv.rmse} t/ha` : '–'} sub={active ? `MAE ${active.metrics.cv.mae}` : ''} accent="var(--wheat)" />
        <Stat label="Training seasons" value={seasons?.rows.length ?? '–'} accent="var(--soil)" />
      </div>
      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card" style={{ marginTop: 0 }}>
          <h3>Peak NDVI vs. yield</h3>
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart>
              <CartesianGrid stroke="#eee" />
              <XAxis type="number" dataKey="peak_ndvi" name="Peak NDVI" domain={['auto', 'auto']} fontSize={11} />
              <YAxis type="number" dataKey="yield_t_ha" name="Yield t/ha" fontSize={11} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} />
              <Scatter data={seasons?.rows || []} fill="#4e8f3a" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <div className="card" style={{ marginTop: 0 }}>
          <h3>Model versions</h3>
          <table className="table"><thead><tr><th>Crop</th><th>Ver.</th><th>R² (CV)</th><th>RMSE</th><th>n</th><th>Trained</th></tr></thead>
            <tbody>{(models || []).filter((m) => m.crop === crop).map((m) => (
              <tr key={m.id}><td>{m.crop} {m.active && <span className="badge green">active</span>}</td><td>v{m.version}</td><td>{m.metrics.cv.r2}</td><td>{m.metrics.cv.rmse}</td><td>{m.n_samples}</td><td className="small">{fmt.dateTime(m.trained_at)}</td></tr>))}
            </tbody></table>
          <p className="small muted">Features: {active?.features.join(', ') || '–'}</p>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Historical season records ({crop})</h3>
          {isStaff && <div className="toolbar"><button className="btn secondary sm" onClick={() => setImporting(true)}>⤒ Import CSV</button><button className="btn sm" onClick={() => setAdding(true)}>+ Add season</button></div>}
        </div>
        {loading ? <Loader /> : (
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}><table className="table">
            <thead><tr><th>Year</th><th>Mean NDVI</th><th>Peak NDVI</th><th>Rain mm</th><th>GDD</th><th>Pest</th><th>Disease</th><th>Yield t/ha</th>{isStaff && <th />}</tr></thead>
            <tbody>{seasons.rows.map((s) => (
              <tr key={s.id}><td>{s.season_year}</td><td>{s.mean_ndvi}</td><td>{s.peak_ndvi}</td><td>{s.cum_rain}</td><td>{s.gdd}</td><td>{s.mean_pest}</td><td>{s.mean_disease}</td><td><strong>{s.yield_t_ha}</strong></td>
                {isStaff && <td><ConfirmButton className="btn ghost sm" onConfirm={async () => { await api.del(`/ai/seasons/${s.id}`); reload(); }}>✕</ConfirmButton></td>}</tr>))}
            </tbody></table></div>
        )}
      </div>
      {adding && <SeasonForm crop={crop} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
      {importing && <ImportModal title="Import season records" fieldId="-" onClose={() => setImporting(false)} onDone={reload}
        endpoint={() => '/ai/seasons/import'} template="crop, season_year, mean_ndvi, peak_ndvi, cum_rain, gdd, mean_pest, mean_disease, yield_t_ha" />}
    </>
  );
}

function SeasonForm({ crop, onClose, onSaved }) {
  const [v, setV] = useState({ crop, season_year: new Date().getFullYear() - 1, mean_ndvi: '', peak_ndvi: '', cum_rain: '', gdd: '', mean_pest: 0, mean_disease: 0, yield_t_ha: '' });
  const [err, setErr] = useState(null);
  const bind = (k) => ({ value: v[k], onChange: (e) => setV({ ...v, [k]: e.target.value }) });
  const submit = async (e) => { e.preventDefault(); try { await api.post('/ai/seasons', v); onSaved(); } catch (er) { setErr(er.message); } };
  return (
    <Modal title="Add historical season" onClose={onClose}>
      <form onSubmit={submit}><ErrorBox error={err} />
        <div className="form-grid">
          <Select label="Crop" options={CROP_OPTIONS} {...bind('crop')} />
          <Input label="Season year" type="number" required {...bind('season_year')} />
          <Input label="Mean NDVI" type="number" step="0.001" required {...bind('mean_ndvi')} />
          <Input label="Peak NDVI" type="number" step="0.001" required {...bind('peak_ndvi')} />
          <Input label="Cumulative rain (mm)" type="number" required {...bind('cum_rain')} />
          <Input label="GDD" type="number" required {...bind('gdd')} />
          <Input label="Mean pest (0–5)" type="number" step="0.1" {...bind('mean_pest')} />
          <Input label="Mean disease (0–5)" type="number" step="0.1" {...bind('mean_disease')} />
          <Input label="Yield (t/ha)" type="number" step="0.01" required {...bind('yield_t_ha')} />
        </div>
        <div className="form-actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn">Save</button></div>
      </form>
    </Modal>
  );
}

// ---------------- Advisories (admin) ----------------
export function AdvisoriesAdmin() {
  const { data, loading, error, reload } = useFetch('/advisories');
  const [editing, setEditing] = useState(null);
  return (
    <>
      <PageHead title="Public advisories" subtitle="Published advisories appear on the public website."><button className="btn" onClick={() => setEditing('new')}>+ New advisory</button></PageHead>
      <ErrorBox error={error} />
      <div className="card">
        {loading ? <Loader /> : !data?.length ? <Empty>No advisories.</Empty> : (
          <table className="table"><thead><tr><th>Title</th><th>Crop</th><th>Region</th><th>Severity</th><th>Status</th><th>Author</th><th /></tr></thead>
            <tbody>{data.map((a) => (
              <tr key={a.id}><td><strong>{a.title}</strong><div className="small muted">{fmt.date(a.created_at)}</div></td><td>{a.crop || 'all'}</td><td>{a.region || '–'}</td>
                <td><SeverityBadge level={a.severity} /></td><td>{a.published ? <span className="badge green">published</span> : <span className="badge">draft</span>}</td><td>{a.author}</td>
                <td className="nowrap"><button className="btn ghost sm" onClick={() => setEditing(a)}>Edit</button><ConfirmButton className="btn ghost sm" onConfirm={async () => { await api.del(`/advisories/${a.id}`); reload(); }}>✕</ConfirmButton></td></tr>))}
            </tbody></table>
        )}
      </div>
      {editing && <AdvisoryForm adv={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function AdvisoryForm({ adv, onClose, onSaved }) {
  const [v, setV] = useState({ title: adv?.title || '', body: adv?.body || '', region: adv?.region || '', crop: adv?.crop || '', severity: adv?.severity || 'low', published: adv?.published ?? false });
  const [err, setErr] = useState(null);
  const bind = (k) => ({ value: v[k], onChange: (e) => setV({ ...v, [k]: e.target.value }) });
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    try { adv ? await api.put(`/advisories/${adv.id}`, v) : await api.post('/advisories', v); onSaved(); } catch (er) { setErr(er.message); }
  };
  return (
    <Modal title={adv ? 'Edit advisory' : 'New advisory'} onClose={onClose}>
      <form onSubmit={submit}><ErrorBox error={err} />
        <div className="form-grid">
          <Input label="Title" required className="span-all" {...bind('title')} />
          <Select label="Crop" placeholder="All crops" options={CROP_OPTIONS} {...bind('crop')} />
          <Input label="Region" {...bind('region')} />
          <Select label="Severity" options={['low', 'medium', 'high', 'critical']} {...bind('severity')} />
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" style={{ width: 'auto' }} checked={v.published} onChange={(e) => setV({ ...v, published: e.target.checked })} /> Publish on website</label>
          <TextArea label="Advisory text" required className="span-all" rows={8} {...bind('body')} />
        </div>
        <div className="form-actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn">Save</button></div>
      </form>
    </Modal>
  );
}

// ---------------- Users & messages (admin) ----------------
export function Users() {
  const { user: me } = useAuth();
  const { data, loading, error, reload } = useFetch('/users');
  const { data: msgs, reload: reloadMsgs } = useFetch('/users/messages/all');
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState(null);
  const patch = async (id, body) => { setErr(null); try { await api.patch(`/users/${id}`, body); reload(); } catch (e) { setErr(e.message); } };
  return (
    <>
      <PageHead title="Users & messages" subtitle="Manage accounts, roles and messages from the public contact form."><button className="btn" onClick={() => setAdding(true)}>+ New user</button></PageHead>
      <ErrorBox error={error || err} />
      <div className="card">
        {loading ? <Loader /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Name</th><th>Email</th><th>Organisation</th><th>Role</th><th>Farms</th><th>Status</th><th>Joined</th><th /></tr></thead>
            <tbody>{data.map((u) => (
              <tr key={u.id}><td><strong>{u.name}</strong></td><td>{u.email}</td><td>{u.organization || '–'}</td>
                <td><select value={u.role} disabled={u.id === me.id} onChange={(e) => patch(u.id, { role: e.target.value })} style={{ width: 'auto' }}>{['farmer', 'agronomist', 'admin'].map((r) => <option key={r}>{r}</option>)}</select></td>
                <td>{u.farm_count}</td>
                <td>{u.active ? <span className="badge green">active</span> : <span className="badge red">disabled</span>}</td>
                <td className="small">{fmt.date(u.created_at)}</td>
                <td className="nowrap">{u.id !== me.id && <>
                  <button className="btn ghost sm" onClick={() => patch(u.id, { active: !u.active })}>{u.active ? 'Disable' : 'Enable'}</button>
                  <ConfirmButton className="btn ghost sm" message="Delete this user and all their farms?" onConfirm={async () => { await api.del(`/users/${u.id}`); reload(); }}>✕</ConfirmButton>
                </>}</td></tr>))}
            </tbody></table></div>
        )}
      </div>
      <div className="card">
        <h3>Contact messages</h3>
        {!msgs?.length ? <Empty>No messages.</Empty> : msgs.map((m) => (
          <div key={m.id} style={{ padding: '0.8rem 0', borderBottom: '1px solid #efeadf', opacity: m.handled ? 0.55 : 1 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>{m.name}</strong><a href={`mailto:${m.email}`} className="small">{m.email}</a><span className="small muted">{fmt.dateTime(m.created_at)}</span>
              <span className="spacer" />
              <button className="btn secondary sm" onClick={async () => { await api.patch(`/users/messages/${m.id}`, { handled: !m.handled }); reloadMsgs(); }}>{m.handled ? 'Mark unhandled' : 'Mark handled'}</button>
            </div>
            {m.subject && <div style={{ fontWeight: 600, marginTop: 4 }}>{m.subject}</div>}
            <div className="small" style={{ whiteSpace: 'pre-line' }}>{m.message}</div>
          </div>
        ))}
      </div>
      {adding && <UserForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </>
  );
}

function UserForm({ onClose, onSaved }) {
  const [v, setV] = useState({ name: '', email: '', password: '', role: 'farmer', organization: '', phone: '' });
  const [err, setErr] = useState(null);
  const bind = (k) => ({ value: v[k], onChange: (e) => setV({ ...v, [k]: e.target.value }) });
  const submit = async (e) => { e.preventDefault(); try { await api.post('/users', v); onSaved(); } catch (er) { setErr(er.message); } };
  return (
    <Modal title="New user" onClose={onClose}>
      <form onSubmit={submit}><ErrorBox error={err} />
        <div className="form-grid">
          <Input label="Name" required {...bind('name')} />
          <Input label="Email" type="email" required {...bind('email')} />
          <Input label="Temporary password" type="password" minLength={8} required {...bind('password')} />
          <Select label="Role" options={['farmer', 'agronomist', 'admin']} {...bind('role')} />
          <Input label="Organisation" {...bind('organization')} />
          <Input label="Phone" {...bind('phone')} />
        </div>
        <div className="form-actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn">Create</button></div>
      </form>
    </Modal>
  );
}

// ---------------- Profile ----------------
export function Profile() {
  const { user, setUser } = useAuth();
  const [v, setV] = useState({ name: user.name, phone: user.phone || '', organization: user.organization || '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [msg, setMsg] = useState(null); const [err, setErr] = useState(null);
  const save = async (e) => { e.preventDefault(); setErr(null); try { setUser(await api.put('/auth/me', v)); setMsg('Profile updated.'); } catch (er) { setErr(er.message); } };
  const changePw = async (e) => { e.preventDefault(); setErr(null); try { await api.put('/auth/me/password', pw); setPw({ currentPassword: '', newPassword: '' }); setMsg('Password changed.'); } catch (er) { setErr(er.message); } };
  return (
    <>
      <PageHead title="Your profile" subtitle={`${user.email} · ${user.role}`} />
      {msg && <div className="success-box">{msg}</div>}
      <ErrorBox error={err} />
      <div className="grid cols-2">
        <form className="card" style={{ marginTop: 0 }} onSubmit={save}>
          <h3>Details</h3>
          <div className="grid">
            <Input label="Name" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
            <Input label="Phone" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
            <Input label="Organisation" value={v.organization} onChange={(e) => setV({ ...v, organization: e.target.value })} />
          </div>
          <div className="form-actions"><button className="btn">Save</button></div>
        </form>
        <form className="card" style={{ marginTop: 0 }} onSubmit={changePw}>
          <h3>Change password</h3>
          <div className="grid">
            <Input label="Current password" type="password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            <Input label="New password" type="password" minLength={8} required value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          </div>
          <div className="form-actions"><button className="btn">Update password</button></div>
        </form>
      </div>
    </>
  );
}
