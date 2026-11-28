import { BadRequestException } from "@nestjs/common";
import { RentalAssetStatus } from "./contracts";
import type { RentalAssetScheduleQuery } from "./asset-schedule";

/** 查询只接受带偏移的时间；经营空间时区由持久配置提供，客户端不能指定身份/范围。 */
export function parseRentalAssetScheduleQuery(value: unknown): RentalAssetScheduleQuery {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("排班查询参数无效");
  const query = structuredClone(value) as Record<string, unknown>;
  if (Object.keys(query).some(key => !["startAt", "endAt", "locationId", "itemGroupId", "assetId", "keyword", "status", "page"].includes(key)))
    throw new BadRequestException("排班查询包含未知字段");
  const timestamp = (value: unknown): value is string => typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value));
  if (!timestamp(query.startAt) || !timestamp(query.endAt) || Date.parse(query.startAt) >= Date.parse(query.endAt)
    || Date.parse(query.endAt) - Date.parse(query.startAt) > 93 * 86400000)
    throw new BadRequestException("排班时间须带时区偏移，结束晚于开始，且不超过93天");
  for (const key of ["locationId", "itemGroupId", "assetId"] as const) {
    if (query[key] !== undefined && (typeof query[key] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(query[key])))
      throw new BadRequestException("排班筛选标识无效");
  }
  if (query.status !== undefined && !Object.values(RentalAssetStatus).includes(query.status as RentalAssetStatus))
    throw new BadRequestException("资产状态筛选无效");
  if (query.keyword !== undefined && (typeof query.keyword !== "string" || query.keyword.length > 100)) throw new BadRequestException("车辆编号查询过长或无效");
  if (query.page !== undefined && !/^[1-9]\d{0,5}$/u.test(String(query.page))) throw new BadRequestException("排班页码无效");
  return { ...query, startAt: new Date(query.startAt).toISOString(), endAt: new Date(query.endAt).toISOString(), page: Number(query.page ?? 1) } as RentalAssetScheduleQuery;
}
