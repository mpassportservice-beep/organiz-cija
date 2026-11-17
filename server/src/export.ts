import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import type { Lang, LogRecord } from '@spray/shared';
import { config } from './config';

const require = createRequire(import.meta.url);
const FONT = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const FONT_BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');

const WEATHER_KEYS = ['temp', 'rh', 'wind', 'gust', 'windDir', 'precipNow', 'dewPoint', 'deltaT', 'cloud', 'rain1h', 'rain2h', 'rain6h', 'minTempPast12', 'minTempNext12'];

function local(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('lv-LV', { timeZone: config.farm.timezone, ...o }).format(d);
  return { date: f({ year: 'numeric', month: '2-digit', day: '2-digit' }), time: f({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) };
}

const T = {
  lv: {
    title: 'Augu aizsardzības līdzekļu lietošanas uzskaite', date: 'Datums', start: 'Sākums', end: 'Beigas', field: 'Lauks', area: 'Platība, ha',
    crop: 'Kultūraugs', bbch: 'BBCH', product: 'AAL nosaukums', reg: 'Reģ. Nr.', dose: 'Deva', unit: 'Devas mērv.', water: 'Darba šķidrums, l/ha',
    purpose: 'Kaitīgais organisms / mērķis', bee: 'Bīstams bitēm', phi: 'Nogaidīšanas laiks, d', harvest: 'Agrākā raža', operator: 'Operators',
    cert: 'Apliecības Nr.', nozzle: 'Sprauslas', flag: 'Karogs', reason: 'Iemesls', prechecks: 'Pārbaudes', notes: 'Piezīmes', batch: 'Smidzināts kopā ar', weather: 'Laikapstākļi sākumā',
    yes: 'Jā', no: 'Nē', generated: 'Sagatavots', value: 'vērtība', source: 'avots', station: 'stacija', km: 'km', at: 'laiks', kind: 'veids', none: 'Nav ierakstu',
  },
  en: {
    title: 'Plant protection product usage record', date: 'Date', start: 'Start', end: 'End', field: 'Field', area: 'Area, ha',
    crop: 'Crop', bbch: 'BBCH', product: 'Product', reg: 'Reg. no.', dose: 'Dose', unit: 'Dose unit', water: 'Spray volume, l/ha',
    purpose: 'Target organism / purpose', bee: 'Bee-hazardous', phi: 'Pre-harvest interval, d', harvest: 'Earliest harvest', operator: 'Operator',
    cert: 'Certificate no.', nozzle: 'Nozzles', flag: 'Flag', reason: 'Reason', prechecks: 'Pre-checks', notes: 'Notes', batch: 'Sprayed together with', weather: 'Weather at start',
    yes: 'Yes', no: 'No', generated: 'Generated', value: 'value', source: 'source', station: 'station', km: 'km', at: 'time', kind: 'kind', none: 'No records',
  },
} as const;

/** Other fields of the same pass, e.g. "Grupa A – Lauks 2, Lauks 3". */
function batchText(r: LogRecord): string {
  if (!r.batch || r.batch.fields.length < 2) return '';
  const others = r.batch.fields.filter((n) => n !== r.field.name).join(', ');
  return r.batch.group ? `${r.batch.group} – ${others}` : others;
}

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s.replace(',', '.')))) s = `'${s}`; // no spreadsheet formula injection
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Semicolon-separated, UTF-8 with BOM (opens correctly in Excel with Latvian regional settings). One row per treatment. */
export function logsToCsv(records: LogRecord[], lang: Lang): string {
  const t = T[lang];
  const head: string[] = [t.date, t.start, t.end, t.field, t.area, t.crop, t.bbch, t.product, t.reg, t.dose, t.unit, t.water, t.purpose,
    t.bee, t.phi, t.harvest, t.operator, t.cert, t.nozzle, t.flag, t.reason, t.prechecks, t.notes, t.batch];
  for (const k of WEATHER_KEYS) head.push(`${k} ${t.value}`, `${k} ${t.source}`, `${k} ${t.station}`, `${k} ${t.km}`, `${k} ${t.at}`, `${k} ${t.kind}`);
  head.push('id', 'started_at_utc');
  const rows = records.map((r) => {
    const s = local(r.startedAt);
    const row: unknown[] = [s.date, s.time, local(r.endedAt).time, r.field.name, r.field.areaHa, r.crop.name, r.crop.bbch, r.product.name,
      r.product.regNumber, r.dose, r.doseUnit, r.waterLHa, r.purpose, r.product.beeHazard ? t.yes : t.no, r.product.phiDays, r.earliestHarvest,
      r.operator.name, r.operator.certificate, r.nozzle, r.flag, r.flagReason,
      r.prechecks.map((p) => `${p.checked ? '[x]' : '[ ]'} ${p.label}`).join(' | '), r.notes, batchText(r)];
    for (const k of WEATHER_KEYS) {
      const w = r.weather.find((x) => x.key === k);
      row.push(w ? `${w.value}${w.unit ? ' ' + w.unit : ''}` : '', w?.source, w?.station, w?.distanceKm, w ? `${local(w.time).date} ${local(w.time).time}` : '', w?.kind);
    }
    row.push(r.id, r.startedAt);
    return row.map(csvCell).join(';');
  });
  return '﻿' + [head.map(csvCell).join(';'), ...rows].join('\r\n') + '\r\n';
}

