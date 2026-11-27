/**
 * Mixing plan: how much of each product goes into the sprayer tank.
 * From spray volume (l/ha) and tank size: one full tank covers tank ÷ volume hectares, so each product needs
 * dose × that area per full tank. For the fields being sprayed: total liquid, number of fills, and the last
 * (partial) fill. With the working width: how many metres one tank lasts.
 */
export interface PlanInput {
  areaHa: number;
  waterLHa: number | null;
  tankL: number | null;
  widthM: number | null;
  products: { name: string; dose: number | null; unit: string }[];
}

export interface PlanProduct {
  name: string;
  /** Unit of the amounts: "l", "kg", "ml", "g". */
  unit: string;
  dosePerHa: number;
  perFullTank: number | null;
  total: number;
  lastTank: number | null;
}

export interface SprayPlan {
  areaHa: number;
  waterLHa: number;
  tankL: number | null;
  /** Hectares one full tank covers. */
  haPerTank: number | null;
  /** Metres driven per full tank at this working width. */
  metresPerTank: number | null;
  totalLiquidL: number;
  fullTanks: number;
  /** Liquid in the last, partial fill (0 = none). */
  lastTankL: number;
  products: PlanProduct[];
}

/** "1,5" or "1.5" → 1.5 */
export function parseNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const r = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function sprayPlan(i: PlanInput): SprayPlan | null {
  const water = parseNum(i.waterLHa);
  if (!water || !(i.areaHa > 0)) return null;
  const tank = parseNum(i.tankL);
  const width = parseNum(i.widthM);
  const totalLiquid = i.areaHa * water;
  const haPerTank = tank ? tank / water : null;
  let fullTanks = tank ? Math.floor(totalLiquid / tank + 1e-9) : 0;
  let lastTankL = tank ? totalLiquid - fullTanks * tank : 0;
  if (lastTankL < 0.5) lastTankL = 0; // rounding dust
  if (!tank) fullTanks = 0;
  const lastHa = water ? lastTankL / water : 0;
  return {
    areaHa: r(i.areaHa, 4), waterLHa: water, tankL: tank,
    haPerTank: haPerTank === null ? null : r(haPerTank, 3),
    metresPerTank: haPerTank !== null && width ? Math.round((haPerTank * 10_000) / width) : null,
    totalLiquidL: Math.round(totalLiquid),
    fullTanks, lastTankL: Math.round(lastTankL),
    products: i.products.filter((p) => parseNum(p.dose) !== null).map((p) => {
      const dose = parseNum(p.dose)!;
      return {
        name: p.name, unit: p.unit.replace(/\s*\/\s*ha$/i, ''), dosePerHa: dose,
        perFullTank: haPerTank === null ? null : r(dose * haPerTank, 3),
        total: r(dose * i.areaHa, 3),
        lastTank: tank && lastTankL > 0 ? r(dose * lastHa, 3) : null,
      };
    }),
  };
}
