/** 人工管控的冻结规则和变更前置。授权、库存冲突、原幂等账及提交由原事务入口核定。 */
import { BadRequestException, ConflictException } from "@nestjs/common";
import { RENTAL_WORK_ORDER_TYPES } from "./contracts";
import type { CreateRentalAssetControlRequest, ExtendRentalAssetControlRequest, RentalAssetControl,
  RentalAssetControlCommand, RentalAssetControlType } from "./asset-controls";

export const ASSET_CONTROL_UNRELEASED_END = "9999-12-30T00:00:00.000Z";
const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u;
export function assertAssetControlType(value: RentalAssetControlType) {
  if (!value || !id.test(value.code) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 191
    || !Number.isSafeInteger(value.revision) || value.revision < 0
    || [value.enabled, value.blocksRental, value.requiresWorkOrder, value.releaseRequiresAcceptance].some(flag => typeof flag !== "boolean")
    || value.releaseRequiresAcceptance && !value.requiresWorkOrder
    || value.requiresWorkOrder && !RENTAL_WORK_ORDER_TYPES.includes(value.workOrderType!)
    || !value.requiresWorkOrder && value.workOrderType !== undefined)
    throw new BadRequestException("管控类型配置无效；工单或验收要求必须关联原工单类型");
}
export function assertAssetControlCommand(input: RentalAssetControlCommand, revision: number) {
  if (!input || typeof input.operationId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(input.operationId)
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 500)
    throw new BadRequestException("管控操作须提供原操作号、修订与原因");
  if (input.expectedRevision !== revision) throw new ConflictException("管控修订已变化，请重新读取");
}
function instant(value: string, name: string) {
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value) || !Number.isFinite(Date.parse(value)))
    throw new BadRequestException(`${name}须为明确时区的有效时间`);
  return new Date(value).toISOString();
}
export function prepareAssetControl(input: CreateRentalAssetControlRequest, policy: RentalAssetControlType,
  source: Pick<RentalAssetControl, "id" | "tenantId" | "workspaceId" | "assetId" | "itemGroupId" | "locationId" | "createdBy">,
  at: string, emergency = false): RentalAssetControl {
  assertAssetControlCommand(input, 0); assertAssetControlType(policy);
  if (!policy.enabled || policy.code !== input.typeCode || source.assetId !== input.assetId
    || !id.test(input.assetId) || input.assigneeId !== undefined && !id.test(input.assigneeId))
    throw new BadRequestException("管控类型、车辆或处理人无效");
  const startAt = input.startAt ? instant(input.startAt, "开始时间") : at;
  if (Date.parse(startAt) < Date.parse(at)) throw new BadRequestException("未来管控开始时间已过，请选择立即开始或重新指定时间");
  if (emergency && (!policy.blocksRental || startAt !== at)) throw new BadRequestException("紧急停租必须立即生效并阻止出租");
  const plannedEndAt = input.plannedEndAt ? instant(input.plannedEndAt, "计划结束") : undefined;
  if (plannedEndAt && Date.parse(plannedEndAt) <= Date.parse(startAt)) throw new BadRequestException("计划结束须晚于开始时间");
  if (!policy.requiresWorkOrder && input.assigneeId) throw new BadRequestException("无工单管控不能指定工单处理人");
  return { ...source, policy: structuredClone(policy), status: "active", startAt, plannedEndAt,
    assigneeId: input.assigneeId, reason: input.reason.trim(), emergency, conflictsPending: false,
    revision: 1, createdAt: at, updatedAt: at };
}
export function changeAssetControl(current: RentalAssetControl, action: "extend" | "cancel" | "release",
  input: RentalAssetControlCommand | ExtendRentalAssetControlRequest, at: string,
  acceptance?: { id: string; tenantId: string; workspaceId: string; assetId?: string; status: string }): RentalAssetControl {
  assertAssetControlCommand(input, current.revision);
  if (current.status !== "active") throw new ConflictException("该管控已结束，不能再次变更");
  const next = { ...structuredClone(current), revision: current.revision + 1, updatedAt: at };
  if (action === "extend") {
    const end = instant((input as ExtendRentalAssetControlRequest).plannedEndAt, "延期结束");
    if (!current.plannedEndAt || Date.parse(end) <= Math.max(Date.parse(current.plannedEndAt), Date.parse(at)))
      throw new BadRequestException("延期须晚于原计划结束和当前时点；未定结束管控无需延期");
    return { ...next, plannedEndAt: end };
  }
  if (action === "cancel") {
    if (Date.parse(current.startAt) <= Date.parse(at)) throw new ConflictException("已生效管控须走解除及原验收流程");
    return { ...next, status: "cancelled", endedAt: at };
  }
  if (Date.parse(current.startAt) > Date.parse(at)) throw new ConflictException("未来管控请通过取消结束");
  if (current.policy.releaseRequiresAcceptance && (!current.workOrderId || !acceptance
    || acceptance.id !== current.workOrderId || acceptance.tenantId !== current.tenantId || acceptance.workspaceId !== current.workspaceId
    || acceptance.assetId !== current.assetId || acceptance.status !== "completed"))
    throw new ConflictException("解除须由本条原关联工单完成验收");
  return { ...next, status: "released", endedAt: at };
}

/** 实际解除前没有确定结束；计划结束不参与库存算术。取消的未来管控从未生效。 */
export function assetControlPeriod(control: Pick<RentalAssetControl, "policy" | "status" | "startAt" | "endedAt">) {
  if (!control.policy.blocksRental || control.status === "cancelled") return undefined;
  if (control.status === "released" && !control.endedAt) throw new ConflictException("已解除管控缺少原解除时点");
  return { startAt: control.startAt, endAt: control.status === "released" ? control.endedAt! : ASSET_CONTROL_UNRELEASED_END };
}

/** 同车多条限制取区间并集后只占一辆，调用方再与原订单峰值一起计算。 */
export function assetControlOccupancies(controls: readonly RentalAssetControl[]) {
  const groups = new Map<string, Array<{ startAt: string; endAt: string }>>();
  for (const control of controls) {
    const period = assetControlPeriod(control); if (!period) continue;
    const rows = groups.get(control.assetId) ?? []; rows.push(period); groups.set(control.assetId, rows);
  }
  return [...groups].flatMap(([assetId, periods]) => {
    periods.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
    const merged: Array<{ assetId: string; startAt: string; endAt: string; quantity: number }> = [];
    for (const period of periods) {
      const last = merged.at(-1);
      if (last && Date.parse(period.startAt) <= Date.parse(last.endAt)) {
        if (Date.parse(period.endAt) > Date.parse(last.endAt)) last.endAt = period.endAt;
      } else merged.push({ assetId, ...period, quantity: 1 });
    }
    return merged;
  });
}
