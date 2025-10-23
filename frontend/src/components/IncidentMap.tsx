// components/IncidentMap.tsx
'use client';

import { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default marker icons (so they show up in Next/webpack)
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconRetinaUrl: typeof markerIcon2x === 'string' ? markerIcon2x : (markerIcon2x as any).src,
  iconUrl: typeof markerIcon === 'string' ? markerIcon : (markerIcon as any).src,
  shadowUrl: typeof markerShadow === 'string' ? markerShadow : (markerShadow as any).src,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

export type IncidentPoint = {
  lat: number;
  lon: number;
  label?: string;
  place?: string;
  country?: string;
};

type Props = {
  points: IncidentPoint[];
  className?: string;
  height?: number | string; // e.g. 320 or "320px"
  zoom?: number;
};

export default function IncidentMap({
  points,
  className,
  height = 320,
  zoom = 6,
}: Props) {
  const validPoints = useMemo(
    () => points.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)),
    [points]
  );

  // Fallback center if nothing valid
  const center = useMemo(() => {
    if (!validPoints.length) return { lat: 20, lon: 0 }; // world-ish
    if (validPoints.length === 1) return { lat: validPoints[0].lat, lon: validPoints[0].lon };
    // average center
    const { latSum, lonSum } = validPoints.reduce(
      (acc, p) => ({ latSum: acc.latSum + p.lat, lonSum: acc.lonSum + p.lon }),
      { latSum: 0, lonSum: 0 }
    );
    return { lat: latSum / validPoints.length, lon: lonSum / validPoints.length };
  }, [validPoints]);

  const whenCreated = (map: LeafletMap) => {
    if (validPoints.length > 1) {
      const bounds = L.latLngBounds(validPoints.map(p => [p.lat, p.lon] as [number, number]));
      map.fitBounds(bounds, { padding: [24, 24] });
    } else if (validPoints.length === 1) {
      map.setView([validPoints[0].lat, validPoints[0].lon], zoom);
    }
  };

  return (
    <div className={className} style={{ height, borderRadius: 12, overflow: 'hidden' }}>
      <MapContainer
        center={[center.lat, center.lon]}
        zoom={zoom}
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%' }}
        whenCreated={whenCreated}
      >
        <TileLayer
          // OSM tiles (remember their usage policy if high traffic)
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />
        {validPoints.map((p, i) => {
          const label =
            p.label ||
            [p.place, p.country].filter(Boolean).join(', ') ||
            `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`;
          const google = `https://www.google.com/maps?q=${encodeURIComponent(`${p.lat},${p.lon}`)}`;
          const osm = `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=13/${p.lat}/${p.lon}`;
          return (
            <Marker key={`${p.lat}-${p.lon}-${i}`} position={[p.lat, p.lon]}>
              <Popup>
                <div className="space-y-1 text-sm">
                  <div className="font-medium">{label}</div>
                  <div className="text-xs text-gray-600">
                    {p.lat.toFixed(4)}, {p.lon.toFixed(4)}
                  </div>
                  <div className="text-xs">
                    <a className="text-blue-600" href={google} target="_blank" rel="noreferrer">
                      Open in Google Maps
                    </a>
                    {' · '}
                    <a className="text-blue-600" href={osm} target="_blank" rel="noreferrer">
                      Open in OSM
                    </a>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
