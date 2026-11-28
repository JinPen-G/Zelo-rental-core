/** 营销活动日程的只读投影。日界/类型由原营业日历提供，不计算价格或修改发布版本。 */
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { RentalDayType, RentalMarketingPlan, RentalMarketingSchedule, RentalMarketingScheduleQuery } from "./contracts";
import { businessDateKeyFromIndex, businessInstantAt, isCalendarDateKey, isValidTimeZone } from "./business-day";

export function marketingScheduleRange(query: RentalMarketingScheduleQuery, timeZone: string) {
  if (!isCalendarDateKey(query.from) || !isCalendarDateKey(query.to) || !isValidTimeZone(timeZone))
    throw new BadRequestException("活动日程日期或营业时区无效");
  const first = Math.floor(Date.parse(`${query.from}T00:00:00Z`) / 86_400_000);
  const last = Math.floor(Date.parse(`${query.to}T00:00:00Z`) / 86_400_000);
  if (last < first || last - first >= 93) throw new BadRequestException("活动日程日期范围须为1至93天");
  return { first, last, startAt: new Date(businessInstantAt(query.from, 0, timeZone)).toISOString(),
    endAt: new Date(businessInstantAt(businessDateKeyFromIndex(last + 1), 0, timeZone)).toISOString() };
}

export function buildMarketingSchedule(scope: { tenantId: string; workspaceId: string }, plans: RentalMarketingPlan[],
  query: RentalMarketingScheduleQuery, timeZone: string, dayTypes: readonly RentalDayType[]): RentalMarketingSchedule {
  const { first, last } = marketingScheduleRange(query, timeZone);
  if (dayTypes.length !== last - first + 1) throw new ConflictException("活动日程缺少完整营业日历观察");
  const rows: RentalMarketingSchedule["rows"] = [];
  for (let index = first; index <= last; index++) {
    const date = businessDateKeyFromIndex(index), dayType = dayTypes[index - first];
    if (query.dayType && query.dayType !== dayType) continue;
    const dayFrom = businessInstantAt(date, 0, timeZone), dayTo = businessInstantAt(businessDateKeyFromIndex(index + 1), 0, timeZone);
    for (const plan of plans) {
      if (plan.tenantId !== scope.tenantId || plan.workspaceId !== scope.workspaceId) throw new ConflictException("活动日程方案不属于当前经营空间");
      if (query.status && query.status !== plan.status) continue;
      // 已有发布正文时只展示原生效版本；未发布方案显示草稿并明确标识，编辑不能抢占已发布日程。
      const version = plan.published ?? plan.draft;
      if (!version) throw new ConflictException("活动日程缺少原方案版本");
      for (const rule of version.rules) {
        const start = Math.max(Date.parse(version.effectiveFrom), rule.conditions.effectiveFrom ? Date.parse(rule.conditions.effectiveFrom) : -Infinity);
        const end = Math.min(version.effectiveTo ? Date.parse(version.effectiveTo) : Infinity,
          rule.conditions.effectiveTo ? Date.parse(rule.conditions.effectiveTo) : Infinity);
        if (end < start || end < dayFrom || start >= dayTo) continue;
        const allowed = (!version.applicableDayTypes.length || version.applicableDayTypes.includes(dayType))
          && (!rule.conditions.applicableDayTypes?.length || rule.conditions.applicableDayTypes.includes(dayType));
        rows.push({ id: JSON.stringify([date, plan.id, version.version, rule.id]), date, dayType,
          planId: plan.id, planName: version.name, planCode: version.code, planStatus: plan.status, planVersion: version.version,
          revision: plan.revision, ruleId: rule.id, ruleName: rule.name, ruleVersion: rule.version, ruleStatus: rule.status,
          versionKind: plan.published ? "published" : "draft", publishedAt: plan.published?.updatedAt, orderTimeWindow: "not_configured",
          rentalStartFrom: new Date(start).toISOString(), rentalStartTo: Number.isFinite(end) ? new Date(end).toISOString() : undefined,
          visibleFrom: new Date(Math.max(start, dayFrom)).toISOString(), visibleTo: new Date(Math.min(end, dayTo)).toISOString(),
          dayCondition: allowed ? "allowed" : "excluded" });
        if (rows.length > 10_000) throw new BadRequestException("活动日程条目过多，请缩小日期范围或筛选状态");
      }
    }
  }
  rows.sort((a, b) => a.visibleFrom.localeCompare(b.visibleFrom) || a.planId.localeCompare(b.planId) || a.ruleId.localeCompare(b.ruleId));
  return { ...scope, timeZone, from: query.from, to: query.to, rows };
}
