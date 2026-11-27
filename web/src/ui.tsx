import { useEffect, useRef, useState, type ReactNode } from 'react';
import { compass, type Field, type Lang, type Reading, type Status } from '@spray/shared';
import type { TFn } from './i18n';

const TZ = 'Europe/Riga';
export const fmtTime = (iso: string | number) =>
  new Intl.DateTimeFormat('lv-LV', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
export const fmtDate = (iso: string | number) =>
  new Intl.DateTimeFormat('lv-LV', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
export const localDateIso = (ms: number) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

/** 10.82 → "10,82" (Latvian), at most two decimals. */
export const fmtHa = (ha: number, lang: Lang) => {
  const s = String(Math.round(ha * 100) / 100);
  return lang === 'en' ? s : s.replace('.', ',');
};

export function ago(ms: number, lang: Lang, t: TFn): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return t('justNow');
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return lang === 'lv' ? `${h} h ${min % 60} min` : `${h} h ${min % 60} min`;
}

export const STATUS_BG: Record<Status, string> = {
  green: 'bg-go text-go-ink', amber: 'bg-warn text-warn-ink', red: 'bg-stop text-stop-ink', info: 'bg-neutral-200 text-neutral-900',
};

/** Status is never colour-only: ✓ circle, ! triangle, ✕ square. */
export function StatusIcon({ status, size = 36 }: { status: Status; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 36 36', 'aria-hidden': true } as const;
  if (status === 'green')
    return (<svg {...common}><circle cx="18" cy="18" r="17" fill="#15803d" /><path d="M10 18.5l5.5 5.5L26.5 12.5" fill="none" stroke="#fff" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" /></svg>);
  if (status === 'amber')
    return (<svg {...common}><path d="M18 2.5L35 32.5H1z" fill="#fbbf24" stroke="#0a0a0a" strokeWidth="2" strokeLinejoin="round" /><path d="M18 13v9" stroke="#0a0a0a" strokeWidth="4" strokeLinecap="round" /><circle cx="18" cy="27" r="2.3" fill="#0a0a0a" /></svg>);
  if (status === 'red')
    return (<svg {...common}><rect x="1.5" y="1.5" width="33" height="33" rx="6" fill="#b91c1c" /><path d="M11 11l14 14M25 11L11 25" stroke="#fff" strokeWidth="4.2" strokeLinecap="round" /></svg>);
  return (<svg {...common}><circle cx="18" cy="18" r="16" fill="#fff" stroke="#525252" strokeWidth="2.5" /><circle cx="18" cy="11.5" r="2.2" fill="#525252" /><path d="M18 17v9" stroke="#525252" strokeWidth="3.6" strokeLinecap="round" /></svg>);
}

/** Arrow pointing where the wind blows TO (meteorological direction = where it comes FROM). */
export function WindArrow({ fromDeg, size = 28 }: { fromDeg: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ transform: `rotate(${(fromDeg + 180) % 360}deg)` }} aria-hidden>
      <path d="M12 2l6.5 9H14v11h-4V11H5.5z" fill="currentColor" />
    </svg>
  );
}

/** "LVC ceļu meteostacija · Melturi · 13 km · 09:00" + FORECAST/STALE badges. */
export function SourceLine({ r, t, compact }: { r: Reading; t: TFn; compact?: boolean }) {
  return (
    <div className="text-[11px] leading-snug text-neutral-700">
      {(r.isForecast || r.stale) && (
        <span className={`mr-1 rounded px-1 py-px text-[10px] font-bold ${r.stale ? 'bg-neutral-900 text-white' : 'bg-blue-800 text-white'}`}>
          {r.stale ? t('staleBadge') : t('forecastBadge')}
        </span>
      )}
      {r.sourceLabel} · {r.station}
      {r.distanceKm !== null && <> · {r.distanceKm === 0 ? '0' : r.distanceKm} km</>} · {fmtTime(r.time)}
      {r.staleObservation && !compact && (
        <div className="text-neutral-500">
          {t('staleWas', { v: String(r.staleObservation.value), station: `${r.staleObservation.station}${r.staleObservation.distanceKm !== null ? ` ${r.staleObservation.distanceKm} km` : ''}`, time: fmtTime(r.staleObservation.time) })}
        </div>
      )}
    </div>
  );
}

export function Card({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-xl border-2 border-neutral-900 bg-white p-3">
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title && <h2 className="text-lg font-extrabold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Btn({ children, onClick, kind = 'primary', disabled, className = '', type = 'button' }: {
  children: ReactNode; onClick?: () => void; kind?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; className?: string; type?: 'button' | 'submit';
}) {
  const k = kind === 'primary' ? 'bg-neutral-950 text-white' : kind === 'danger' ? 'bg-white text-stop border-2 border-stop' : 'bg-white text-neutral-950 border-2 border-neutral-900';
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`min-h-12 rounded-lg px-4 text-base font-bold active:opacity-70 disabled:opacity-40 ${k} ${className}`}>
      {children}
    </button>
  );
}

