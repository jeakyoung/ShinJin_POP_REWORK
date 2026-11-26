export type ProductionRow = {
  order: string; plan: string; run: number; process: string; material: string;
  part: string; spec: string; ordered: number | null; good: number; bad: number | null;
  warehouse: string; worker: string; started: string; finished: string;
};

export type ReportRow = Readonly<ProductionRow> & { readonly index: number };

type BandCell = { key: keyof ReportRow | null; title: string; column: number; rowSpan?: number; colSpan?: number }
export const bands: BandCell[][] = [
  [
    { key: 'index', title: 'No', column: 0, rowSpan: 2 }, { key: 'order', title: '수주번호', column: 1 },
    { key: 'run', title: '작업순번', column: 2, rowSpan: 2 }, { key: 'process', title: '공정명', column: 3, rowSpan: 2 },
    { key: 'material', title: '재질명', column: 4, rowSpan: 2 }, { key: 'part', title: '품목코드', column: 5 },
    { key: 'ordered', title: '수주량', column: 6, colSpan: 2 }, { key: 'warehouse', title: '입고창고', column: 8, rowSpan: 2 },
    { key: 'worker', title: '작업자명', column: 9, rowSpan: 2 }, { key: null, title: '', column: 10, rowSpan: 2 },
  ],
  [
    { key: 'plan', title: '작업지시번호', column: 1 }, { key: 'spec', title: '규격', column: 5 },
    { key: 'good', title: '생산량', column: 6 }, { key: 'bad', title: '불량', column: 7 },
  ],
]

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
