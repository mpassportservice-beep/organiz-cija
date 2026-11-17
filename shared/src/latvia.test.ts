import { describe, expect, it } from 'vitest';
import { inLatvia } from './latvia';
import { normalizeState } from './state';

describe('inLatvia', () => {
  it.each([
    ['Priekuļi', 57.315, 25.355], ['Rīga', 56.949, 24.105], ['Daugavpils', 55.875, 26.536],
    ['Liepāja (coast)', 56.511, 21.013], ['Ventspils (coast)', 57.394, 21.564], ['Zilupe (east border)', 56.386, 28.12],
  ])('%s is inside', (_n, lat, lon) => expect(inLatvia(lat, lon)).toBe(true));
  it.each([
    ['Tallinn', 59.437, 24.745], ['Võru, Estonia', 57.833, 27.019], ['Šiauliai, Lithuania', 55.934, 23.315],
    ['Vilnius', 54.687, 25.28], ['Pskov', 57.819, 28.332], ['Baltic Sea', 57.0, 20.4], ['Gulf of Riga centre', 57.6, 23.6],
  ])('%s is outside', (_n, lat, lon) => expect(inLatvia(lat, lon)).toBe(false));
  it('rejects nonsense', () => { expect(inLatvia(NaN, 25)).toBe(false); expect(inLatvia(0, 0)).toBe(false); });
});

describe('saved location', () => {
  it('keeps a valid point, rounded', () => {
    expect(normalizeState({ location: { name: 'Mājas', lat: 56.9491234567, lon: 24.1051234567 } }).location)
      .toEqual({ name: 'Mājas', lat: 56.94912, lon: 24.10512 });
  });
  it('drops points outside Latvia and garbage', () => {
    expect(normalizeState({ location: { name: 'X', lat: 59.4, lon: 24.7 } }).location).toBeNull();
    expect(normalizeState({ location: 'Rīga' }).location).toBeNull();
    expect(normalizeState({}).location).toBeNull();
  });
});
