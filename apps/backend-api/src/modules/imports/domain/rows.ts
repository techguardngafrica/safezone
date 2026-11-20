import {
  type BulkImportKind,
  MAX_KOBO,
  phoneE164Schema,
  spaceCodeSchema,
  unitTypeSchema,
} from '@safezone/schemas';
import type { Permission } from '@safezone/permissions';

/**
 * Bulk import rows (management-web.md §6.4, tenancy.md §7.8). Pure functions: CSV records are
 * validated and normalised here; the owning modules apply them later (imports never write other
 * modules' tables).
 */

export interface RowError {
  row: number;
  field: string | null;
  message: string;
}

export type OccupancyType = 'owner_occupier' | 'tenant' | 'other';
/** Unit statuses an import may set. `occupied` is derived from occupancy, never imported. */
export type ImportableUnitStatus = 'vacant' | 'under_construction' | 'reserved';

export type ImportRow =
  | {
      kind: 'units';
      row: number;
      code: string;
      name: string;
      unitType: 'house' | 'flat' | 'shop' | 'office' | 'other';
      bedrooms: number | null;
      status: ImportableUnitStatus;
      externalRef: string | null;
    }
  | {
      kind: 'owners';
      row: number;
      unitCode: string;
      fullName: string;
      phone: string;
      shareBasisPoints: number;
    }
  | {
      kind: 'residents';
      row: number;
      unitCode: string;
      fullName: string;
      phone: string;
      occupancyType: OccupancyType;
    }
  | {
      kind: 'households';
      row: number;
      unitCode: string;
      householdName: string;
      headName: string;
      headPhone: string;
      occupancyType: OccupancyType;
    }
  | {
      kind: 'vehicles';
      row: number;
      unitCode: string;
      plate: string;
      make: string | null;
      model: string | null;
      colour: string | null;
    }
  | {
      kind: 'opening_balances';
      row: number;
      unitCode: string;
      externalRef: string;
      amountKobo: number;
      description: string;
      dueDate: string;
    };

interface TemplateSpec {
  /** Columns that must be present in the header row. */
  required: string[];
  optional: string[];
  sample: string[];
}

export const TEMPLATES: Record<BulkImportKind, TemplateSpec> = {
  units: {
    required: ['code', 'name'],
    optional: ['unit_type', 'bedrooms', 'unit_status', 'external_ref'],
    sample: ['A-101', 'Block A Flat 101', 'flat', '3', 'vacant', 'LEGACY-0001'],
  },
  owners: {
    required: ['unit_code', 'full_name', 'phone'],
    optional: ['share_percent'],
    sample: ['A-101', 'Adaeze Okonkwo', '+2348012345678', '100'],
  },
  residents: {
    required: ['unit_code', 'full_name', 'phone'],
    optional: ['occupancy_type'],
    sample: ['A-101', 'Chidi Nwachukwu', '+2348098765432', 'tenant'],
  },
  households: {
    required: ['unit_code', 'household_name', 'head_name', 'head_phone'],
    optional: ['occupancy_type'],
    sample: ['A-101', 'Nwachukwu Household', 'Chidi Nwachukwu', '+2348098765432', 'tenant'],
  },
  vehicles: {
    required: ['unit_code', 'plate'],
    optional: ['make', 'model', 'colour'],
    sample: ['A-101', 'LSR-421-AA', 'Toyota', 'Corolla', 'Silver'],
  },
  opening_balances: {
    required: ['unit_code', 'external_ref', 'amount_naira', 'description', 'due_date'],
    optional: [],
    sample: ['A-101', 'OB-2026-0001', '50000.00', 'Opening service charge balance', '2026-12-31'],
  },
};

/** The permission the owning module requires for each kind (same as its own endpoint). */
export const IMPORT_PERMISSIONS: Record<BulkImportKind, Permission> = {
  units: 'space.manage',
  owners: 'space.manage',
  residents: 'resident.approve',
  households: 'resident.approve',
  vehicles: 'resident.approve',
  opening_balances: 'billing.run.create',
};

export const MAX_IMPORT_ROWS = 5_000;

export function templateCsv(kind: BulkImportKind): { headers: string[]; csv: string } {
  const spec = TEMPLATES[kind];
  const headers = [...spec.required, ...spec.optional];
  return { headers, csv: `${headers.join(',')}\n${spec.sample.join(',')}\n` };
}

