import { useEffect, useRef, useState } from 'react';
import { appendPlan, cells, emptyReport, headers, parsePlan, totals } from './production-report.ts';
import type { ProductionRow } from './production-report.ts';
import { exportProductionXlsx } from './production-xlsx.ts';

type Props = { onExport: (bytes: Uint8Array, name: string) => void; onSessionExpired: () => void };

const notices = {
  ADDED: '조회 결과를 추가했습니다.',
  INVALID_PLAN: '유효한 계획일과 순번을 입력해 주세요.',
  DUPLICATE_PLAN: '이미 조회한 작업지시입니다.',
  NOT_FOUND: '해당 계획의 결과가 없습니다.',
};

export default function FinalProductionReport({ onExport, onSessionExpired }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [report, setReport] = useState(emptyReport);
  const [notice, setNotice] = useState('');
  function clearInput() {
    setCode('');
    input.current?.focus();
  }

  const [loading, setLoading] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function query() {
    if (active.current) return;
    const plan = parsePlan(code);
    if (!plan || report.plans.includes(plan)) {
      setNotice(notices[plan ? 'DUPLICATE_PLAN' : 'INVALID_PLAN']);
      clearInput();
      return;
    }
    const [date, sequence] = plan.split('-');
    const iso = [date.slice(0, 4), date.slice(4, 6), date.slice(6)].join('-');
    const parameters = new URLSearchParams({ date: iso, sequence });
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    clearInput();
    try {
      const response = await fetch('/api/pop/production-report?' + parameters, {
        cache: 'no-store', signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok) throw new Error('report unavailable');
      const rows: ProductionRow[] = await response.json();
      if (!controller.signal.aborted) {
        const result = appendPlan(report, date + sequence, rows);
        setReport(result.report);
        setNotice(notices[result.status]);
      }
    } catch {
      if (!controller.signal.aborted) setNotice('조회 결과를 불러오지 못했습니다.');
    } finally {
      if (active.current === controller) {
        active.current = null;
        setLoading(false);
      }
    }
  }
  return (
    <section aria-labelledby="production-report-title">
      <h2 id="production-report-title">최종생산조회</h2>
      <form onSubmit={(event) => {
        event.preventDefault();
        void query();
      }}>
        <label>작업지시번호<input ref={input} value={code} onChange={(event) => setCode(event.target.value)} /></label>
        <button disabled={loading}>조회</button>
        <button type="button" onClick={clearInput}>입력 지우기</button>
        <button type="button" onClick={() => { active.current?.abort(); active.current = null; setLoading(false); setReport(emptyReport); setNotice(''); clearInput(); }}>전체 지우기</button>
      </form>
      <p role="status">{notice}</p>
      {report.rows.length > 0 && <table>
        <caption>최종생산 조회 결과</caption>
        <thead><tr>{headers.map((header) => <th scope="col" key={header}>{header}</th>)}</tr></thead>
        <tbody>{report.rows.map((row) => <tr key={row.index}>
          {cells(row).map((value, index) => <td key={headers[index]}>{value}</td>)}
        </tr>)}</tbody>
        <tfoot><tr><th scope="row" colSpan={8}>합계</th>
          {totals(report.rows).map((value, index) => <td key={headers[index + 8]}>{value}</td>)}
          <td colSpan={4} />
        </tr></tfoot>
      </table>}
      <button type="button" disabled={!report.rows.length} onClick={() => {
        const bytes = exportProductionXlsx(report);
        if (bytes) onExport(bytes, 'ProductionData.xlsx');
      }}>XLSX 내보내기</button>
    </section>
  );
}
