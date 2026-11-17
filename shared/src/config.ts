/**
 * THE rules config. Every threshold the engine uses lives here.
 * Farmers can override any of these in Settings; overrides are merged on top
 * of DEFAULT_THRESHOLDS with mergeThresholds().
 */
export interface Thresholds {
  // 1. Wind, 10-min mean, m/s
  windCalmBelow: number; // < → AMBER (inversion / unpredictable drift)
  windGentleMax: number; // ≤ → GREEN, above → AMBER
  windStrongAbove: number; // > → RED
  // 2. Gusts, m/s
  gustRedAbove: number; // > → RED
  // 3. Rain
  rainFreeHours: number; // required dry window after spraying
  rainProbAmber: number; // % within the window, ≥ → AMBER
  rainProbRed: number; // % within the window, ≥ → RED
  rainMmAmber: number; // mm forecast within the window, ≥ → AMBER
  rainMmRed: number; // mm forecast within the window, ≥ → RED
  rainNowRedMm: number; // observed precipitation now (mm/h), > → RED
  // 4. Air temperature, °C
  tempRedBelow: number; // < → RED
  tempGreenMin: number; // GREEN band lower edge
  tempGreenMax: number; // GREEN band upper edge
  tempRedAbove: number; // > → RED
  // 5. Relative humidity, %
  humidityAmberBelow: number;
  // 6. Delta T, °C
  deltaTGreenMin: number; // < → AMBER
  deltaTGreenMax: number; // > → AMBER
  deltaTRedAbove: number; // > → RED
  // 7. Inversion risk
  inversionWindBelow: number; // m/s
  inversionCloudMax: number; // % cloud cover counted as "clear sky"
  inversionSunMarginMin: number; // minutes after sunrise / before sunset counted as "near"
  // 8. Frost
  frostTempC: number; // min temp ≤ → frost
  frostWindowHours: number; // look back / ahead this many hours
  // 9. Dew / leaf wetness
  dewSpreadAmberC: number; // temp − dew point ≤ → AMBER
  // Data handling
  staleMinutes: number; // observation older than this → stale, use forecast
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  windCalmBelow: 1,
  windGentleMax: 3,
  windStrongAbove: 5,
  gustRedAbove: 7,
  rainFreeHours: 2,
  rainProbAmber: 30,
  rainProbRed: 60,
  rainMmAmber: 0.1,
  rainMmRed: 0.5,
  rainNowRedMm: 0,
  tempRedBelow: 5,
  tempGreenMin: 8,
  tempGreenMax: 25,
  tempRedAbove: 28,
  humidityAmberBelow: 40,
  deltaTGreenMin: 2,
  deltaTGreenMax: 8,
  deltaTRedAbove: 10,
  inversionWindBelow: 1.5,
  inversionCloudMax: 25,
  inversionSunMarginMin: 90,
  frostTempC: 0,
  frostWindowHours: 24,
  dewSpreadAmberC: 2,
  staleMinutes: 30,
};

