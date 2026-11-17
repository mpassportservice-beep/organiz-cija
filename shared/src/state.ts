import { mergeThresholds, type Thresholds } from './config';
import { inLatvia } from './latvia';
import type { CropSelection, Lang, Product, Reading } from './types';

/** 8 compass sectors (0 = N, clockwise) in which a sensitive object lies, seen from the field. */
export interface Field {
  id: string;
  name: string;
  areaHa: number | null;
  cropId: string | null;
  bbch: number | null;
  water: number[];
  neighbours: number[];
  hives: number[];
}

/** Fields sprayed together in one pass (many small plots side by side). */
export interface FieldGroup {
  id: string;
  name: string;
  fieldIds: string[];
}

/** Point the weather is fetched for (forecast at the point, observations from the nearest stations). */
export interface FarmLocation {
  name: string;
  lat: number;
  lon: number;
}

export function validLocation(l: unknown): FarmLocation | null {
  if (!l || typeof l !== 'object') return null;
  const x = l as Partial<FarmLocation>;
  const lat = Number(x.lat), lon = Number(x.lon);
  if (!inLatvia(lat, lon)) return null;
  return { name: typeof x.name === 'string' ? x.name.slice(0, 80) : '', lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5 };
}

export interface AppState {
  version: 1;
  updatedAt: string;
  lang: Lang;
  thresholds: Partial<Thresholds>;
  products: Product[];
  selectedProductId: string | null;
  fields: Field[];
  selectedFieldId: string | null;
  groups: FieldGroup[];
  /** When set, the main screen works for this group (its first field gives crop and surroundings). */
  selectedGroupId: string | null;
  operator: { name: string; certificate: string };
  nozzle: string;
  /** null = the server's default farm (Priekuļi unless configured otherwise). */
  location: FarmLocation | null;
}

export const NOZZLES = [
  { id: 'standard', lv: 'Standarta plakanstrūklas', en: 'Standard flat fan', reduction: 0 },
  { id: 'dr50', lv: 'Noneses samazināšana 50 %', en: 'Drift reduction 50 %', reduction: 50 },
  { id: 'dr75', lv: 'Noneses samazināšana 75 %', en: 'Drift reduction 75 %', reduction: 75 },
  { id: 'dr90', lv: 'Noneses samazināšana 90 %', en: 'Drift reduction 90 %', reduction: 90 },
  { id: 'dr95', lv: 'Noneses samazināšana 95 %', en: 'Drift reduction 95 %', reduction: 95 },
];

export function defaultState(): AppState {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    lang: 'lv',
    thresholds: {},
    products: [],
    selectedProductId: null,
    fields: [{ id: 'f1', name: 'Lauks 1', areaHa: null, cropId: null, bbch: null, water: [], neighbours: [], hives: [] }],
    selectedFieldId: 'f1',
    groups: [],
    selectedGroupId: null,
    operator: { name: '', certificate: '' },
    nozzle: '',
    location: null,
  };
}

export function normalizeState(raw: unknown): AppState {
  const d = defaultState();
  if (!raw || typeof raw !== 'object') return d;
  const s = raw as Partial<AppState>;
  return {
    ...d,
    ...s,
    version: 1,
    thresholds: s.thresholds ?? {},
    products: Array.isArray(s.products) ? s.products : [],
    fields: Array.isArray(s.fields) && s.fields.length ? s.fields : d.fields,
    groups: Array.isArray(s.groups) ? s.groups : [],
    selectedGroupId: typeof s.selectedGroupId === 'string' ? s.selectedGroupId : null,
    operator: { ...d.operator, ...(s.operator ?? {}) },
    location: validLocation(s.location),
  };
}

/** What the rules engine needs out of the saved settings. */
export function ruleContext(s: AppState): {
  thresholds: Thresholds; product: Product | null; field: Field | null; crop: CropSelection; group: FieldGroup | null; targetFields: Field[];
} {
  const group = s.groups.find((g) => g.id === s.selectedGroupId) ?? null;
  const groupFields = group ? s.fields.filter((f) => group.fieldIds.includes(f.id)) : [];
  const field = groupFields[0] ?? s.fields.find((f) => f.id === s.selectedFieldId) ?? s.fields[0] ?? null;
  return {
    group: groupFields.length ? group : null,
    targetFields: groupFields.length ? groupFields : field ? [field] : [],
    thresholds: mergeThresholds(s.thresholds),
    product: s.products.find((p) => p.id === s.selectedProductId) ?? null,
    field,
    crop: { cropId: field?.cropId ?? null, bbch: field?.bbch ?? null },
  };
}

export interface WeatherSnapshotItem {
  key: string;
  label: string;
  value: string;
  unit: string;
  source: string;
  station: string;
  distanceKm: number | null;
  time: string;
  kind: 'observation' | 'forecast' | 'forecast-fallback' | 'stale-observation' | 'derived';
}

export function readingKind(r: Reading): WeatherSnapshotItem['kind'] {
  if (r.stale) return 'stale-observation';
  if (r.fallback) return 'forecast-fallback';
  return r.isForecast ? 'forecast' : 'observation';
}

/** One spraying record. Structured to carry what a plant protection product usage register needs. */
export interface LogRecord {
  id: string;
  startedAt: string;
  endedAt?: string | null;
  field: { id: string; name: string; areaHa: number | null };
  crop: { id: string | null; name: string; bbch: number | null };
  product: { name: string; regNumber: string; beeHazard: boolean; phiDays: number | null };
  dose: string;
  doseUnit: string;
  waterLHa: string;
  purpose: string;
  earliestHarvest: string | null;
  operator: { name: string; certificate: string };
  nozzle: string;
  flag: 'green' | 'amber' | 'red';
  flagReason: string;
  checks: { id: string; label: string; status: string; reason: string }[];
  weather: WeatherSnapshotItem[];
  prechecks: { id: string; label: string; checked: boolean }[];
  notes: string;
  /** Records made in one pass over several fields share a batch id and list all fields of the pass. */
  batch?: { id: string; group: string | null; fields: string[] } | null;
  /** Set by the server from the signed-in account. */
  recordedBy?: { name: string; email: string };
}
