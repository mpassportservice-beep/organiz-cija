import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

export const config = {
  port: num(process.env.PORT, 8787),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? path.resolve(here, '../data/spray.sqlite'),
  webDist: path.resolve(here, '../../web/dist'),
  farm: {
    name: process.env.FARM_NAME ?? 'Priekuļi',
    lat: num(process.env.FARM_LAT, 57.315),
    lon: num(process.env.FARM_LON, 25.355),
    timezone: process.env.FARM_TZ ?? 'Europe/Riga',
  },
  fetchIntervalMin: num(process.env.FETCH_INTERVAL_MIN, 10),
  fetchTimeoutMs: num(process.env.FETCH_TIMEOUT_MS, 20000),
  ckanBase: process.env.CKAN_BASE ?? 'https://data.gov.lv/dati/api/3/action',
  lvc: {
    dataset: process.env.LVC_DATASET ?? 'aktualie-celu-meteorologisko-staciju-dati',
    /** Set explicitly to skip dataset discovery. */
    resourceId: process.env.LVC_RESOURCE_ID ?? '',
    stationsFile: process.env.LVC_STATIONS_FILE ?? path.resolve(here, '../lvc-stations.json'),
    maxStations: num(process.env.LVC_MAX_STATIONS, 2),
    maxKm: num(process.env.LVC_MAX_KM, 40),
    /** Timezone of timestamps that carry no offset. */
    timezone: process.env.LVC_TIMEZONE ?? 'Europe/Riga',
    apiKey: process.env.CKAN_API_KEY ?? '',
  },
  lvgmc: {
    dataResource: process.env.LVGMC_DATA_RESOURCE ?? '17460efb-ae99-4d1d-8144-1068f184b05f',
    stationsResource: process.env.LVGMC_STATIONS_RESOURCE ?? 'c32c7afd-0d05-44fd-8b24-1de85b4bf11d',
    /** Empty = nearest station to the farm (Priekuļi, RIPR99PA, for the default farm). */
    stationId: process.env.LVGMC_STATION_ID ?? '',
  },
  openMeteoBase: process.env.OPEN_METEO_BASE ?? 'https://api.open-meteo.com/v1/forecast',
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
};
export type Config = typeof config;
