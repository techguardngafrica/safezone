/**
 * Minimal RFC-4180 CSV parser (handles quoted fields, escaped quotes `""`, CRLF/LF, and blank lines).
 * Zero external dependencies.
 */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const input = text.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field.trim());
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field.trim());
      field = '';
      if (row.some((cell) => cell.length > 0)) records.push(row);
      row = [];
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.some((cell) => cell.length > 0)) records.push(row);
  }

  const headerRow = records[0] ?? [];
  const headers = headerRow.map((h) => h.trim().toLowerCase());
  const rows = records.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, idx) => {
      if (header) obj[header] = cells[idx] ?? '';
    });
    return obj;
  });

  return { headers, rows };
}
