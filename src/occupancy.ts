import type { RentalRuleConfig } from "./contracts";

/** 库存占用包含交付前准备与归还后周转；缓冲不计租金。历史快照缺省为 0。 */
export function bufferedRentalPeriod(startAt: string, endAt: string, rule?: RentalRuleConfig) {
  const before = Math.max(0, rule?.fulfillment?.pickupBufferMinutes ?? 0);
  const after = Math.max(0, rule?.fulfillment?.returnBufferMinutes ?? 0);
  return {
    startAt: new Date(new Date(startAt).getTime() - before * 60_000).toISOString(),
    endAt: new Date(new Date(endAt).getTime() + after * 60_000).toISOString()
  };
}

/** 已履约且逾期未释放的原预占没有确定结束；排班与可用量共用此口径。 */
export function reservedRentalPeriod(startAt: string, endAt: string, status: string, rule: RentalRuleConfig | undefined, now: Date) {
  return bufferedRentalPeriod(startAt, status === "FULFILLED" && new Date(endAt) <= now
    ? "9999-12-30T00:00:00.000Z" : endAt, rule);
}

type Occupancy = { startAt: string; endAt: string; quantity: number };
function occupancyEvents(rows: Occupancy[], startAt: string, endAt: string) {
  const from = new Date(startAt).getTime();
  const to = new Date(endAt).getTime();
  const events: Array<{ at: number; delta: number }> = [];
  for (const row of rows) {
    const start = Math.max(from, new Date(row.startAt).getTime());
    const end = Math.min(to, new Date(row.endAt).getTime());
    if (start < end && row.quantity > 0) {
      events.push({ at: start, delta: row.quantity }, { at: end, delta: -row.quantity });
    }
  }
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  return events;
}

/** 半开区间内的最大同时占用量；前后串行的订单不能被简单求和成并发占用。 */
export function peakReservedQuantity(rows: Occupancy[], startAt: string, endAt: string) {
  const events = occupancyEvents(rows, startAt, endAt);
  let peak = 0;
  let current = 0;
  for (const event of events) { current += event.delta; peak = Math.max(peak, current); }
  return peak;
}

/** 将原库存事件投影为查询视窗内的占用分段。只解释已登记事实，不授予调度或库存释放。 */
export function reservedQuantityPeriods(rows: Occupancy[], startAt: string, endAt: string): Occupancy[] {
  const events = occupancyEvents(rows, startAt, endAt), periods: Occupancy[] = [];
  let quantity = 0, previous: number | undefined;
  for (let index = 0; index < events.length;) {
    const at = events[index]!.at;
    if (previous !== undefined && previous < at && quantity > 0) {
      const start = new Date(previous).toISOString(), end = new Date(at).toISOString(), last = periods.at(-1);
      if (last?.endAt === start && last.quantity === quantity) last.endAt = end;
      else periods.push({ startAt: start, endAt: end, quantity });
    }
    // 同一边界上的离开/进入全部处理后才形成下一段，邻接预占不产生瞬时冲突。
    while (index < events.length && events[index]!.at === at) quantity += events[index++]!.delta;
    previous = at;
  }
  return periods;
}