export function mergeThresholds(overrides?: Partial<Thresholds> | null): Thresholds {
  const out: Thresholds = { ...DEFAULT_THRESHOLDS };
  if (!overrides) return out;
  for (const k of Object.keys(DEFAULT_THRESHOLDS) as (keyof Thresholds)[]) {
    const v = overrides[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** Grouping + units for the settings screen. */
export const THRESHOLD_GROUPS: { id: string; keys: { key: keyof Thresholds; unit: string }[] }[] = [
  { id: 'wind', keys: [
    { key: 'windCalmBelow', unit: 'm/s' }, { key: 'windGentleMax', unit: 'm/s' },
    { key: 'windStrongAbove', unit: 'm/s' }, { key: 'gustRedAbove', unit: 'm/s' } ] },
  { id: 'rain', keys: [
    { key: 'rainFreeHours', unit: 'h' }, { key: 'rainProbAmber', unit: '%' }, { key: 'rainProbRed', unit: '%' },
    { key: 'rainMmAmber', unit: 'mm' }, { key: 'rainMmRed', unit: 'mm' }, { key: 'rainNowRedMm', unit: 'mm/h' } ] },
  { id: 'temp', keys: [
    { key: 'tempRedBelow', unit: '°C' }, { key: 'tempGreenMin', unit: '°C' },
    { key: 'tempGreenMax', unit: '°C' }, { key: 'tempRedAbove', unit: '°C' } ] },
  { id: 'air', keys: [
    { key: 'humidityAmberBelow', unit: '%' }, { key: 'deltaTGreenMin', unit: '°C' },
    { key: 'deltaTGreenMax', unit: '°C' }, { key: 'deltaTRedAbove', unit: '°C' }, { key: 'dewSpreadAmberC', unit: '°C' } ] },
  { id: 'inversion', keys: [
    { key: 'inversionWindBelow', unit: 'm/s' }, { key: 'inversionCloudMax', unit: '%' },
    { key: 'inversionSunMarginMin', unit: 'min' } ] },
  { id: 'frost', keys: [ { key: 'frostTempC', unit: '°C' }, { key: 'frostWindowHours', unit: 'h' } ] },
  { id: 'data', keys: [ { key: 'staleMinutes', unit: 'min' } ] },
];

export interface CropDef {
  id: string;
  lv: string;
  en: string;
}

export const CROPS: CropDef[] = [
  { id: 'cowslip', lv: 'Gaiļbikši (Primula veris)', en: 'Cowslip (Primula veris)' },
  { id: 'chamomile', lv: 'Ārstniecības kumelīte (Matricaria chamomilla)', en: 'German chamomile (Matricaria chamomilla)' },
  { id: 'caraway', lv: 'Ķimenes (Carum carvi)', en: 'Caraway (Carum carvi)' },
  { id: 'winter-wheat', lv: 'Ziemas kvieši', en: 'Winter wheat' },
  { id: 'spring-wheat', lv: 'Vasaras kvieši', en: 'Spring wheat' },
  { id: 'winter-barley', lv: 'Ziemas mieži', en: 'Winter barley' },
  { id: 'spring-barley', lv: 'Vasaras mieži', en: 'Spring barley' },
  { id: 'oats', lv: 'Auzas', en: 'Oats' },
  { id: 'rye', lv: 'Rudzi', en: 'Rye' },
  { id: 'triticale', lv: 'Tritikāle', en: 'Triticale' },
  { id: 'winter-rapeseed', lv: 'Ziemas rapsis', en: 'Winter rapeseed' },
  { id: 'spring-rapeseed', lv: 'Vasaras rapsis', en: 'Spring rapeseed' },
  { id: 'potatoes', lv: 'Kartupeļi', en: 'Potatoes' },
  { id: 'field-beans', lv: 'Lauka pupas', en: 'Field beans' },
  { id: 'peas', lv: 'Zirņi', en: 'Peas' },
  { id: 'buckwheat', lv: 'Griķi', en: 'Buckwheat' },
  { id: 'maize', lv: 'Kukurūza', en: 'Maize' },
  { id: 'grassland', lv: 'Zālāji', en: 'Grassland' },
  { id: 'other', lv: 'Cits', en: 'Other' },
];

/** BBCH principal growth stages (general scale); the farmer can also type an exact 0–99 code. */
export const BBCH_STAGES: { code: number; lv: string; en: string }[] = [
  { code: 0, lv: 'Dīgšana', en: 'Germination' },
  { code: 10, lv: 'Lapu attīstība', en: 'Leaf development' },
  { code: 20, lv: 'Cerošana / sānzaru veidošanās', en: 'Tillering / side shoots' },
  { code: 30, lv: 'Stiebrošana', en: 'Stem elongation' },
  { code: 40, lv: 'Ražas daļu attīstība / karoglapas maksts', en: 'Booting / harvestable parts' },
  { code: 50, lv: 'Vārpošana / ziedpumpuri', en: 'Heading / inflorescence emergence' },
  { code: 60, lv: 'Ziedēšana', en: 'Flowering' },
  { code: 70, lv: 'Augļu / graudu veidošanās', en: 'Fruit / grain development' },
  { code: 80, lv: 'Nogatavošanās', en: 'Ripening' },
  { code: 90, lv: 'Atmiršana', en: 'Senescence' },
];
