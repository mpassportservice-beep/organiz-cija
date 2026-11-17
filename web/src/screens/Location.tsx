import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { inLatvia, LATVIA_BORDER, LATVIA_BOUNDS, type FarmLocation } from '@spray/shared';
import type { Ctx } from '../App';
import { Btn, inputCls, Labeled } from '../ui';

const DEFAULT = { name: 'Priekuļi', lat: 57.315, lon: 25.355 };

const PIN = L.divIcon({
  className: '',
  iconSize: [36, 48],
  iconAnchor: [18, 46],
  html: `<svg width="36" height="48" viewBox="0 0 36 48" aria-hidden="true"><path d="M18 1C8.6 1 1 8.4 1 17.6 1 30 18 47 18 47s17-17 17-29.4C35 8.4 27.4 1 18 1z" fill="#b91c1c" stroke="#0a0a0a" stroke-width="2"/><circle cx="18" cy="17.5" r="6.5" fill="#fff"/></svg>`,
});

/** Full-screen map: tap anywhere in Latvia to move the pin; weather is then fetched for that point. */
export function LocationPicker({ ctx, onClose, onSave }: { ctx: Ctx; onClose: () => void; onSave: (l: FarmLocation | null) => void }) {
  const { t, state } = ctx;
  const start = state.location ?? ctx.snapshot?.farm ?? DEFAULT;
  const [pt, setPt] = useState<{ lat: number; lon: number }>({ lat: start.lat, lon: start.lon });
  const [name, setName] = useState(state.location?.name ?? '');
  const [err, setErr] = useState('');
  const [locating, setLocating] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);

  const place = (lat: number, lon: number, pan = false) => {
    if (!inLatvia(lat, lon)) { setErr(t('locOutside')); return; }
    setErr('');
    setPt({ lat, lon });
    marker.current?.setLatLng([lat, lon]);
    if (pan) map.current?.setView([lat, lon], Math.max(map.current.getZoom(), 12));
  };

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { maxBounds: L.latLngBounds(LATVIA_BOUNDS).pad(0.3), minZoom: 6, zoomControl: true, attributionControl: true })
      .setView([start.lat, start.lon], state.location ? 12 : 9);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    L.polygon(LATVIA_BORDER, { color: '#0a0a0a', weight: 2, fill: false, interactive: false }).addTo(m);
    marker.current = L.marker([start.lat, start.lon], { icon: PIN, draggable: true, keyboard: false }).addTo(m);
    marker.current.on('dragend', () => {
      const p = marker.current!.getLatLng();
      if (inLatvia(p.lat, p.lng)) { setErr(''); setPt({ lat: p.lat, lon: p.lng }); }
      else { setErr(t('locOutside')); marker.current!.setLatLng([ptRef.current.lat, ptRef.current.lon]); }
    });
    m.on('click', (e: L.LeafletMouseEvent) => placeRef.current(e.latlng.lat, e.latlng.lng));
    map.current = m;
    setTimeout(() => m.invalidateSize(), 50);
    return () => { m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Leaflet handlers are bound once; refs give them the latest state.
  const placeRef = useRef(place); placeRef.current = place;
  const ptRef = useRef(pt); ptRef.current = pt;

  const gps = () => {
    if (!navigator.geolocation) { setErr(t('locNoGps')); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocating(false); place(p.coords.latitude, p.coords.longitude, true); },
      () => { setLocating(false); setErr(t('locNoGps')); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-white" role="dialog" aria-modal="true" aria-label={t('locTitle')}>
      <div className="safe-t flex items-center justify-between gap-2 border-b-2 border-neutral-900 px-3 py-2">
        <h2 className="text-lg font-extrabold">{t('locTitle')}</h2>
        <button onClick={onClose} className="min-h-11 min-w-11 rounded-lg border-2 border-neutral-900 text-lg font-black" aria-label={t('cancel')}>✕</button>
      </div>
      <p className="px-3 py-1.5 text-sm font-semibold">{t('locHint')}</p>
      <div ref={box} className="min-h-0 flex-1" />
      <div className="safe-b space-y-2 border-t-2 border-neutral-900 p-3">
        {err && <div className="rounded-lg bg-stop px-3 py-2 text-sm font-bold text-white">{err}</div>}
        <div className="flex items-center justify-between gap-2 text-sm font-semibold tabular-nums">
          <span>📍 {pt.lat.toFixed(5)}, {pt.lon.toFixed(5)}</span>
          <button onClick={gps} disabled={locating} className="min-h-11 rounded-lg border-2 border-neutral-900 px-3 font-bold disabled:opacity-50">
            {locating ? '…' : '◎'} {t('locGps')}
          </button>
        </div>
        <Labeled label={t('locName')}>
          <input className={inputCls} value={name} maxLength={80} placeholder={t('locNamePh')} onChange={(e) => setName(e.target.value)} />
        </Labeled>
        <div className="grid grid-cols-2 gap-2">
          <Btn kind="ghost" onClick={() => onSave(null)}>{t('locReset')}</Btn>
          <Btn onClick={() => onSave({ name: name.trim(), lat: Math.round(pt.lat * 1e5) / 1e5, lon: Math.round(pt.lon * 1e5) / 1e5 })}>{t('locSave')}</Btn>
        </div>
      </div>
    </div>
  );
}
