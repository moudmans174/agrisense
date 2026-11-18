import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';

export function useFetch(path, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(path));
  const load = useCallback(async () => {
    if (!path) { setLoading(false); return; }
    setLoading(true); setError(null);
    try { setData(await api.get(path)); } catch (e) { setError(e.message); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

export const Loader = ({ text = 'Loading…' }) => <div className="loader"><span className="spinner" />{text}</div>;
export const Empty = ({ children }) => <div className="empty">{children}</div>;
export const ErrorBox = ({ error }) => (error ? <div className="error-box">{error}</div> : null);

export function PageHead({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      <div className="toolbar">{children}</div>
    </div>
  );
}

export function Stat({ label, value, sub, accent }) {
  return (
    <div className="stat" style={accent ? { '--accent': accent } : undefined}>
      <div className="label">{label}</div>
      <div className="value">{value ?? '–'}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

const SEV_COLOR = { low: 'blue', medium: 'yellow', high: 'red', critical: 'red' };
export const SeverityBadge = ({ level }) => <span className={`badge cap ${SEV_COLOR[level] || ''}`}>{level}</span>;

export function HealthBadge({ cls, score }) {
  if (!cls) return <span className="badge">No analysis</span>;
  const c = cls === 'Healthy' ? 'green' : cls === 'Moderate stress' ? 'yellow' : 'red';
  return <span className={`badge ${c}`}>{score !== undefined && score !== null ? `${Math.round(score)} · ` : ''}{cls}</span>;
}

export function RiskMeter({ value, label }) {
  const v = Math.round((value ?? 0) * 100);
  const color = v >= 70 ? 'var(--danger)' : v >= 40 ? 'var(--warn)' : 'var(--leaf)';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 4 }}>
        <span>{label}</span><strong>{value === null || value === undefined ? '–' : `${v}%`}</strong>
      </div>
      <div className="meter"><span style={{ width: `${v}%`, background: color }} /></div>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head"><h3>{title}</h3><button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Input({ label, className = '', ...props }) {
  return <label className={`field ${className}`}>{label}<input {...props} /></label>;
}
export function Select({ label, options, className = '', placeholder, ...props }) {
  return (
    <label className={`field ${className}`}>{label}
      <select {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    </label>
  );
}
export function TextArea({ label, className = '', ...props }) {
  return <label className={`field ${className}`}>{label}<textarea {...props} /></label>;
}

export function ConfirmButton({ onConfirm, children = 'Delete', message = 'Are you sure?', className = 'btn secondary sm' }) {
  return <button className={className} onClick={() => window.confirm(message) && onConfirm()}>{children}</button>;
}

export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const bind = (name) => ({ name, value: values[name] ?? '', onChange: (e) => setValues((v) => ({ ...v, [name]: e.target.value })) });
  return { values, setValues, bind };
}

export const fmt = {
  date: (d) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '–'),
  dateTime: (d) => (d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–'),
  num: (v, dp = 1) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '–' : Number(v).toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: 0 })),
  pct: (v) => (v === null || v === undefined ? '–' : `${Math.round(v * 100)}%`),
};

export const CROP_OPTIONS = [
  { value: 'rice', label: 'Rice' }, { value: 'maize', label: 'Maize' }, { value: 'cassava', label: 'Cassava' },
  { value: 'groundnut', label: 'Groundnut' }, { value: 'sorghum', label: 'Sorghum' }, { value: 'tomato', label: 'Tomato' },
];

export const today = () => new Date().toISOString().slice(0, 10);

export function FieldPicker({ value, onChange, fields, label = 'Field' }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">Select a field…</option>
      {fields?.map((f) => <option key={f.id} value={f.id}>{f.farm_name} — {f.name} ({f.crop})</option>)}
    </select>
  );
}