/** Required columns missing from the header row. */
export function missingHeaders(kind: BulkImportKind, headers: readonly string[]): string[] {
  const present = new Set(headers);
  return TEMPLATES[kind].required.filter((header) => !present.has(header));
}

/**
 * Parses a non-negative decimal with at most two fraction digits into hundredths (kobo, or basis
 * points for percentages) using integer arithmetic only. Returns null for anything else.
 */
export function parseHundredths(value: string): number | null {
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value.replace(/,/g, '').trim());
  if (!match?.[1]) return null;
  const whole = Number.parseInt(match[1], 10);
  const fraction = Number.parseInt((match[2] ?? '').padEnd(2, '0'), 10);
  const result = whole * 100 + fraction;
  return Number.isSafeInteger(result) ? result : null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function isRealDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const OCCUPANCY_TYPES = new Set<OccupancyType>(['owner_occupier', 'tenant', 'other']);
const IMPORTABLE_STATUSES = new Set<ImportableUnitStatus>([
  'vacant',
  'under_construction',
  'reserved',
]);

function text(row: Record<string, string>, field: string): string {
  return (row[field] ?? '').trim();
}

function optionalText(row: Record<string, string>, field: string, max: number): string | null {
  const value = text(row, field);
  return value.length > 0 ? value.slice(0, max) : null;
}

