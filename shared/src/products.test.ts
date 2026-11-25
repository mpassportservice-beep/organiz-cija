import { describe, expect, it } from 'vitest';
import { combineProducts, parseSubstance, spectrumOf, splitList } from './products';
import { normalizeState, ruleContext } from './state';
import type { Product } from './types';

const P = (id: string, x: Partial<Product> = {}): Product => ({
  id, name: id, minTemp: null, maxTemp: null, rainFreeHours: null, maxWind: null, beeHazard: false, phiDays: null, bbchMin: null, bbchMax: null, ...x,
});

describe('tank mix', () => {
  it('takes the strictest limit of each kind', () => {
    const m = combineProducts([
      P('A', { minTemp: 8, maxTemp: 25, rainFreeHours: 2, maxWind: 4, phiDays: 30, bbchMin: 12, bbchMax: 39, spectrum: ['Balanda', 'Vējauzas'] }),
      P('B', { minTemp: 5, maxTemp: 20, rainFreeHours: 6, beeHazard: true, phiDays: 60, bbchMin: 20, bbchMax: 49, spectrum: ['balanda', 'Usnes'] }),
    ])!;
    expect(m).toMatchObject({ name: 'A + B', minTemp: 8, maxTemp: 20, rainFreeHours: 6, maxWind: 4, beeHazard: true, phiDays: 60, bbchMin: 20, bbchMax: 39 });
    expect(m.spectrum).toEqual(['Balanda', 'Vējauzas', 'Usnes']);
  });
  it('no common BBCH stage fails every stage', () => {
    const m = combineProducts([P('A', { bbchMin: 10, bbchMax: 20 }), P('B', { bbchMin: 30, bbchMax: 40 })])!;
    expect(m.bbchMin! > m.bbchMax!).toBe(true);
  });
  it('one product stays itself, none is null', () => {
    const a = P('A');
    expect(combineProducts([a])).toBe(a);
    expect(combineProducts([])).toBeNull();
  });
  it('rule context combines the selected products', () => {
    const s = normalizeState({ products: [P('a', { maxWind: 5 }), P('b', { maxWind: 3 })], selectedProductIds: ['a', 'b', 'gone'] });
    const r = ruleContext(s);
    expect(r.products.map((p) => p.id)).toEqual(['a', 'b']);
    expect(r.product?.maxWind).toBe(3);
  });
  it('old single selection is upgraded', () => {
    expect(normalizeState({ products: [P('a')], selectedProductId: 'a' }).selectedProductIds).toEqual(['a']);
    expect(normalizeState({}).selectedProductIds).toEqual([]);
  });
});

describe('text helpers', () => {
  it('parses active substances', () => {
    expect(parseSubstance('MCPA 750 g/l')).toEqual({ name: 'MCPA', amount: '750 g/l' });
    expect(parseSubstance('kletodims, 120 g/l')).toEqual({ name: 'kletodims', amount: '120 g/l' });
    expect(parseSubstance('tifensulfuron-metils 50 %')).toEqual({ name: 'tifensulfuron-metils', amount: '50 %' });
    expect(parseSubstance('glifosāts')).toEqual({ name: 'glifosāts', amount: '' });
    expect(parseSubstance('  ')).toBeNull();
  });
  it('splits lists on lines, commas and semicolons', () => {
    expect(splitList('Balanda, vējauzas\nUsnes; balanda\n\n')).toEqual(['Balanda', 'vējauzas', 'Usnes']);
    expect(spectrumOf([P('x')])).toEqual([]);
  });
});
