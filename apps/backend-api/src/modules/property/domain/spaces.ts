/** Spaces tree rules (property.md §2.1, §4). Estates use only the levels they need. */
export const SPACE_TYPES = [
  'phase',
  'zone',
  'street',
  'block',
  'building',
  'floor',
  'unit',
  'common_area',
] as const;
export type SpaceType = (typeof SPACE_TYPES)[number];

export const UNIT_STATUSES = ['vacant', 'occupied', 'under_construction', 'reserved'] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

/** Depth order. A child must sit strictly below its parent; streets and blocks share a level. */
const RANK: Record<SpaceType, number> = {
  phase: 1,
  zone: 2,
  street: 3,
  block: 3,
  building: 4,
  floor: 5,
  unit: 6,
  common_area: 6,
};

export const MAX_TREE_DEPTH = 8;

/** Null when `child` may be placed under `parent` (null parent = top level), else the reason. */
export function placementError(parent: SpaceType | null, child: SpaceType): string | null {
  if (child === 'floor' && parent !== 'building' && parent !== 'block') {
    return 'A floor must be inside a building or block';
  }
  if (parent === null) return null;
  if (parent === 'unit' || parent === 'common_area')
    return `A ${parent.replace('_', ' ')} cannot contain other spaces`;
  if (RANK[child] <= RANK[parent]) {
    return `A ${child.replace('_', ' ')} cannot be inside a ${parent.replace('_', ' ')}`;
  }
  return null;
}

/** Compact path label for a space id (UUID without dashes). */
export function pathLabel(spaceId: string): string {
  return spaceId.replace(/-/g, '');
}

export function childPath(parentPath: string | null, spaceId: string): string {
  return parentPath ? `${parentPath}.${pathLabel(spaceId)}` : pathLabel(spaceId);
}

/** True when `candidate` is `ancestorPath` itself or below it (re-parenting under itself is refused). */
export function isWithin(candidate: string, ancestorPath: string): boolean {
  return candidate === ancestorPath || candidate.startsWith(`${ancestorPath}.`);
}

/** The estate-wide property identifier: "<estate code>-<unit code>" (property.md §2.3). */
export function propertyIdentifier(estateCode: string, unitCode: string): string {
  return `${estateCode}-${unitCode}`.toUpperCase();
}

// ---- Bulk creation -----------------------------------------------------------------------------

export type LabelSpec =
  | { from: number; to: number; pad?: number }
  | { letters: { from: string; to: string } }
  | { list: readonly string[] };

export interface BulkLevel {
  type: SpaceType;
  labels: LabelSpec;
  /** Tokens: {label}, {parentCode}, {chain} (codes from the bulk root down to the parent, joined by "-"). */
  codeTemplate?: string;
  nameTemplate?: string;
  unitType?: string;
}

export interface PlannedSpace {
  /** Index of the parent in the plan, or -1 for the bulk root's direct children. */
  parentIndex: number;
  type: SpaceType;
  code: string;
  name: string;
  unitType: string | null;
}

export const MAX_BULK_SPACES = 5000;

export function expandLabels(spec: LabelSpec): string[] {
  if ('list' in spec) return [...spec.list].map((label) => label.trim()).filter(Boolean);
  if ('letters' in spec) {
    const start = spec.letters.from.toUpperCase().charCodeAt(0);
    const end = spec.letters.to.toUpperCase().charCodeAt(0);
    if (!(start >= 65 && end <= 90 && start <= end)) return [];
    return Array.from({ length: end - start + 1 }, (_, index) =>
      String.fromCharCode(start + index),
    );
  }
  if (!Number.isInteger(spec.from) || !Number.isInteger(spec.to) || spec.from > spec.to) return [];
  return Array.from({ length: spec.to - spec.from + 1 }, (_, index) =>
    String(spec.from + index).padStart(spec.pad ?? 0, '0'),
  );
}

const DEFAULT_NAMES: Record<SpaceType, string> = {
  phase: 'Phase {label}',
  zone: 'Zone {label}',
  street: '{label} Street',
  block: 'Block {label}',
  building: 'Building {label}',
  floor: 'Floor {label}',
  unit: 'Unit {code}',
  common_area: '{label}',
};

function fill(template: string, tokens: Record<string, string>): string {
  return template.replace(
    /\{(label|parentCode|chain|code)\}/g,
    (_, key: string) => tokens[key] ?? '',
  );
}

/**
 * Expands "floors 1–5, flats A–D" into a planned tree (parents before children). Unit codes default to
 * "{chain}-{label}" so they stay unique across blocks (e.g. C-1-A). Throws a message for the caller.
 */
export function planBulk(
  root: { type: SpaceType | null; code: string | null },
  levels: readonly BulkLevel[],
): PlannedSpace[] {
  if (levels.length === 0) throw new Error('Add at least one level');
  let parentType = root.type;
  for (const level of levels) {
    const problem = placementError(parentType, level.type);
    if (problem) throw new Error(problem);
    parentType = level.type;
  }

  const plan: PlannedSpace[] = [];
  let frontier: { index: number; code: string | null; chain: string[] }[] = [
    { index: -1, code: root.code, chain: root.code ? [root.code] : [] },
  ];
  for (const level of levels) {
    const labels = expandLabels(level.labels);
    if (labels.length === 0) throw new Error(`No labels for the ${level.type} level`);
    const next: typeof frontier = [];
    for (const parent of frontier) {
      for (const label of labels) {
        const tokens = { label, parentCode: parent.code ?? '', chain: parent.chain.join('-') };
        const defaultCode =
          level.type === 'unit' && parent.chain.length > 0 ? '{chain}-{label}' : '{label}';
        const code = fill(level.codeTemplate ?? defaultCode, tokens)
          .replace(/^-+|-+$/g, '')
          .trim();
        if (!code) throw new Error(`The ${level.type} code template produced an empty code`);
        const name = fill(level.nameTemplate ?? DEFAULT_NAMES[level.type], {
          ...tokens,
          code,
        }).trim();
        plan.push({
          parentIndex: parent.index,
          type: level.type,
          code,
          name: name || code,
          unitType: level.type === 'unit' ? (level.unitType ?? 'flat') : null,
        });
        if (plan.length > MAX_BULK_SPACES) {
          throw new Error(`At most ${MAX_BULK_SPACES} spaces can be created at once`);
        }
        next.push({ index: plan.length - 1, code, chain: [...parent.chain, code] });
      }
    }
    frontier = next;
  }
  return plan;
}
