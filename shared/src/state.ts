import { mergeThresholds, type Thresholds } from './config';
import { inLatvia } from './latvia';
import { combineProducts } from './products';
import type { SprayPlan } from './plan';
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
  /** Plants per hectare. */
  plantsPerHa?: number | null;
  /** Rows per bed: 3 or 4. */
  rows?: 3 | 4 | null;
  /** Year the field was planted. */
  plantingYear?: number | null;
  /** Planted in spring or autumn of that year. */
  plantingSeason?: PlantingSeason | null;
}

export type PlantingSeason = 'spring' | 'autumn';

/** Sprayer used: remembered on the phone's farm settings like the operator. */
export interface Machine {
  vehicle: string;
  /** Tank volume, litres. */
  tankL: number | null;
  /** Working width, metres. */
  widthM: number | null;
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
  /** Products sprayed together (tank mix); empty = default limits. */
  selectedProductIds: string[];
  fields: Field[];
  selectedFieldId: string | null;
  groups: FieldGroup[];
  /** When set, the main screen works for this group (its first field gives crop and surroundings). */
  selectedGroupId: string | null;
  operator: { name: string; certificate: string };
  machine: Machine;
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
    selectedProductIds: [],
    fields: [{ id: 'f1', name: 'Lauks 1', areaHa: null, cropId: null, bbch: null, water: [], neighbours: [], hives: [] }],
    selectedFieldId: 'f1',
    groups: [],
    selectedGroupId: null,
    operator: { name: '', certificate: '' },
    machine: { vehicle: '', tankL: null, widthM: null },
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
    // Older saves (and phones still on the old version) hold a single selectedProductId.
    selectedProductIds: Array.isArray(s.selectedProductIds)
      ? s.selectedProductIds.filter((x): x is string => typeof x === 'string')
      : typeof (raw as { selectedProductId?: unknown }).selectedProductId === 'string' ? [(raw as { selectedProductId: string }).selectedProductId] : [],
    fields: Array.isArray(s.fields) && s.fields.length ? s.fields : d.fields,
    groups: Array.isArray(s.groups) ? s.groups : [],
    selectedGroupId: typeof s.selectedGroupId === 'string' ? s.selectedGroupId : null,
    operator: { ...d.operator, ...(s.operator ?? {}) },
    machine: { ...d.machine, ...(s.machine ?? {}) },
    location: validLocation(s.location),
  };
}

/** What the rules engine needs out of the saved settings. */
export function ruleContext(s: AppState): {
  thresholds: Thresholds; product: Product | null; products: Product[]; field: Field | null; crop: CropSelection; group: FieldGroup | null; targetFields: Field[];
} {
  const products = s.selectedProductIds.map((id) => s.products.find((p) => p.id === id)).filter((p): p is Product => !!p);
  const group = s.groups.find((g) => g.id === s.selectedGroupId) ?? null;
  const groupFields = group ? s.fields.filter((f) => group.fieldIds.includes(f.id)) : [];
  const field = groupFields[0] ?? s.fields.find((f) => f.id === s.selectedFieldId) ?? s.fields[0] ?? null;
  return {
    group: groupFields.length ? group : null,
    targetFields: groupFields.length ? groupFields : field ? [field] : [],
    thresholds: mergeThresholds(s.thresholds),
    products,
    product: combineProducts(products),
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

export interface LoggedProduct {
  name: string;
  regNumber: string;
  dose: string;
  doseUnit: string;
  activeSubstances: { name: string; amount: string }[];
}

/** One spraying record. Structured to carry what a plant protection product usage register needs. */
export interface LogRecord {
  id: string;
  startedAt: string;
  endedAt?: string | null;
  field: { id: string; name: string; areaHa: number | null; plantsPerHa?: number | null; rows?: 3 | 4 | null; plantingYear?: number | null; plantingSeason?: PlantingSeason | null };
  /** Sprayer and the mixing plan worked out from it. */
  machine?: Machine;
  plan?: SprayPlan | null;
  crop: { id: string | null; name: string; bbch: number | null };
  /** The whole tank mix as one entry ("A + B"); limits combined. Kept for exports and older records. */
  product: { name: string; regNumber: string; beeHazard: boolean; phiDays: number | null };
  /** For a single product the dose; for a mix the doses joined ("1 l/ha + 0.5 l/ha" goes into dose). */
  dose: string;
  doseUnit: string;
  /** Each product of the mix with its own dose. Records made before mixes existed do not have it. */
  products?: LoggedProduct[];
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
  /**
   * "active" from "Sākt smidzināšanu" until the operator presses "Pabeigts" for this field; only "done" records
   * count in exports. Records from before this existed have no status and count as done.
   */
  status?: 'active' | 'done';
  /** Weather when the field was finished. */
  weatherEnd?: WeatherSnapshotItem[];
}

export const isActive = (r: LogRecord) => r.status === 'active';

/** Minutes from start to finish, null while still running. */
export function durationMin(r: LogRecord): number | null {
  if (!r.endedAt) return null;
  const d = Date.parse(r.endedAt) - Date.parse(r.startedAt);
  return Number.isFinite(d) && d >= 0 ? Math.round(d / 60_000) : null;
}

/** Approximate planting date: spring = 1 May, autumn = 15 September. */
const seasonDate = (year: number, season: PlantingSeason) => new Date(year, season === 'spring' ? 4 : 8, season === 'spring' ? 1 : 15);

/** "2023. g. pavasaris" / "spring 2023" */
export function plantingLabel(year: number | null | undefined, season: PlantingSeason | null | undefined, lang: 'lv' | 'en' = 'lv'): string | null {
  if (!year) return null;
  if (!season) return String(year);
  return lang === 'lv' ? `${year}. g. ${season === 'spring' ? 'pavasaris' : 'rudens'}` : `${season === 'spring' ? 'spring' : 'autumn'} ${year}`;
}

/**
 * Age of a planting: "1 gads", "3 gadi", "21 gads". With a season it counts whole years from that spring/autumn
 * ("< 1 gads" in the first year); with only a year it is this year minus the planting year.
 */
export function plantingAge(year: number | null | undefined, now = new Date(), lang: 'lv' | 'en' = 'lv', season?: PlantingSeason | null): string | null {
  if (!year || !Number.isFinite(year)) return null;
  const words = (age: number) => (lang === 'en' ? `${age} year${age === 1 ? '' : 's'} old` : `${age} ${age % 10 === 1 && age % 100 !== 11 ? 'gads' : 'gadi'}`);
  if (season) {
    const d = seasonDate(year, season);
    if (d.getTime() > now.getTime()) return lang === 'lv' ? 'vēl nav iestādīts' : 'not planted yet';
    let age = now.getFullYear() - d.getFullYear();
    if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
    return age < 1 ? (lang === 'lv' ? '< 1 gads' : '< 1 year') : words(age);
  }
  const age = now.getFullYear() - year;
  if (age < 0) return lang === 'lv' ? `stādīs ${year}. gadā` : `to be planted in ${year}`;
  if (age === 0) return lang === 'lv' ? 'šī gada stādījums' : 'planted this year';
  return words(age);
}
