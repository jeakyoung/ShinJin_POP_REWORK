export type Mode = 'integrated' | 'work-order' | 'lot' | 'worker';

export type Route =
  | { kind: 'work-order'; planDate: string; sequence: number }
  | { kind: 'lot' | 'worker' | 'list' | 'order-material-spec'; code: string };

export type ScanInput = {
  mode: Mode;
  text: string;
  terminator: string | null;
  focused: boolean;
  sessionKey: string | null;
  eventId: string;
};

export type Delivery<T> =
  | { status: 'DELIVERED' | 'REPLAYED'; route: Route; result: T }
  | { status: 'IGNORED' | 'INVALID_INPUT' | 'SESSION_REQUIRED' | 'EVENT_ID_REUSED' };

function workOrder(code: string): Route | undefined {
  if (!/^\d{9,14}$/.test(code)) return;
  const year = code.slice(0, 4);
  const month = code.slice(4, 6);
  const day = code.slice(6, 8);
  const planDate = [year, month, day].join('-');
  const date = new Date(planDate + 'T00:00:00Z');
  const sequence = Number(code.slice(8));
  if (year === '0000' || !Number.isFinite(date.valueOf()) ||
      date.toISOString().slice(0, 10) !== planDate || sequence < 1) return;
  return { kind: 'work-order', planDate, sequence };
}

export function parseScan(mode: Mode, text: string): Route | undefined {
  const code = text.trim();
  if (!code) return;
  if (mode === 'lot') return { kind: 'lot', code };
  if (mode === 'worker' || mode === 'integrated') {
    if (/^S\d{8}$/i.test(code)) return { kind: 'worker', code: code.toUpperCase() };
    if (mode === 'worker') return;
    if (/^P\d{14}$/.test(code)) return { kind: 'list', code };
    if (/^\d{6}S\d{5}[A-Z]\d{2}[A-Z]$/.test(code)) return { kind: 'order-material-spec', code };
  }
  return workOrder(code);
}

export function createScanDispatcher<T>(deliver: (route: Route) => T) {
  const receipts = new Map<string, { signature: string; route: Route; result: T }>();

  return (event: ScanInput): Delivery<T> => {
    if (!event.focused || event.terminator !== 'Enter') return { status: 'IGNORED' };
    const route = parseScan(event.mode, event.text);
    if (!event.eventId.trim() || !route) return { status: 'INVALID_INPUT' };
    const workerEntry = route.kind === 'worker';
    if (!workerEntry && !event.sessionKey?.trim()) return { status: 'SESSION_REQUIRED' };

    const key = JSON.stringify([event.sessionKey, event.eventId]);
    const signature = JSON.stringify(route);
    const prior = receipts.get(key);
    if (prior) {
      return prior.signature === signature
        ? { status: 'REPLAYED', route: prior.route, result: prior.result }
        : { status: 'EVENT_ID_REUSED' };
    }

    const result = deliver(route);
    receipts.set(key, { signature, route, result });
    return { status: 'DELIVERED', route, result };
  };
}