function normalisePlateKey(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** The key a row is matched on, so a file cannot contain the same record twice. */
export function rowKey(row: ImportRow): string {
  switch (row.kind) {
    case 'units':
      return `unit:${row.code.toLowerCase()}`;
    case 'owners':
      return `owner:${row.unitCode.toLowerCase()}:${row.phone}`;
    case 'residents':
      return `resident:${row.unitCode.toLowerCase()}:${row.phone}`;
    case 'households':
      return `household:${row.unitCode.toLowerCase()}`;
    case 'vehicles':
      return `vehicle:${normalisePlateKey(row.plate)}`;
    case 'opening_balances':
      return `balance:${row.unitCode.toLowerCase()}:${row.externalRef.toLowerCase()}`;
  }
}

function validateOne(
  kind: BulkImportKind,
  raw: Record<string, string>,
  row: number,
  today: string,
): { value: ImportRow | null; errors: RowError[] } {
  const errors: RowError[] = [];
  const fail = (field: string, message: string) => errors.push({ row, field, message });

  const phoneOf = (field: string): string => {
    const parsed = phoneE164Schema.safeParse(text(raw, field));
    if (!parsed.success) fail(field, 'Enter a Nigerian phone number in +234 format');
    return parsed.success ? parsed.data : '';
  };
  const nameOf = (field: string, label: string): string => {
    const value = text(raw, field);
    if (value.length < 2 || value.length > 120) fail(field, `${label} must be 2 to 120 characters`);
    return value;
  };
  const occupancyTypeOf = (): OccupancyType => {
    const value = text(raw, 'occupancy_type').toLowerCase() || 'tenant';
    if (!OCCUPANCY_TYPES.has(value as OccupancyType)) {
      fail('occupancy_type', 'Must be owner_occupier, tenant or other');
      return 'tenant';
    }
    return value as OccupancyType;
  };

  if (kind === 'units') {
    const code = spaceCodeSchema.safeParse(text(raw, 'code'));
    if (!code.success) fail('code', 'Unit code is required (letters, numbers, . _ / -)');
    const name = text(raw, 'name');
    if (name.length < 1 || name.length > 120) fail('name', 'Unit name must be 1 to 120 characters');
    const unitTypeRaw = text(raw, 'unit_type').toLowerCase() || 'other';
    const unitType = unitTypeSchema.safeParse(unitTypeRaw);
    if (!unitType.success) fail('unit_type', 'Must be house, flat, shop, office or other');
    const bedroomsRaw = text(raw, 'bedrooms');
    let bedrooms: number | null = null;
    if (bedroomsRaw) {
      if (!/^\d{1,2}$/.test(bedroomsRaw) || Number(bedroomsRaw) > 50) {
        fail('bedrooms', 'Must be a whole number from 0 to 50');
      } else {
        bedrooms = Number(bedroomsRaw);
      }
    }
    const statusRaw = text(raw, 'unit_status').toLowerCase() || 'vacant';
    if (!IMPORTABLE_STATUSES.has(statusRaw as ImportableUnitStatus)) {
      fail(
        'unit_status',
        'Must be vacant, under_construction or reserved (occupied is set by occupancy)',
      );
    }
    const externalRef = optionalText(raw, 'external_ref', 100);
    if (errors.length > 0 || !code.success || !unitType.success) return { value: null, errors };
    return {
      value: {
        kind,
        row,
        code: code.data,
        name,
        unitType: unitType.data,
        bedrooms,
        status: statusRaw as ImportableUnitStatus,
        externalRef,
      },
      errors,
    };
  }

  const unitCode = text(raw, 'unit_code');
  if (!unitCode) fail('unit_code', 'Unit code is required');

  switch (kind) {
    case 'owners': {
      const fullName = nameOf('full_name', 'Full name');
      const phone = phoneOf('phone');
      const shareRaw = text(raw, 'share_percent') || '100';
      const share = parseHundredths(shareRaw);
      if (share === null || share <= 0 || share > 10_000) {
        fail('share_percent', 'Must be a percentage above 0 and at most 100');
      }
      if (errors.length > 0 || share === null) return { value: null, errors };
      return {
        value: { kind, row, unitCode, fullName, phone, shareBasisPoints: share },
        errors,
      };
    }
    case 'residents': {
      const fullName = nameOf('full_name', 'Full name');
      const phone = phoneOf('phone');
      const occupancyType = occupancyTypeOf();
      if (errors.length > 0) return { value: null, errors };
      return { value: { kind, row, unitCode, fullName, phone, occupancyType }, errors };
    }
    case 'households': {
      const householdName = nameOf('household_name', 'Household name');
      const headName = nameOf('head_name', 'Head name');
      const headPhone = phoneOf('head_phone');
      const occupancyType = occupancyTypeOf();
      if (errors.length > 0) return { value: null, errors };
      return {
        value: { kind, row, unitCode, householdName, headName, headPhone, occupancyType },
        errors,
      };
    }
    case 'vehicles': {
      const plate = text(raw, 'plate');
      const normalised = normalisePlateKey(plate);
      if (normalised.length < 3 || plate.length > 15) {
        fail('plate', 'Enter a valid plate number (3 to 15 characters)');
      }
      if (errors.length > 0) return { value: null, errors };
      return {
        value: {
          kind,
          row,
          unitCode,
          plate,
          make: optionalText(raw, 'make', 40),
          model: optionalText(raw, 'model', 40),
          colour: optionalText(raw, 'colour', 30),
        },
        errors,
      };
    }
    case 'opening_balances': {
      const externalRef = text(raw, 'external_ref');
      if (externalRef.length < 1 || externalRef.length > 100) {
        fail('external_ref', 'A reference (1 to 100 characters) is required so re-imports update');
      }
      const amountKobo = parseHundredths(text(raw, 'amount_naira'));
      if (amountKobo === null || amountKobo <= 0 || amountKobo > MAX_KOBO) {
        fail('amount_naira', 'Must be a positive amount in naira with at most 2 decimal places');
      }
      const description = text(raw, 'description');
      if (description.length < 2 || description.length > 120) {
        fail('description', 'Description must be 2 to 120 characters');
      }
      const dueDate = text(raw, 'due_date');
      if (!isRealDate(dueDate)) fail('due_date', 'Use the YYYY-MM-DD format');
      else if (dueDate < today) fail('due_date', 'The due date cannot be in the past');
      if (errors.length > 0 || amountKobo === null) return { value: null, errors };
      return {
        value: { kind, row, unitCode, externalRef, amountKobo, description, dueDate },
        errors,
      };
    }
  }
}

/**
 * Validates every record. Row numbers count the header as row 1, matching what spreadsheet users see.
 * A row that repeats an earlier row's key is an error (the first one wins).
 */
export function validateRows(
  kind: BulkImportKind,
  records: readonly Record<string, string>[],
  today: string,
): { valid: ImportRow[]; errors: RowError[] } {
  const valid: ImportRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  records.forEach((raw, index) => {
    const row = index + 2;
    const result = validateOne(kind, raw, row, today);
    if (!result.value) {
      errors.push(...result.errors);
      return;
    }
    const key = rowKey(result.value);
    const first = seen.get(key);
    if (first !== undefined) {
      errors.push({ row, field: null, message: `Duplicate of row ${first}` });
      return;
    }
    seen.set(key, row);
    valid.push(result.value);
  });
  return { valid, errors };
}
