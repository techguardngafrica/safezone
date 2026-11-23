export interface SalaryLine {
  label: string;
  amountKobo: number;
}

export interface SalaryPayload {
  basicKobo: number;
  allowances: readonly SalaryLine[];
  deductions: readonly SalaryLine[];
}

export function computeSalaryTotals(payload: SalaryPayload): {
  grossKobo: number;
  deductionsKobo: number;
  netKobo: number;
} {
  const allowancesKobo = payload.allowances.reduce((s, a) => s + a.amountKobo, 0);
  const deductionsKobo = payload.deductions.reduce((s, d) => s + d.amountKobo, 0);
  const grossKobo = payload.basicKobo + allowancesKobo;
  return { grossKobo, deductionsKobo, netKobo: grossKobo - deductionsKobo };
}

export function buildPayrollCsv(
  period: string,
  rows: readonly {
    staffNumber: string;
    jobTitle: string;
    basicKobo: number;
    grossKobo: number;
    deductionsKobo: number;
    netKobo: number;
  }[],
): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const header = 'period,staff_number,job_title,basic_ngn,gross_ngn,deductions_ngn,net_ngn';
  const lines = rows.map((r) =>
    [
      period,
      r.staffNumber,
      r.jobTitle,
      (r.basicKobo / 100).toFixed(2),
      (r.grossKobo / 100).toFixed(2),
      (r.deductionsKobo / 100).toFixed(2),
      (r.netKobo / 100).toFixed(2),
    ]
      .map(esc)
      .join(','),
  );
  return [header, ...lines].join('\n');
}
