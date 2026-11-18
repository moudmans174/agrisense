import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Polygon, Polyline, CircleMarker, Tooltip, useMap, useMapEvents, LayersControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const HEALTH_COLOR = (cls) => (cls === 'Healthy' ? '#4e8f3a' : cls === 'Moderate stress' ? '#c7841b' : cls ? '#b5402f' : '#2a7f86');

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 15);
    else if (points.length > 1) map.fitBounds(points, { padding: [30, 30], maxZoom: 16 });
  }, [map, JSON.stringify(points)]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function ClickCapture({ onClick }) {
  useMapEvents({ click: (e) => onClick([e.latlng.lat, e.latlng.lng]) });
  return null;
}

function BaseLayers() {
  return (
    <LayersControl position="topright">
      <LayersControl.BaseLayer checked name="Satellite">
        <TileLayer attribution="Imagery © Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
      </LayersControl.BaseLayer>
      <LayersControl.BaseLayer name="Streets">
        <TileLayer attribution="© OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      </LayersControl.BaseLayer>
    </LayersControl>
  );
}

const ringToLatLngs = (geo) => geo?.coordinates?.[0]?.map(([lng, lat]) => [lat, lng]) || [];

/** Read-only map of many fields */
export function FieldsMap({ fields, height = 380, onSelect }) {
  const shapes = fields.filter((f) => f.boundary || f.centroid_lat);
  const points = useMemo(() => shapes.flatMap((f) => (f.boundary ? ringToLatLngs(f.boundary) : [[f.centroid_lat, f.centroid_lng]])), [shapes]);
  return (
    <div className="map-box" style={{ height }}>
      <MapContainer center={[8.46, -11.78]} zoom={7} style={{ height: '100%' }} scrollWheelZoom={false}>
        <BaseLayers />
        <FitBounds points={points} />
        {shapes.map((f) => {
          const color = HEALTH_COLOR(f.health_class);
          const handlers = onSelect ? { click: () => onSelect(f) } : {};
          return f.boundary ? (
            <Polygon key={f.id} positions={ringToLatLngs(f.boundary)} pathOptions={{ color, weight: 2, fillOpacity: 0.35 }} eventHandlers={handlers}>
              <Tooltip sticky><strong>{f.name}</strong><br />{f.crop} · {f.health_class || 'not analysed'}</Tooltip>
            </Polygon>
          ) : (
            <CircleMarker key={f.id} center={[f.centroid_lat, f.centroid_lng]} radius={9} pathOptions={{ color, fillOpacity: 0.7 }} eventHandlers={handlers}>
              <Tooltip><strong>{f.name}</strong><br />{f.crop}</Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}

/** Polygon editor: click to add vertices; returns GeoJSON Polygon via onChange */
export function BoundaryEditor({ value, onChange, center }) {
  const [pts, setPts] = useState(() => ringToLatLngs(value).slice(0, -1));
  useEffect(() => {
    if (pts.length >= 3) {
      const ring = [...pts, pts[0]].map(([lat, lng]) => [Number(lng.toFixed(6)), Number(lat.toFixed(6))]);
      onChange({ type: 'Polygon', coordinates: [ring] });
    } else onChange(null);
  }, [pts]); // eslint-disable-line react-hooks/exhaustive-deps
  const initial = pts.length ? pts : center ? [center] : [];
  return (
    <div>
      <div className="map-box" style={{ height: 340 }}>
        <MapContainer center={center || [8.46, -11.78]} zoom={center ? 15 : 7} style={{ height: '100%' }}>
          <BaseLayers />
          <FitBounds points={initial} />
          <ClickCapture onClick={(p) => setPts((x) => [...x, p])} />
          {pts.length >= 3 && <Polygon positions={pts} pathOptions={{ color: '#e9c46a', weight: 2, fillOpacity: 0.3 }} />}
          {pts.length > 0 && pts.length < 3 && <Polyline positions={pts} pathOptions={{ color: '#e9c46a' }} />}
          {pts.map((p, i) => <CircleMarker key={i} center={p} radius={5} pathOptions={{ color: '#fff', fillColor: '#e9c46a', fillOpacity: 1 }} />)}
        </MapContainer>
      </div>
      <div className="toolbar" style={{ marginTop: 8 }}>
        <span className="small muted">Click on the map to outline the field ({pts.length} point{pts.length === 1 ? '' : 's'}).</span>
        <span className="spacer" />
        <button type="button" className="btn secondary sm" onClick={() => setPts((x) => x.slice(0, -1))} disabled={!pts.length}>Undo point</button>
        <button type="button" className="btn secondary sm" onClick={() => setPts([])} disabled={!pts.length}>Clear</button>
      </div>
    </div>
  );
}
