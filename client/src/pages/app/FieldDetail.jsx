import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ResponsiveContainer, ComposedChart, Line, Area, Bar, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine,
} from 'recharts';
import { api } from '../../api/client.js';
import { useFetch, Loader, ErrorBox, PageHead, HealthBadge, fmt, ConfirmButton, Stat } from '../../components/ui.jsx';
import { FieldsMap } from '../../components/FieldMap.jsx';
import { FieldForm } from './Farms.jsx';
import { DecisionPanel } from './Insights.jsx';
import { ObservationsPanel, IrrigationPanel } from './Observations.jsx';
import { SatellitePanel } from './Satellite.jsx';
import { EnvironmentPanel } from './Environment.jsx';

const TABS = ['AI decision', 'Integrated data', 'Observations', 'Satellite', 'Weather', 'Irrigation log'];

function IntegratedPanel({ field }) {
  const { data, loading, error } = useFetch(`/integration/field/${field.id}/timeseries`);
  if (loading) return <Loader text="Fusing data streams…" />;
  if (error) return <ErrorBox error={error} />;
  const rows = data.rows.map((r) => ({ ...r, ndvi_scene: r.ndvi_observed ? r.ndvi : null, water_in: (r.rainfall_mm || 0) + (r.irrigation_mm || 0) }));
  const tick = (d) => d.slice(5);
  return (
    <>
      <div className="grid cols-4">
        <Stat label="Weather coverage" value={fmt.pct(data.meta.coverage.weather)} sub={`${data.meta.weatherDays} daily records`} accent="var(--leaf)" />
        <Stat label="Satellite coverage" value={fmt.pct(data.meta.coverage.satellite)} sub={`${data.meta.sceneCount} cloud-free scenes`} accent="var(--sky)" />
        <Stat label="Ground observations" value={data.meta.observationCount} sub="field visits" accent="var(--wheat)" />
        <Stat label="Available water (TAW)" value={`${data.meta.TAW} mm`} sub={`RAW ${data.meta.RAW} mm · root depth ${data.meta.rootDepth} m`} accent="var(--soil)" />
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h3>Canopy vigour — satellite vs. expected crop curve</h3>
          <button className="btn secondary sm" onClick={() => api.download(`/integration/field/${field.id}/export.csv`, `field-${field.id}-integrated.csv`)}>⤓ Export integrated CSV</button></div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={rows}>
            <CartesianGrid stroke="#eee" vertical={false} />
            <XAxis dataKey="date" tickFormatter={tick} fontSize={11} minTickGap={24} />
            <YAxis domain={[-0.4, 1]} ticks={[-0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1]} fontSize={11} />
            <Tooltip />
            <Legend />
            <Line dataKey="ndvi_expected" name="Expected NDVI (healthy crop)" stroke="#b9b3a4" strokeDasharray="5 4" dot={false} />
            <Line dataKey="ndvi" name="NDVI (interpolated)" stroke="#4e8f3a" dot={false} strokeWidth={2} />
            <Scatter dataKey="ndvi_scene" name="Sentinel-2 scene" fill="#1f3b2d" />
            <Line dataKey="ndwi" name="NDWI" stroke="#2a7f86" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="card">
        <h3>Root-zone soil water balance (FAO-56)</h3>
        <p className="small muted">Depletion rises with crop water use (ETc) and falls with rain and irrigation. Above the RAW line the crop is water-stressed. Ground-truth soil-moisture observations reset the model on the day they are recorded.</p>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={rows}>
            <CartesianGrid stroke="#eee" vertical={false} />
            <XAxis dataKey="date" tickFormatter={tick} fontSize={11} minTickGap={24} />
            <YAxis yAxisId="d" reversed fontSize={11} label={{ value: 'depletion mm', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <YAxis yAxisId="w" orientation="right" fontSize={11} />
            <Tooltip />
            <Legend />
            <Bar yAxisId="w" dataKey="rainfall_mm" name="Rain (mm)" fill="#5fb3b9" stackId="w" />
            <Bar yAxisId="w" dataKey="irrigation_mm" name="Irrigation (mm)" fill="#1f3b2d" stackId="w" />
            <Area yAxisId="d" dataKey="depletion_mm" name="Depletion (mm)" stroke="#8b5e3c" fill="#e8d6c4" />
            <ReferenceLine yAxisId="d" y={data.meta.RAW} stroke="#c7841b" strokeDasharray="4 3" label={{ value: 'RAW', fontSize: 11, fill: '#c7841b' }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card" style={{ marginTop: 0 }}>
          <h3>Temperature & growing degree days</h3>
          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={rows}>
              <CartesianGrid stroke="#eee" vertical={false} />
              <XAxis dataKey="date" tickFormatter={tick} fontSize={11} minTickGap={24} />
              <YAxis yAxisId="t" fontSize={11} domain={['auto', 'auto']} />
              <YAxis yAxisId="g" orientation="right" fontSize={11} />
              <Tooltip />
              <Line yAxisId="t" dataKey="temp_max" name="Max °C" stroke="#c7841b" dot={false} />
              <Line yAxisId="t" dataKey="temp_min" name="Min °C" stroke="#2a7f86" dot={false} />
              <Line yAxisId="g" dataKey="gdd_cum" name="Cumulative GDD" stroke="#1f3b2d" dot={false} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="card" style={{ marginTop: 0 }}>
          <h3>Biotic pressure from field observations</h3>
          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={rows}>
              <CartesianGrid stroke="#eee" vertical={false} />
              <XAxis dataKey="date" tickFormatter={tick} fontSize={11} minTickGap={24} />
              <YAxis domain={[0, 5]} fontSize={11} />
              <Tooltip />
              <Area dataKey="pest_index" name="Pest index" stroke="#b5402f" fill="#f8e1dc" />
              <Area dataKey="disease_index" name="Disease index" stroke="#8a5a0e" fill="#fbecd2" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}

export default function FieldDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(TABS[0]);
  const { data: field, loading, error, reload } = useFetch(`/fields/${id}`);
  const { data: farms } = useFetch('/farms');
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(0);
  const autoAnalyse = params.get('analyse') === '1';
  useEffect(() => { if (autoAnalyse) setParams({}, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <Loader />;
  if (error) return <ErrorBox error={error} />;
  const del = async () => { await api.del(`/fields/${id}`); nav('/app/fields'); };
  const d = field.latest_decision;
  return (
    <>
      <PageHead title={field.name} subtitle={`${field.farm_name} · ${field.crop_info.label}${field.variety ? ` (${field.variety})` : ''} · ${fmt.num(field.area_ha, 2)} ha · planted ${fmt.date(field.planting_date)}`}>
        <HealthBadge cls={d?.health_class} score={d?.health_score} />
        <button className="btn secondary" onClick={() => setEditing(true)}>Edit</button>
        <ConfirmButton className="btn secondary" message="Delete this field and all of its data?" onConfirm={del}>Delete</ConfirmButton>
      </PageHead>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="card" style={{ gridColumn: 'span 2', marginTop: 0, padding: 12 }}><FieldsMap fields={[{ ...field, health_class: d?.health_class }]} height={220} /></div>
        <div className="card" style={{ marginTop: 0 }}>
          <div className="small muted">Season progress</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 600 }}>{field.stage}</div>
          <div className="meter" style={{ margin: '8px 0' }}><span style={{ width: `${Math.min(100, Math.max(0, (field.days_after_planting / field.season_length) * 100))}%`, background: 'var(--leaf)' }} /></div>
          <div className="small">Day {field.days_after_planting} of {field.season_length} · harvest ≈ {fmt.date(field.expected_harvest)}</div>
          <div className="small muted" style={{ marginTop: 10 }}>
            Soil {field.soil_type} (FC {field.field_capacity}, WP {field.wilting_point}) · {field.irrigation_type}<br />
            Data: {field.data_summary.observations.n} observations · {field.data_summary.satellite.n} scenes · {field.data_summary.environment.n} weather days
          </div>
        </div>
      </div>
      <div className="tabs">{TABS.map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === 'AI decision' && <DecisionPanel key={version} field={field} autoRun={autoAnalyse || !d} onRan={() => { reload(); }} />}
      {tab === 'Integrated data' && <IntegratedPanel key={version} field={field} />}
      {tab === 'Observations' && <ObservationsPanel fieldId={field.id} onChange={() => setVersion((v) => v + 1)} />}
      {tab === 'Satellite' && <SatellitePanel field={field} />}
      {tab === 'Weather' && <EnvironmentPanel field={field} />}
      {tab === 'Irrigation log' && <IrrigationPanel fieldId={field.id} />}
      {editing && <FieldForm field={field} farms={farms} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </>
  );
}
