import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFetch, Loader, ErrorBox, PageHead, HealthBadge, fmt, Empty, CROP_OPTIONS } from '../../components/ui.jsx';
import { FieldsMap } from '../../components/FieldMap.jsx';
import { FieldForm } from './Farms.jsx';

export default function Fields() {
  const nav = useNavigate();
  const [crop, setCrop] = useState('');
  const { data, loading, error } = useFetch(`/fields${crop ? `?crop=${crop}` : ''}`, [crop]);
  const { data: farms } = useFetch('/farms');
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHead title="Fields" subtitle="Every field carries its own boundary, crop calendar and soil parameters.">
        <select value={crop} onChange={(e) => setCrop(e.target.value)}><option value="">All crops</option>{CROP_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
        <button className="btn" onClick={() => setAdding(true)} disabled={!farms?.length} title={!farms?.length ? 'Create a farm first' : ''}>+ New field</button>
      </PageHead>
      <ErrorBox error={error} />
      {loading ? <Loader /> : !data?.length ? <div className="card"><Empty>No fields found.</Empty></div> : (
        <>
          <div className="card"><FieldsMap fields={data} height={340} onSelect={(f) => nav(`/app/fields/${f.id}`)} /></div>
          <div className="card">
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Field</th><th>Farm</th><th>Crop</th><th>Area</th><th>Planted</th><th>Stage</th><th>Irrigation</th><th>Health</th><th>Last analysis</th></tr></thead>
              <tbody>{data.map((f) => (
                <tr key={f.id} className="clickable" onClick={() => nav(`/app/fields/${f.id}`)}>
                  <td><strong>{f.name}</strong>{f.variety && <div className="small muted">{f.variety}</div>}</td>
                  <td>{f.farm_name}</td><td style={{ textTransform: 'capitalize' }}>{f.crop}</td><td>{fmt.num(f.area_ha, 2)} ha</td>
                  <td>{fmt.date(f.planting_date)}</td><td>{f.stage}</td><td>{f.irrigation_type}</td>
                  <td><HealthBadge cls={f.health_class} score={f.health_score} /></td><td className="small muted">{fmt.dateTime(f.last_decision_at)}</td>
                </tr>))}
              </tbody>
            </table></div>
          </div>
        </>
      )}
      {adding && <FieldForm farms={farms} onClose={() => setAdding(false)} onSaved={(f) => nav(`/app/fields/${f.id}?analyse=1`)} />}
    </>
  );
}
