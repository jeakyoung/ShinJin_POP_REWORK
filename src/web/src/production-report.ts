export type ProductionRow = {
  order: string; plan: string; run: number; process: string; material: string;
  part: string; spec: string; ordered: number | null; good: number; bad: number | null;
  warehouse: string; worker: string; started: string; finished: string;
};

type ReportRow = Readonly<ProductionRow> & { readonly index: number };

export const headers = [
  'No', '수주번호', '작업지시번호', '작업순번', '공정명', '재질명', '품목코드', '규격',
  '수주량', '생산량', '불량', '입고창고', '작업자명', '시작시간', '종료시간',
] as const;

export function cells(row: ReportRow): (number | string)[] {
  return [row.index, row.order, row.plan, row.run, row.process, row.material, row.part, row.spec,
    row.ordered ?? '', row.good, row.bad ?? '', row.warehouse, row.worker, row.started, row.finished];
}

export function parsePlan(text: string): string | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{1,10})$/.exec(text.trim());
  if (!match) return;
  const [, year, month, day, rawSequence] = match;
  const iso = [year, month, day].join('-');
  const date = new Date(iso + 'T00:00:00Z');
  const sequence = Number(rawSequence);
  if (year === '0000' || !Number.isFinite(date.valueOf()) ||
      date.toISOString().slice(0, 10) !== iso || sequence < 1 || sequence > 2147483647) return;
  return year + month + day + '-' + sequence;
}

export type Report = Readonly<{ rows: readonly ReportRow[]; plans: readonly string[] }>;
export const emptyReport: Report = Object.freeze({ rows: Object.freeze([]), plans: Object.freeze([]) });

export function appendPlan(report: Report, text: string, source: readonly ProductionRow[]) {
  const plan = parsePlan(text);
  if (!plan) return { status: 'INVALID_PLAN', report } as const;
  if (report.plans.includes(plan)) return { status: 'DUPLICATE_PLAN', report } as const;
  const matches = source.filter((row) => row.plan === plan);
  if (!matches.length) return { status: 'NOT_FOUND', report } as const;
  return {
    status: 'ADDED',
    report: {
      plans: [...report.plans, plan],
      rows: [...report.rows, ...matches.map((row, index) => Object.freeze({
        ...row, index: report.rows.length + index + 1,
      }))],
    },
  } as const;
}

export function totals(rows: readonly ReportRow[]) {
  const keys = ['ordered', 'good', 'bad'] as const;
  return keys.map((key) => {
    if (!rows.length || rows.some((row) => row[key] == null)) return '';
    return rows.reduce((sum, row) => sum + Math.round((row[key] ?? 0) * 1000), 0) / 1000;
  });
}