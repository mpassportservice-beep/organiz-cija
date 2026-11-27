import { describe, expect, it } from 'vitest';
import { parseNum, sprayPlan } from './plan';
import { plantingAge } from './state';

describe('spray plan', () => {
  it('works out amounts per tank, totals and fills', () => {
    const p = sprayPlan({ areaHa: 10.82, waterLHa: 200, tankL: 1000, widthM: 12,
      products: [{ name: 'MCPA 750', dose: 1, unit: 'l/ha' }, { name: 'Lontrel', dose: 0.15, unit: 'kg/ha' }] })!;
    expect(p.haPerTank).toBe(5);            // 1000 l ÷ 200 l/ha
    expect(p.metresPerTank).toBe(4167);     // 5 ha × 10 000 m² ÷ 12 m
    expect(p.totalLiquidL).toBe(2164);
    expect(p.fullTanks).toBe(2);
    expect(p.lastTankL).toBe(164);
    expect(p.products[0]).toMatchObject({ unit: 'l', perFullTank: 5, total: 10.82, lastTank: 0.82 });
    expect(p.products[1]).toMatchObject({ unit: 'kg', perFullTank: 0.75, total: 1.623, lastTank: 0.123 });
  });
  it('exact multiple of the tank has no partial fill', () => {
    const p = sprayPlan({ areaHa: 10, waterLHa: 200, tankL: 1000, widthM: null, products: [{ name: 'X', dose: 50, unit: 'g/ha' }] })!;
    expect([p.fullTanks, p.lastTankL, p.products[0].lastTank, p.metresPerTank]).toEqual([2, 0, null, null]);
  });
  it('without a tank size gives totals only; without spray volume nothing', () => {
    const p = sprayPlan({ areaHa: 2, waterLHa: 150, tankL: null, widthM: 12, products: [{ name: 'X', dose: 1.5, unit: 'l/ha' }] })!;
    expect(p.products[0]).toMatchObject({ perFullTank: null, total: 3, lastTank: null });
    expect(p.haPerTank).toBeNull();
    expect(sprayPlan({ areaHa: 2, waterLHa: null, tankL: 1000, widthM: 12, products: [] })).toBeNull();
  });
  it('reads decimal commas', () => {
    expect(parseNum('1,5')).toBe(1.5);
    expect(parseNum(' 0.8 ')).toBe(0.8);
    expect(parseNum('')).toBeNull();
    expect(parseNum('-1')).toBeNull();
  });
});

describe('planting age', () => {
  const now = new Date('2026-06-01');
  it.each([[2026, 'šī gada stādījums'], [2025, '1 gads'], [2023, '3 gadi'], [2015, '11 gadi'], [2005, '21 gads'], [2027, 'stādīs 2027. gadā']])
    ('%i → %s', (y, s) => expect(plantingAge(y, now)).toBe(s));
  it('none', () => expect(plantingAge(null, now)).toBeNull());
});
