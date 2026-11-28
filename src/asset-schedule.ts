/** 序列化资产排班的只读投影。占用来自原预占/分配和库存状态，调度仍由原订单命令执行。 */
import type { RentalAssetStatus } from "./contracts";

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
  status?: string;
  assigneeName?: string;
  /** 历史规则缺失时仅沿原库存的零缓冲兼容口径，不填充当前规则。 */
  bufferBasis?: "historical_rule" | "legacy_missing";
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
