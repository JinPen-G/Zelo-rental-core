/** 资产人工管控的领域合同。租赁/工单状态保持原权威，计划结束不代表实际解除。 */
import type { RentalWorkOrderType } from "./contracts";
export const ASSET_CONTROL_READ_CODES = ["rental-core:asset:view", "rental-core:asset:manage", "rental-core:maintenance:view",
  "rental-core:asset:control:manage", "rental-core:asset:control:configure", "rental-core:asset:control:emergency"] as const;

export interface RentalAssetControlType {
  code: string;
  name: string;
  enabled: boolean;
  blocksRental: boolean;
  requiresWorkOrder: boolean;
  releaseRequiresAcceptance: boolean;
  /** 沿原工单四种处理类型；验收使用该原工单，不能另造无承载验收。 */
  workOrderType?: RentalWorkOrderType;
  revision: number;
}

export interface RentalAssetControl {
  id: string;
  tenantId: string;
  workspaceId: string;
  assetId: string;
  itemGroupId: string;
  locationId: string;
  /** 创建时完整冻结；类型配置后续调整不改变这条的阻租与恢复依据。 */
  policy: RentalAssetControlType;
  status: "active" | "cancelled" | "released";
  startAt: string;
  plannedEndAt?: string;
  endedAt?: string;
  workOrderId?: string;
  assigneeId?: string;
  reason: string;
  emergency: boolean;
  /** 只说明存在待原业务处理的冲突；订单资料另经当前原订单读权投影。 */
  conflictsPending: boolean;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RentalAssetControlCommand {
  operationId: string;
  expectedRevision: number;
  reason: string;
}
export interface CreateRentalAssetControlRequest extends RentalAssetControlCommand {
  assetId: string;
  typeCode: string;
  /** 缺省由服务端确定立即开始；指定值只允许未来开始。 */
  startAt?: string;
  plannedEndAt?: string;
  assigneeId?: string;
}
export interface EmergencyRentalAssetControlRequest extends CreateRentalAssetControlRequest {
  confirmed: true;
}
export interface ExtendRentalAssetControlRequest extends RentalAssetControlCommand { plannedEndAt: string; }
export interface SaveRentalAssetControlTypeRequest extends RentalAssetControlCommand {
  type: Omit<RentalAssetControlType, "revision">;
}
export interface RentalAssetControlEvent {
  id: string;
  controlId: string;
  operationId: string;
  action: "create" | "emergency" | "extend" | "cancel" | "release";
  revision: number;
  reason: string;
  actorUserId: string;
  createdAt: string;
  before?: RentalAssetControl;
  after: RentalAssetControl;
}
export type RentalAssetControlReceipt = { status: "unknown" } | {
  status: "rejected";
  operationId: string;
  action: RentalAssetControlEvent["action"] | "save_type";
  targetId: string;
  expectedRevision: number;
  message: string;
} | {
  status: "committed";
  operationId: string;
  action: RentalAssetControlEvent["action"] | "save_type";
  objectId: string;
  revision: number;
};
export interface RentalAssetControlOptions {
  timeZone: string;
  assets: Array<{ id: string; assetNo: string; itemGroupName: string; locationId: string; locationName: string; status: string }>;
}

/** 仅供尚未配置时的明确缺省投影，不在普通读口写入配置。 */
const workOrderDefaults: Array<Pick<RentalAssetControlType, "code" | "name" | "workOrderType">> = [
  { code: "repair", name: "临时维修", workOrderType: "repair" },
  { code: "maintenance", name: "计划保养", workOrderType: "repair" },
  { code: "cleaning", name: "清洁整备", workOrderType: "cleaning" },
  { code: "inspection", name: "检验", workOrderType: "calibration" },
  { code: "accident", name: "事故处理", workOrderType: "repair" },
  { code: "suspension", name: "暂停出租", workOrderType: "calibration" },
];
export const RENTAL_ASSET_CONTROL_DEFAULT_TYPES: readonly RentalAssetControlType[] = [
  ...workOrderDefaults.map(value => ({ ...value, enabled: true,
    blocksRental: true, requiresWorkOrder: true, releaseRequiresAcceptance: true, revision: 0 })),
  { code: "internal", name: "内部占用", enabled: true, blocksRental: true, requiresWorkOrder: false,
    releaseRequiresAcceptance: false, revision: 0 }
].map(value => Object.freeze(value));
