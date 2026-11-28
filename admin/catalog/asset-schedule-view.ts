/** 纯时间轴映射：营业日界沿 Core 的 IANA 时区算法，条带只裁剪显示，不改原事实。 */
import { businessDateKeyFromIndex, businessInstantAt } from "@rental-os/rental-core/business-day";
import type { RentalAssetScheduleEntry } from "@rental-os/rental-core";

export type ScheduleZoom = "day" | "week" | "month";
const dayIndex = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
export function scheduleWindow(date: string, zoom: ScheduleZoom, timeZone: string) {
  const startDate = zoom === "month" ? `${date.slice(0, 7)}-01` : date;
  const startIndex = dayIndex(startDate);
  const days = zoom === "day" ? 1 : zoom === "week" ? 7 : new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
  const startAt = new Date(businessInstantAt(startDate, 0, timeZone)).toISOString();
  const endAt = new Date(businessInstantAt(businessDateKeyFromIndex(startIndex + days), 0, timeZone)).toISOString();
  const ticks = zoom === "day"
    ? Array.from({ length: 6 }, (_, i) => new Date(businessInstantAt(startDate, i * 4, timeZone)).toISOString())
    : Array.from({ length: days }, (_, i) => new Date(businessInstantAt(businessDateKeyFromIndex(startIndex + i), 0, timeZone)).toISOString());
  return { startAt, endAt, ticks };
}
export function shiftScheduleDate(date: string, zoom: ScheduleZoom, direction: number) {
  if (zoom === "month") return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1 + direction, 1)).toISOString().slice(0, 10);
  return businessDateKeyFromIndex(dayIndex(date) + direction * (zoom === "week" ? 7 : 1));
}
export function scheduleLanes(entries: RentalAssetScheduleEntry[], startAt: string, endAt: string) {
  const from = Date.parse(startAt), to = Date.parse(endAt), ends: number[] = [];
  return [...entries].sort((a, b) => (a.startAt ? Date.parse(a.startAt) : from) - (b.startAt ? Date.parse(b.startAt) : from))
    .map(entry => {
      const start = Math.max(from, entry.startAt ? Date.parse(entry.startAt) : from), end = Math.min(to, entry.endAt ? Date.parse(entry.endAt) : to);
      let lane = ends.findIndex(value => value <= start);
      if (lane < 0) lane = ends.length;
      ends[lane] = end;
      return { entry, lane, left: (start - from) / (to - from) * 100, width: Math.max(0, end - start) / (to - from) * 100 };
    }).filter(row => row.width > 0);
}
