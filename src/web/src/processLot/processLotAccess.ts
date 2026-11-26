import type { Identity } from '../workHistoryApi'

const centers = new Set(['001', '002', '004', '101', '102', '104'])

export function canOpenProcessLot(identity: Identity, slot: number | undefined): boolean {
  return !identity.groupWork && centers.has(identity.workCenterCode ?? '')
    && slot !== undefined && Number.isInteger(slot) && slot >= 1 && slot <= 5
    && !!identity.processSlots?.includes(slot) && !!identity.workCodes?.[slot]?.trim()
}