export function logsToPdf(records: LogRecord[], lang: Lang): Promise<Buffer> {
  const t = T[lang];
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: t.title } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('r', FONT).registerFont('b', FONT_BOLD);
    const W = doc.page.width - 80;
    const g = local(new Date().toISOString());
    doc.font('b').fontSize(15).text(t.title);
    doc.font('r').fontSize(9).fillColor('#444').text(`${config.farm.name} · ${t.generated}: ${g.date} ${g.time}`).fillColor('#000').moveDown(0.8);
    if (!records.length) doc.fontSize(11).text(t.none);

    const kv = (label: string, value: unknown) => {
      if (value === null || value === undefined || value === '') return;
      doc.font('b').fontSize(9).text(`${label}: `, { continued: true }).font('r').text(String(value));
    };
    for (const r of records) {
      if (doc.y > doc.page.height - 260) doc.addPage();
      const s = local(r.startedAt);
      const y0 = doc.y;
      doc.rect(40, y0, W, 20).fill('#111');
      doc.fillColor('#fff').font('b').fontSize(11).text(`${s.date}  ${s.time}${r.endedAt ? '–' + local(r.endedAt).time : ''}   ${r.field.name}   ${r.product.name}`, 46, y0 + 5, { width: W - 12, lineBreak: false });
      doc.fillColor('#000').text('', 40, y0 + 26);
      kv(t.field, `${r.field.name}${r.field.areaHa ? `, ${r.field.areaHa} ha` : ''}`);
      kv(t.crop, `${r.crop.name}${r.crop.bbch !== null ? `, BBCH ${r.crop.bbch}` : ''}`);
      kv(t.product, `${r.product.name}${r.product.regNumber ? ` (${t.reg} ${r.product.regNumber})` : ''}`);
      kv(t.dose, `${r.dose} ${r.doseUnit}${r.waterLHa ? ` · ${t.water}: ${r.waterLHa}` : ''}`);
      kv(t.purpose, r.purpose);
      if (r.batch && r.batch.fields.length > 1) kv(t.batch, batchText(r));
      kv(t.bee, r.product.beeHazard ? t.yes : t.no);
      kv(t.phi, r.product.phiDays !== null ? `${r.product.phiDays}${r.earliestHarvest ? ` → ${t.harvest}: ${r.earliestHarvest}` : ''}` : null);
      kv(t.operator, `${r.operator.name}${r.operator.certificate ? ` · ${t.cert} ${r.operator.certificate}` : ''}`);
      kv(t.nozzle, r.nozzle);
      kv(t.flag, `${r.flag.toUpperCase()} – ${r.flagReason}`);
      kv(t.prechecks, r.prechecks.map((p) => `${p.checked ? '☑' : '☐'} ${p.label}`).join('   '));
      kv(t.notes, r.notes);
      doc.moveDown(0.3).font('b').fontSize(9).text(t.weather);
      doc.font('r').fontSize(7.5);
      for (const w of r.weather) {
        const wt = local(w.time);
        doc.text(`${w.label}: ${w.value}${w.unit ? ' ' + w.unit : ''}  —  ${w.source}${w.station ? ', ' + w.station : ''}${w.distanceKm !== null ? `, ${w.distanceKm} km` : ''}, ${wt.date} ${wt.time} [${w.kind}]`, { width: W });
      }
      doc.moveDown(1);
    }
    doc.end();
  });
}
