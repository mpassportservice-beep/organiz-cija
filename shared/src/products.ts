import type { ActiveSubstance, Product } from './types';

const minOf = (v: (number | null)[]) => { const x = v.filter((n): n is number => n !== null); return x.length ? Math.min(...x) : null; };
const maxOf = (v: (number | null)[]) => { const x = v.filter((n): n is number => n !== null); return x.length ? Math.max(...x) : null; };

/**
 * A tank mix is as strict as its strictest product: highest minimum temperature, lowest maximum, longest
 * rain-free time, lowest wind limit, longest pre-harvest interval, the overlap of the BBCH ranges, and bee-hazardous
 * if any product is. The rules engine treats the result like one product named "A + B".
 */
export function combineProducts(list: Product[]): Product | null {
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  let bbchMin = maxOf(list.map((p) => p.bbchMin));
  let bbchMax = minOf(list.map((p) => p.bbchMax));
  // No common stage at all: keep an empty range so every stage fails the check.
  if (bbchMin !== null && bbchMax !== null && bbchMin > bbchMax) { bbchMin = 100; bbchMax = -1; }
  return {
    id: list.map((p) => p.id).join('+'),
    name: list.map((p) => p.name).join(' + '),
    minTemp: maxOf(list.map((p) => p.minTemp)),
    maxTemp: minOf(list.map((p) => p.maxTemp)),
    rainFreeHours: maxOf(list.map((p) => p.rainFreeHours)),
    maxWind: minOf(list.map((p) => p.maxWind)),
    beeHazard: list.some((p) => p.beeHazard),
    phiDays: maxOf(list.map((p) => p.phiDays)),
    bbchMin, bbchMax,
    regNumber: list.map((p) => p.regNumber).filter(Boolean).join(', '),
    activeSubstances: list.flatMap((p) => p.activeSubstances ?? []),
    spectrum: spectrumOf(list),
  };
}

/** Everything the chosen products control, each target once (case-insensitive), in the order first met. */
export function spectrumOf(list: Product[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of list) for (const s of p.spectrum ?? []) {
    const k = s.trim().toLocaleLowerCase('lv');
    if (k && !seen.has(k)) { seen.add(k); out.push(s.trim()); }
  }
  return out;
}

/** "MCPA 750 g/l" → { name: "MCPA", amount: "750 g/l" }; also accepts "MCPA, 750 g/l" or just "MCPA". */
export function parseSubstance(line: string): ActiveSubstance | null {
  const s = line.trim();
  if (!s) return null;
  const m = s.match(/^(.*?)[\s,;:–-]+(\d[\d.,]*\s*(?:g|mg|kg|ml|l|%)\s*(?:\/\s*(?:l|kg|ha))?)\s*$/i);
  return m ? { name: m[1].trim(), amount: m[2].replace(/\s+/g, ' ').trim() } : { name: s, amount: '' };
}

/** Free text (one per line, or separated by commas/semicolons) → list without blanks or repeats. */
export function splitList(text: string): string[] {
  return spectrumOf([{ spectrum: text.split(/[\n;,]+/) } as Product]);
}
