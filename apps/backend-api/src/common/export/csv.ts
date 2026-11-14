/** Plain values for export rows: dates as ISO strings, bigint money as integer strings. */
export function exportValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  return JSON.stringify(value);
}

export type ExportRow = Record<string, unknown>;

function cell(value: unknown): string {
  const plain = exportValue(value);
  if (plain === null) return '';
  let text = String(plain);
  // Spreadsheet formula injection: neutralise cells that a spreadsheet would evaluate.
  if (/^[=+\-@\t\r]/.test(text) && typeof plain === 'string') text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** RFC 4180 CSV with a header from the union of row keys (UTF-8 with BOM so Excel reads it). */
export function toCsv(rows: readonly ExportRow[]): string {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [
    columns.map(cell).join(','),
    ...rows.map((row) => columns.map((column) => cell(row[column])).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function toJson(rows: readonly ExportRow[]): string {
  return JSON.stringify(
    rows.map((row) =>
      Object.fromEntries(Object.entries(row).map(([key, value]) => [key, exportValue(value)])),
    ),
    null,
    2,
  );
}
