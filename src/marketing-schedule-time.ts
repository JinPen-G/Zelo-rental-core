/** 日程只投影挂钟时间区间，复用营业日界。包含DST跳时/回拨，不推算营销资格。 */
import { businessLocalDateTime, businessInstantsFromLocal } from "./business-day";
import type { RentalTimeWindow } from "./contracts";

export function marketingDayIntervals(date: string, dayFrom: number, dayTo: number, timeZone: string, windows: RentalTimeWindow[]) {
  if (!windows.length) return [[dayFrom, dayTo]];
  const points = new Set([dayFrom, dayTo]);
  for (const window of windows) for (const clock of [window.start, window.end]) {
    for (const at of businessInstantsFromLocal(`${date}T${clock}:00`, timeZone)) {
      const stamp = Date.parse(at); if (stamp > dayFrom && stamp < dayTo) points.add(stamp);
    }
  }
  const offset = (at: number) => Date.parse(`${businessLocalDateTime(new Date(at).toISOString(), timeZone)}Z`) - at;
  // 不存在的挂钟边界可能落在跳时缺口里，必须同时切入真实时区跳变点。
  for (let from = dayFrom; from < dayTo; from += 3_600_000) {
    let low = from, high = Math.min(dayTo, from + 3_600_000);
    const before = offset(low); if (before === offset(high)) continue;
    while (high - low > 1_000) { const mid = Math.floor((low + high) / 2_000) * 1_000; if (offset(mid) === before) low = mid; else high = mid; }
    points.add(high);
  }
  const ordered = [...points].sort((a, b) => a - b), result: number[][] = [];
  for (let index = 1; index < ordered.length; index++) {
    const from = ordered[index - 1], to = ordered[index];
    const local = businessLocalDateTime(new Date(Math.floor((from + to) / 2 / 1_000) * 1_000).toISOString(), timeZone).slice(11, 16);
    if (!windows.every(window => window.start < window.end ? local >= window.start && local < window.end : local >= window.start || local < window.end)) continue;
    const previous = result.at(-1); if (previous?.[1] === from) previous[1] = to; else result.push([from, to]);
  }
  return result;
}
