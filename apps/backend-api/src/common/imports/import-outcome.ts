/**
 * Result of applying one bulk-import row in its owning module (tenancy.md §7.8). Re-imports match
 * existing records and report `updated` or `unchanged` instead of creating duplicates.
 */
export type ImportOutcome = 'created' | 'updated' | 'unchanged';
