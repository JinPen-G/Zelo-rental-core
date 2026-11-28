/** 营销资格的有限条件计算；使用原报价冻结输入与营业时区，不读库、不授权、不计算金额。 */
import { RENTAL_FULFILLMENT_MODES, type RentalMarketingQualification, type RentalMarketingQualificationSnapshot,
  type RentalQuoteDiscountEvaluation, type RentalMarketingTimeRange } from "./contracts";
import { businessTimeOfDay, isValidTimeZone } from "./business-day";

export const MARKETING_QUALIFICATION_KEYS = ["activityWindow", "bookingWindow", "rentalWindow", "bookingTime", "rentalStartTime",
  "advanceBookingHours", "fulfillmentLocationIds", "returnLocationIds", "fulfillmentModes", "audiences"] as const;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());
const instant = (value: unknown): value is string => text(value) && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.every(text) && new Set(value).size === value.length;
const hour = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER / 3_600_000;

export function marketingQualificationError(value: unknown): string | undefined {
  if (value === undefined) return;
  if (!object(value) || Object.keys(value).some(key => !(MARKETING_QUALIFICATION_KEYS as readonly string[]).includes(key))) return "营销资格条件结构无效";
  for (const key of ["activityWindow", "bookingWindow", "rentalWindow"] as const) {
    const range = value[key];
    if (range !== undefined && (!object(range) || Object.keys(range).some(key => !["from", "to"].includes(key))
      || range.from === undefined && range.to === undefined || range.from !== undefined && !instant(range.from)
      || range.to !== undefined && !instant(range.to) || instant(range.from) && instant(range.to) && Date.parse(range.to) <= Date.parse(range.from)))
      return "营销时间范围须有有效边界及明确时区，结束晚于开始";
  }
  for (const key of ["bookingTime", "rentalStartTime"] as const) {
    const range = value[key], clock = (v: unknown) => typeof v === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
    if (range !== undefined && (!object(range) || Object.keys(range).some(key => !["start", "end"].includes(key))
      || !clock(range.start) || !clock(range.end) || range.start === range.end)) return "营销日内时段须为不同的HH:mm起止时点，跨午夜须明确结束时点";
  }
  const advance = value.advanceBookingHours;
  if (advance !== undefined && (!object(advance) || Object.keys(advance).some(key => !["minimum", "maximum"].includes(key))
    || advance.minimum === undefined && advance.maximum === undefined || advance.minimum !== undefined && !hour(advance.minimum)
    || advance.maximum !== undefined && !hour(advance.maximum)
    || hour(advance.minimum) && hour(advance.maximum) && advance.minimum > advance.maximum)) return "提前预订小时范围无效";
  for (const key of ["fulfillmentLocationIds", "returnLocationIds", "fulfillmentModes", "audiences"] as const) {
    const values = value[key];
    if (values !== undefined && (!ids(values) || values.length > 200)) return "营销地点、履约或来源范围无效";
  }
  if ((value.fulfillmentModes as string[] | undefined)?.some(mode => !(RENTAL_FULFILLMENT_MODES as readonly string[]).includes(mode))
    || (value.audiences as string[] | undefined)?.some(audience => !["operator", "staff", "client"].includes(audience))) return "营销履约方式或受信来源不支持";
}

export function marketingQualificationSnapshotError(value: RentalMarketingQualificationSnapshot | undefined): string | undefined {
  if (!value || value.version !== "rental-marketing-qualification-1" || !instant(value.evaluatedAt)
    || !instant(value.rentalStartAt) || !instant(value.rentalEndAt) || Date.parse(value.rentalEndAt) <= Date.parse(value.rentalStartAt)
    || !text(value.timeZone) || !isValidTimeZone(value.timeZone) || !text(value.fulfillmentLocationId) || !text(value.returnLocationId)
    || !RENTAL_FULFILLMENT_MODES.includes(value.fulfillmentMode)
    || value.audience !== undefined && !["operator", "staff", "client"].includes(value.audience)) return "营销条件所需原报价时间、地点或身份依据不可用";
}

export function evaluateMarketingQualification(condition: RentalMarketingQualification | undefined,
  snapshot: RentalMarketingQualificationSnapshot | undefined): { eligibility: RentalQuoteDiscountEvaluation["eligibility"]; unavailable?: string } {
  const error = marketingQualificationError(condition);
  if (error) return { eligibility: [], unavailable: error };
  if (!condition || !Object.values(condition).some(value => Array.isArray(value) ? value.length : value !== undefined)) return { eligibility: [] };
  const basisError = marketingQualificationSnapshotError(snapshot);
  if (basisError) return { eligibility: [], unavailable: basisError };
  const basis = snapshot!, eligibility: RentalQuoteDiscountEvaluation["eligibility"] = [];
  const record = (rule: string, passed: boolean, detail: string) => { eligibility.push({ rule, passed, detail }); };
  const range = (key: string, window: RentalMarketingTimeRange | undefined, start: string, end = start) => {
    if (window) record(key, (window.from === undefined || Date.parse(start) >= Date.parse(window.from))
      && (window.to === undefined || Date.parse(end) <= Date.parse(window.to)), `${start}～${end}；${window.from ?? "无下限"}～${window.to ?? "无上限"}`);
  };
  range("activity_window", condition.activityWindow, basis.evaluatedAt);
  range("booking_window", condition.bookingWindow, basis.evaluatedAt);
  range("rental_window", condition.rentalWindow, basis.rentalStartAt, basis.rentalEndAt);
  for (const [key, window, at] of [["booking_time", condition.bookingTime, basis.evaluatedAt],
    ["rental_start_time", condition.rentalStartTime, basis.rentalStartAt]] as const) {
    if (!window) continue;
    const local = businessTimeOfDay(at, basis.timeZone);
    record(key, window.start < window.end ? local >= window.start && local < window.end : local >= window.start || local < window.end,
      `${basis.timeZone} ${local}；${window.start}～${window.end}${window.start > window.end ? "（跨午夜）" : ""}`);
  }
  const advance = condition.advanceBookingHours;
  if (advance) {
    const hours = (Date.parse(basis.rentalStartAt) - Date.parse(basis.evaluatedAt)) / 3_600_000;
    record("advance_booking", (advance.minimum === undefined || hours >= advance.minimum) && (advance.maximum === undefined || hours <= advance.maximum),
      `${hours}小时；${advance.minimum ?? "无下限"}～${advance.maximum ?? "无上限"}`);
  }
  for (const [key, values, actual] of [["fulfillment_location", condition.fulfillmentLocationIds, basis.fulfillmentLocationId],
    ["return_location", condition.returnLocationIds, basis.returnLocationId], ["fulfillment_mode", condition.fulfillmentModes, basis.fulfillmentMode],
    ["audience", condition.audiences, basis.audience]] as const) {
    if (!values?.length) continue;
    if (!actual) return { eligibility, unavailable: "营销规则所需原认证来源不可用" };
    record(key, (values as readonly string[]).includes(actual), `${actual}；${values.join("、")}`);
  }
  return { eligibility };
}
