import { describe, expect, it } from 'vitest';
import { defaultState, normalizeState, ruleContext, type AppState } from './state';

const fld = (id: string, cropId: string | null = null, bbch: number | null = null) =>
  ({ id, name: id, areaHa: 1, cropId, bbch, water: [], neighbours: [], hives: [] });

function state(patch: Partial<AppState>): AppState {
  return { ...defaultState(), fields: [fld('a', 'caraway', 30), fld('b'), fld('c')], selectedFieldId: 'b', ...patch };
}

describe('field groups', () => {
  it('older saved state without groups is upgraded', () => {
    const s = normalizeState({ fields: [fld('a')], selectedFieldId: 'a' });
    expect(s.groups).toEqual([]);
    expect(s.selectedGroupId).toBeNull();
  });

  it('no group selected → the selected field is the only target', () => {
    const r = ruleContext(state({}));
    expect(r.group).toBeNull();
    expect(r.field?.id).toBe('b');
    expect(r.targetFields.map((f) => f.id)).toEqual(['b']);
  });

  it('selected group → all its fields are targets, the first one gives crop and surroundings', () => {
    const r = ruleContext(state({ groups: [{ id: 'g', name: 'G', fieldIds: ['c', 'a'] }], selectedGroupId: 'g' }));
    expect(r.group?.id).toBe('g');
    expect(r.targetFields.map((f) => f.id)).toEqual(['a', 'c']);
    expect(r.field?.id).toBe('a');
    expect(r.crop).toEqual({ cropId: 'caraway', bbch: 30 });
  });

  it('empty or deleted group falls back to the selected field', () => {
    expect(ruleContext(state({ groups: [{ id: 'g', name: 'G', fieldIds: [] }], selectedGroupId: 'g' })).targetFields.map((f) => f.id)).toEqual(['b']);
    expect(ruleContext(state({ groups: [], selectedGroupId: 'gone' })).group).toBeNull();
  });
});
