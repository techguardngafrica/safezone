import { describe, expect, it } from 'vitest';
import {
  childPath,
  expandLabels,
  isWithin,
  placementError,
  planBulk,
  propertyIdentifier,
} from './spaces';

describe('placement rules', () => {
  it('allows the usual hierarchies and skipped levels', () => {
    expect(placementError(null, 'phase')).toBeNull();
    expect(placementError(null, 'unit')).toBeNull();
    expect(placementError('phase', 'block')).toBeNull();
    expect(placementError('street', 'unit')).toBeNull();
    expect(placementError('block', 'floor')).toBeNull();
    expect(placementError('building', 'floor')).toBeNull();
    expect(placementError('floor', 'unit')).toBeNull();
    expect(placementError('zone', 'common_area')).toBeNull();
  });
  it('refuses upside-down trees and children of leaves', () => {
    expect(placementError('unit', 'unit')).toMatch(/cannot contain/);
    expect(placementError('common_area', 'unit')).toMatch(/cannot contain/);
    expect(placementError('building', 'block')).toMatch(/cannot be inside/);
    expect(placementError('street', 'block')).toMatch(/cannot be inside/);
    expect(placementError(null, 'floor')).toMatch(/floor/);
    expect(placementError('zone', 'floor')).toMatch(/floor/);
  });
});

describe('paths', () => {
  it('builds and compares materialised paths', () => {
    const root = childPath(null, '01936b2e-0000-7000-8000-000000000001');
    expect(root).toBe('01936b2e000070008000000000000001');
    const child = childPath(root, '01936b2e-0000-7000-8000-000000000002');
    expect(child).toBe(`${root}.01936b2e000070008000000000000002`);
    expect(isWithin(child, root)).toBe(true);
    expect(isWithin(root, root)).toBe(true);
    expect(isWithin(`${root}9`, root)).toBe(false);
    expect(propertyIdentifier('k7m2qx', 'c-1-a')).toBe('K7M2QX-C-1-A');
  });
});

describe('bulk planning', () => {
  it('expands label ranges', () => {
    expect(expandLabels({ from: 1, to: 3 })).toEqual(['1', '2', '3']);
    expect(expandLabels({ from: 8, to: 10, pad: 2 })).toEqual(['08', '09', '10']);
    expect(expandLabels({ letters: { from: 'a', to: 'd' } })).toEqual(['A', 'B', 'C', 'D']);
    expect(expandLabels({ list: [' G01 ', '', 'G02'] })).toEqual(['G01', 'G02']);
    expect(expandLabels({ from: 5, to: 1 })).toEqual([]);
  });

  it('plans "Block C, floors 1-5, flats A-D" with unique unit codes', () => {
    const plan = planBulk({ type: 'block', code: 'C' }, [
      { type: 'floor', labels: { from: 1, to: 5 } },
      { type: 'unit', labels: { letters: { from: 'A', to: 'D' } } },
    ]);
    expect(plan).toHaveLength(5 + 20);
    const floors = plan.filter((space) => space.type === 'floor');
    expect(floors.map((floor) => floor.name)).toEqual([
      'Floor 1',
      'Floor 2',
      'Floor 3',
      'Floor 4',
      'Floor 5',
    ]);
    const units = plan.filter((space) => space.type === 'unit');
    expect(units.slice(0, 4).map((unit) => unit.code)).toEqual([
      'C-1-A',
      'C-1-B',
      'C-1-C',
      'C-1-D',
    ]);
    expect(new Set(units.map((unit) => unit.code)).size).toBe(20);
    expect(units[0]).toMatchObject({ name: 'Unit C-1-A', unitType: 'flat' });
    // Parents come before their children.
    for (const [index, space] of plan.entries()) expect(space.parentIndex).toBeLessThan(index);
  });

  it('supports templates and top-level houses', () => {
    const plan = planBulk({ type: null, code: null }, [
      {
        type: 'unit',
        labels: { from: 1, to: 3 },
        codeTemplate: 'H{label}',
        nameTemplate: 'House {label}',
        unitType: 'house',
      },
    ]);
    expect(plan.map((space) => [space.code, space.name, space.unitType])).toEqual([
      ['H1', 'House 1', 'house'],
      ['H2', 'House 2', 'house'],
      ['H3', 'House 3', 'house'],
    ]);
  });

  it('rejects invalid level orders, empty labels and huge plans', () => {
    expect(() =>
      planBulk({ type: 'unit', code: 'A1' }, [{ type: 'unit', labels: { from: 1, to: 2 } }]),
    ).toThrow(/cannot contain/);
    expect(() =>
      planBulk({ type: null, code: null }, [{ type: 'floor', labels: { from: 1, to: 2 } }]),
    ).toThrow(/floor/);
    expect(() =>
      planBulk({ type: 'block', code: 'C' }, [{ type: 'floor', labels: { list: [] } }]),
    ).toThrow(/No labels/);
    expect(() =>
      planBulk({ type: 'zone', code: 'Z' }, [
        { type: 'building', labels: { from: 1, to: 100 } },
        { type: 'floor', labels: { from: 1, to: 10 } },
        { type: 'unit', labels: { from: 1, to: 10 } },
      ]),
    ).toThrow(/At most/);
    expect(() => planBulk({ type: null, code: null }, [])).toThrow(/at least one level/);
  });
});