export function Labeled({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold">{label}{hint && <span className="font-normal text-neutral-600"> · {hint}</span>}</span>
      {children}
    </label>
  );
}
export const inputCls = 'block w-full min-h-12 rounded-lg border-2 border-neutral-900 bg-white px-3 py-2';

/**
 * Number field that takes both "2,35" and "2.35" (Latvian keyboards give a comma).
 * Keeps what is typed while editing; `decimals` limits digits after the separator.
 */
export function NumInput({ value, onChange, placeholder, step = 'any', highlight, decimals, min }: {
  value: number | null; onChange: (v: number | null) => void; placeholder?: string; step?: string; highlight?: boolean; decimals?: number; min?: number;
}) {
  const maxDec = decimals ?? (step === '1' ? 0 : 6);
  // Latvian uses a decimal comma.
  const show = (v: number | null) => (v === null ? '' : document.documentElement.lang === 'en' ? String(v) : String(v).replace('.', ','));
  const [text, setText] = useState(show(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(show(value)); }, [value]);
  const pattern = maxDec === 0 ? /^-?\d*$/ : new RegExp(`^-?\\d*([.,]\\d{0,${maxDec}})?$`);
  return (
    <input className={`${inputCls} ${highlight ? 'bg-amber-100' : ''}`} type="text" inputMode={maxDec === 0 ? 'numeric' : 'decimal'}
      autoComplete="off" placeholder={placeholder} value={text}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; setText(show(value)); }}
      onChange={(e) => {
        const raw = e.target.value.replace(/\s/g, '');
        if (!pattern.test(raw) || (min !== undefined && min >= 0 && raw.startsWith('-'))) return; // reject the keystroke
        setText(raw);
        const n = Number(raw.replace(',', '.'));
        onChange(raw === '' || raw === '-' || raw === '.' || raw === ',' || !Number.isFinite(n) ? null : n);
      }} />
  );
}

export function Check({ checked, onChange, title, children, warn }: { checked: boolean; onChange: (v: boolean) => void; title: string; children?: ReactNode; warn?: boolean }) {
  return (
    <label className={`flex cursor-pointer gap-3 rounded-xl border-2 p-3 ${checked ? 'border-go bg-green-50' : warn ? 'border-stop bg-red-50' : 'border-neutral-900 bg-white'}`}>
      <input type="checkbox" className="mt-0.5 h-8 w-8 shrink-0 accent-green-700" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-base font-bold">{title}</span>
        {children && <span className="mt-1 block text-sm text-neutral-800">{children}</span>}
      </span>
    </label>
  );
}

const SECT = { water: '#1d4ed8', neighbours: '#7c2d12', hives: '#a16207' } as const;

/** Schematic field map: compass, where the spray drifts, and the sensitive objects marked for this field. */
export function FieldMap({ field, windFrom, lang, size = 220 }: { field: Field | null; windFrom: number | null; lang: Lang; size?: number }) {
  const c = 110;
  const pt = (deg: number, r: number) => [c + r * Math.sin((deg * Math.PI) / 180), c - r * Math.cos((deg * Math.PI) / 180)];
  const to = windFrom === null ? null : (windFrom + 180) % 360;
  const wedge = (center: number, half: number, r: number) => {
    const [x1, y1] = pt(center - half, r); const [x2, y2] = pt(center + half, r);
    return `M${c},${c} L${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2} Z`;
  };
  const marks: { key: keyof typeof SECT; glyph: string; r: number }[] = [
    { key: 'water', glyph: '≈', r: 86 }, { key: 'neighbours', glyph: '⌂', r: 68 }, { key: 'hives', glyph: '✿', r: 50 },
  ];
  return (
    <svg viewBox="0 0 220 220" width={size} height={size} role="img" aria-label="field map">
      <circle cx={c} cy={c} r="100" fill="#f5f5f5" stroke="#0a0a0a" strokeWidth="2" />
      {to !== null && <path d={wedge(to, 30, 100)} fill="#b91c1c" opacity="0.22" />}
      {[0, 90, 180, 270].map((d) => { const [x, y] = pt(d, 93); return (
        <text key={d} x={x} y={y + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#0a0a0a">{compass(d, lang)}</text>); })}
      {field && marks.flatMap((m) => field[m.key].map((s) => { const [x, y] = pt(s * 45, m.r); return (
        <g key={`${m.key}${s}`}><circle cx={x} cy={y} r="10" fill={SECT[m.key]} /><text x={x} y={y + 4.5} textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">{m.glyph}</text></g>); }))}
      <rect x={c - 20} y={c - 20} width="40" height="40" rx="3" fill="#bbf7d0" stroke="#15803d" strokeWidth="2" />
      {to !== null && (
        <g transform={`rotate(${to} ${c} ${c})`}>
          <path d={`M${c},${c + 34} L${c},${c - 30}`} stroke="#0a0a0a" strokeWidth="5" strokeLinecap="round" />
          <path d={`M${c - 11},${c - 26} L${c},${c - 44} L${c + 11},${c - 26} Z`} fill="#0a0a0a" />
        </g>
      )}
    </svg>
  );
}
