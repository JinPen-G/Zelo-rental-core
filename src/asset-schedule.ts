/** 序列化资产排班的只读投影。占用来自原预占/分配和库存状态，调度仍由原订单命令执行。 */
import type { RentalAssetStatus, RentalCoreOrderStatus, RentalFulfillmentMode, RentalWorkOrderType } from "./contracts";

export interface RentalAssetScheduleQuery {
  startAt: string;
  endAt: string;
  locationId?: string;
  itemGroupId?: string;
  assetId?: string;
  keyword?: string;
  status?: RentalAssetStatus;
  page?: number;
}

export type RentalAssetScheduleKind = "reservation" | "rental" | "preparation" | "turnaround" | "work_order" | "asset_hold";
export interface RentalAssetScheduleEntry {
  /** 仅在本次投影中稳定；受限来源不得通过此键暴露原对象编号。 */
  id: string;
  kind: RentalAssetScheduleKind;
  startAt: string | null;
  endAt: string | null;
  plannedEndAt?: string;
  overdue: boolean;
  source: "order" | "work_order" | "asset_status" | "restricted";
  sourceId?: string;
  sourceNo?: string;
  /** 仅在原订单可读时提供同一快照的状态与履约方式，供原页面定位；不代表动作已获准执行。 */
  order?: { status: RentalCoreOrderStatus; fulfillmentMode: RentalFulfillmentMode };
  status?: string;
  assigneeName?: string;
  workOrderType?: RentalWorkOrderType;
  /** 历史规则缺失时仅沿原库存的零缓冲兼容口径，不填充当前规则。 */
  bufferBasis?: "historical_rule" | "legacy_missing";
}
export interface RentalAssetScheduleOverlap {
  /** 已包含原历史缓冲，仅截取当前查询视窗；不是订单的新时间或管控区间。 */
  startAt: string;
  endAt: string;
  reservationCount: number;
}
export interface RentalAssetScheduleRow {
  id: string;
  assetNo: string;
  itemGroupId: string;
  itemGroupName: string;
  locationId: string;
  locationName: string;
  status: RentalAssetStatus;
  entries: RentalAssetScheduleEntry[];
  /** 同一资产同时被至少两条有效预占分配的时段；不重复计算租期/准备/周转条带。 */
  overlaps: RentalAssetScheduleOverlap[];
}
export interface RentalAssetSchedule {
  source: "persisted_inventory_facts";
  observedAt: string;
  timeZone: string;
  startAt: string;
  endAt: string;
  page: number;
  pageSize: number;
  total: number;
  rows: RentalAssetScheduleRow[];
  locations: Array<{ id: string; name: string }>;
  itemGroups: Array<{ id: string; name: string }>;
  /** 容量按地点/型号完整事实计算，不随车辆状态筛选或分页缩小分母。 */
  capacity: Array<{ itemGroupId: string; itemGroupName: string; locationId: string; locationName: string;
    operableQuantity: number; reservedPeak: number; unassignedPeak: number; availableQuantity: number; shortage: number; enabled: boolean }>;
  unassigned: Array<RentalAssetScheduleEntry & { itemGroupId: string; locationId: string; quantity: number }>;
}
