/** 人工管控在原资产锁和调用方幂等事务中提交，复用原工单处理/验收。
 * 只保存本条限制及追加履历；不取消订单、调车、退款或按预计结束释放库存。 */
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { sqltag as sql } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import type { RequestIdentity } from "@rental-os/platform-server/request-identity";
import type { RentalCoreFactContacts, RentalCoreFactTransaction, RentalCoreFactStorage } from "./core-fact-storage";
import type { RentalWorkOrder } from "./contracts";
import { RentalInventoryMode } from "./contracts";
import type { ActiveReservationRow, InventoryLockTarget } from "./mysql-core-facts";
import { lockRentalBusinessTenant } from "./mysql-business-fence";
import { peakReservedQuantity } from "./occupancy";
import { ASSET_CONTROL_READ_CODES, RENTAL_ASSET_CONTROL_DEFAULT_TYPES, type RentalAssetControl, type RentalAssetControlEvent, type RentalAssetControlType,
  type RentalAssetControlCommand, type CreateRentalAssetControlRequest, type EmergencyRentalAssetControlRequest,
  type ExtendRentalAssetControlRequest, type SaveRentalAssetControlTypeRequest } from "./asset-controls";
import { assertAssetControlCommand, assertAssetControlType, prepareAssetControl, changeAssetControl,
  assetControlOccupancies, ASSET_CONTROL_UNRELEASED_END } from "./asset-control-policy";
import { decodeAssetControl, readAssetControls, type AssetControlRow } from "./mysql-asset-control-read";

export type AssetControlAuthority = "read" | "manage" | "configure" | "emergency";
export function assertAssetControlAuthority(identity: Partial<RequestIdentity> | undefined, tenantId: string, workspaceId: string,
  action: AssetControlAuthority): string {
  const codes = action === "read" ? ASSET_CONTROL_READ_CODES : [`rental-core:asset:control:${action}`];
  if (!identity?.userId || identity.tenantId !== tenantId || identity.workspaceId !== workspaceId || !workspaceId
    || identity.isSaasAdmin || identity.audience === "client" || !Array.isArray(identity.permissions)
    // 紧急停租须受信角色显式包含独立权限；管理员标志及普通管控权限均不能代替。
    || !(codes.some(code => identity.permissions!.includes(code)) || action !== "emergency" && identity.permissions.includes("*")))
    throw new ForbiddenException("当前身份缺少本经营空间的管控操作权限");
  return identity.userId;
}

interface Dependencies<Tx extends RentalCoreFactTransaction> {
  assetWhere(tx: Tx, tenantId: string, workspaceId: string, assetId?: string): Promise<Prisma.RentalAssetWhereInput>;
  orderWhere(): Prisma.RentalOrderWhereInput;
  lockInventory(tenantId: string, locationId: string, targets: InventoryLockTarget[], tx: Tx): Promise<void>;
  reservations(tenantId: string, tx: Tx): Promise<ActiveReservationRow[]>;
  assignees(tenantId: string, locationId: string, tx: Tx): Promise<Array<{ id: string; displayName: string }>>;
  createWork(work: RentalWorkOrder, tx: Tx, controlId: string): Promise<RentalWorkOrder>;
}
export class RentalAssetControlRepository<Tx extends RentalCoreFactTransaction> {
  constructor(private readonly store: RentalCoreFactStorage<Tx>, private readonly contacts: RentalCoreFactContacts<Tx>,
    private readonly dependencies: Dependencies<Tx>) {}
  private identity() { return this.contacts.getRequestIdentity() as Partial<RequestIdentity> | undefined; }
  private async scope(tenantId: string, action: AssetControlAuthority, tx: Tx = this.store) {
    const identity = structuredClone(this.identity()), workspaceId = this.contacts.getRequestWorkspaceId();
    const locations = structuredClone(this.contacts.getRequestLocationIds());
    const actor = assertAssetControlAuthority(identity, tenantId, workspaceId ?? "", action);
    const current = async () => {
      assertAssetControlAuthority(this.identity(), tenantId, workspaceId!, action);
      if (!isDeepStrictEqual(identity, this.identity()) || !isDeepStrictEqual(locations, this.contacts.getRequestLocationIds())
        || await this.contacts.resolveWorkspaceId(tx, tenantId) !== workspaceId)
        throw new ForbiddenException("人工管控读取或写入期间当前身份或空间已变化");
    };
    await current(); return { tenantId, workspaceId: workspaceId!, actor, current };
  }
  private async lockWorkspace(tx: Tx, tenantId: string, workspaceId: string) {
    await lockRentalBusinessTenant(tx, tenantId);
    const rows = await tx.$queryRaw<Array<{ id: string }>>(sql`SELECT id FROM business_workspaces
      WHERE tenantId = ${tenantId} AND id = ${workspaceId} FOR UPDATE`);
    if (rows.length !== 1) throw new ConflictException("管控经营空间已变化");
  }
  async types(tenantId: string, tx: Tx = this.store): Promise<RentalAssetControlType[]> {
    const scope = await this.scope(tenantId, "read", tx);
    const rows = await tx.$queryRaw<Array<{ code: string; revision: number; body: unknown }>>(sql`SELECT code, revision, body
      FROM rental_asset_control_types WHERE tenantId = ${tenantId} AND workspaceId = ${scope.workspaceId} ORDER BY code LIMIT 201`);
    if (rows.length > 200) throw new ServiceUnavailableException("管控类型超过读取上限");
    const result = new Map(RENTAL_ASSET_CONTROL_DEFAULT_TYPES.map(value => [value.code, structuredClone(value)]));
    for (const row of rows) {
      const value = (typeof row.body === "string" ? JSON.parse(row.body) : row.body) as RentalAssetControlType;
      assertAssetControlType(value);
      if (row.code !== value.code || row.revision !== value.revision) throw new ConflictException("管控类型原修订不一致");
      result.set(row.code, structuredClone(value));
    }
    await scope.current(); return [...result.values()];
  }
  async saveType(tenantId: string, value: SaveRentalAssetControlTypeRequest, tx: Tx) {
    const input = structuredClone(value), scope = await this.scope(tenantId, "configure", tx);
    if (this.identity()?.dataScope === "own") throw new ForbiddenException("本人资料范围不能修改空间共用管控类型");
    await this.lockWorkspace(tx, tenantId, scope.workspaceId);
    const types = await this.types(tenantId, tx), before = types.find(type => type.code === input.type?.code);
    if (!before && types.length >= 200) throw new ConflictException("管控类型已达到上限");
    assertAssetControlCommand(input, before?.revision ?? 0);
    const after = { ...input.type, name: input.type.name?.trim(), revision: (before?.revision ?? 0) + 1 };
    assertAssetControlType(after);
    await scope.current(); const at = new Date();
    await tx.$executeRaw(sql`INSERT INTO rental_asset_control_types (tenantId,workspaceId,code,revision,body,updatedAt)
      VALUES (${tenantId},${scope.workspaceId},${after.code},${after.revision},${JSON.stringify(after)},${at})
      ON DUPLICATE KEY UPDATE revision=VALUES(revision),body=VALUES(body),updatedAt=VALUES(updatedAt)`);
    await tx.$executeRaw(sql`INSERT INTO rental_asset_control_events (id,tenantId,workspaceId,objectId,revision,body,createdAt)
      VALUES (${randomUUID()},${tenantId},${scope.workspaceId},${`type:${after.code}`},${after.revision},
        ${JSON.stringify({ before, after, action: "save_type", operationId: input.operationId, actorUserId: scope.actor,
          reason: input.reason.trim(), createdAt: at.toISOString() })},${at})`);
    await scope.current(); return after;
  }
  async list(tenantId: string, assetId?: string, tx: Tx = this.store) {
    const scope = await this.scope(tenantId, "read", tx);
    const assets = await tx.rentalAsset.findMany({ where: { tenantId, workspaceId: scope.workspaceId,
      AND: [await this.dependencies.assetWhere(tx, tenantId, scope.workspaceId, assetId), ...(assetId ? [{ id: assetId }] : [])] },
      select: { id: true }, take: 10001 });
    if (assets.length > 10000) throw new ServiceUnavailableException("管控资产超过读取上限，请指定资产");
    if (assetId && !assets.length) throw new NotFoundException("资产不存在或不在当前读取范围");
    const result = await readAssetControls(tx, tenantId, scope.workspaceId, assets.map(asset => asset.id));
    await scope.current(); return result;
  }
  async history(tenantId: string, controlId: string) {
    const scope = await this.scope(tenantId, "read");
    if (!(await this.list(tenantId)).some(row => row.id === controlId)) throw new NotFoundException("人工管控不可读取");
    const rows = await this.store.$queryRaw<Array<{ body: unknown }>>(sql`SELECT body FROM rental_asset_control_events
      WHERE tenantId=${tenantId} AND workspaceId=${scope.workspaceId} AND objectId=${controlId} ORDER BY revision DESC LIMIT 200`);
    await scope.current();
    return rows.map(row => (typeof row.body === "string" ? JSON.parse(row.body) : row.body) as RentalAssetControlEvent);
  }
  async conflicts(tenantId: string, controlId: string) {
    const scope = await this.scope(tenantId, "read");
    if (!(await this.list(tenantId)).some(row => row.id === controlId)) throw new NotFoundException("人工管控不可读取");
    const permissions = this.identity()?.permissions ?? [];
    if (!permissions.includes("rental-os:order:view") && !permissions.includes("*")) {
      await scope.current(); return { available: false as const, orders: [] };
    }
    const rows = await this.store.$queryRaw<Array<{ conflicts: unknown }>>(sql`SELECT conflicts FROM rental_asset_controls
      WHERE tenantId=${tenantId} AND workspaceId=${scope.workspaceId} AND id=${controlId}`);
    const ids: string[] = rows.length ? (typeof rows[0].conflicts === "string" ? JSON.parse(rows[0].conflicts) : rows[0].conflicts) as string[] : [];
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "string")) throw new ConflictException("管控原冲突依据不可读取");
    const orders = ids.length ? await this.store.rentalOrder.findMany({ where: { AND: [{ tenantId, workspaceId: scope.workspaceId,
      id: { in: ids } }, this.dependencies.orderWhere()] }, select: { id: true, orderNo: true, status: true } }) : [];
    await scope.current(); return { available: true as const, orders };
  }
  async create(tenantId: string, value: CreateRentalAssetControlRequest | EmergencyRentalAssetControlRequest, emergency: boolean, tx: Tx) {
    const input = structuredClone(value), scope = await this.scope(tenantId, emergency ? "emergency" : "manage", tx);
    if (emergency && (!("confirmed" in input) || input.confirmed !== true)) throw new BadRequestException("紧急停租须明确确认");
    await this.lockWorkspace(tx, tenantId, scope.workspaceId);
    const asset = await tx.rentalAsset.findFirst({ where: { tenantId, workspaceId: scope.workspaceId, id: input.assetId,
      AND: [await this.dependencies.assetWhere(tx, tenantId, scope.workspaceId, input.assetId)] } });
    if (!asset) throw new NotFoundException("车辆不存在或不在当前管控范围");
    await this.dependencies.lockInventory(tenantId, asset.locationId, [{ itemGroupId: asset.itemGroupId, inventoryMode: RentalInventoryMode.Serialized }], tx);
    const currentAsset = await tx.rentalAsset.findFirst({ where: { id: asset.id, tenantId, workspaceId: scope.workspaceId } });
    if (!currentAsset || currentAsset.itemGroupId !== asset.itemGroupId || currentAsset.locationId !== asset.locationId)
      throw new ConflictException("管控车辆的型号或地点已变化");
    const policy = (await this.types(tenantId, tx)).find(type => type.code === input.typeCode);
    if (!policy) throw new NotFoundException("管控类型不存在");
    const at = new Date().toISOString(), control = prepareAssetControl(input, policy, { id: `control_${randomUUID()}`,
      tenantId, workspaceId: scope.workspaceId, assetId: asset.id, itemGroupId: asset.itemGroupId, locationId: asset.locationId, createdBy: scope.actor }, at, emergency);
    if (!emergency && !["AVAILABLE", "RESERVED", "RENTED", "MAINTENANCE", "INSPECTION"].includes(currentAsset.status))
      throw new ConflictException("当前车辆状态不能新建普通管控");
    const conflicts = await this.admission(tx, control, emergency, scope.current);
    control.conflictsPending = conflicts.length > 0;
    if (policy.requiresWorkOrder) {
      const assignee = input.assigneeId ? (await this.dependencies.assignees(tenantId, asset.locationId, tx)).find(row => row.id === input.assigneeId) : undefined;
      if (input.assigneeId && !assignee) throw new ConflictException("工单处理人已不在当前受权范围");
      control.workOrderId = `work_${randomUUID()}`;
      // 先在同事务登记关联，原工单仓储才可验证本条受控来源；失败一并回滚。
      await this.insert(tx, control, conflicts);
      await this.dependencies.createWork({ id: control.workOrderId, tenantId, workspaceId: scope.workspaceId,
        workNo: `WO${at.replace(/\D/g, "").slice(0, 14)}${randomUUID().slice(0, 4).toUpperCase()}`,
        type: policy.workOrderType!, status: "pending", assetId: asset.id, itemGroupId: asset.itemGroupId,
        locationId: asset.locationId, quantity: 1, assigneeId: assignee?.id, assigneeName: assignee?.displayName,
        reason: control.reason, attachments: [], createdBy: scope.actor, createdAt: at, updatedAt: at }, tx, control.id);
    } else await this.insert(tx, control, conflicts);
    await this.event(tx, control, undefined, emergency ? "emergency" : "create", input, scope.actor);
    await scope.current(); return control;
  }
  private async admission(tx: Tx, control: RentalAssetControl, emergency: boolean, current?: () => Promise<void>) {
    if (!control.policy.blocksRental) return [];
    const [assets, reservations, existing, allocations] = await Promise.all([
      tx.rentalAsset.findMany({ where: { tenantId: control.tenantId, workspaceId: control.workspaceId,
        itemGroupId: control.itemGroupId, locationId: control.locationId, status: { notIn: ["MAINTENANCE", "DISABLED"] } }, select: { id: true } }),
      this.dependencies.reservations(control.tenantId, tx),
      readAssetControls(tx, control.tenantId, control.workspaceId, undefined, true),
      tx.rentalAllocation.findMany({ where: { assetId: control.assetId, status: { in: ["pre_assigned", "locked", "allocated", "picked_up"] },
        order: { tenantId: control.tenantId, workspaceId: control.workspaceId } }, select: { orderId: true } })
    ]);
    const original = reservations.filter(row => row.source !== "asset_control" && row.itemGroupId === control.itemGroupId && row.locationId === control.locationId);
    const overlap = original.filter(row => Date.parse(row.endAt) > Date.parse(control.startAt));
    // 分配缺少完整预占不能当成无冲突，保留原订单待处理；有原预占时沿其历史缓冲时段。
    const assigned = allocations.filter(row => !original.some(reservation => reservation.orderId === row.orderId)
      || overlap.some(reservation => reservation.orderId === row.orderId)).map(row => row.orderId);
    const eligible = new Set(assets.map(row => row.id));
    const holds = assetControlOccupancies([...existing.filter(row => row.id !== control.id), control])
      .filter(row => eligible.has(row.assetId));
    const shortage = peakReservedQuantity([...original, ...holds], control.startAt, ASSET_CONTROL_UNRELEASED_END) > assets.length;
    const conflicts = [...new Set([...assigned, ...(shortage ? overlap.flatMap(row => row.orderId ? [row.orderId] : []) : [])])];
    if (!emergency && (assigned.length || shortage)) {
      const permissions = this.identity()?.permissions ?? [], available = permissions.includes("rental-os:order:view") || permissions.includes("*");
      const orders = available && conflicts.length ? await tx.rentalOrder.findMany({ where: { AND: [{ tenantId: control.tenantId,
        workspaceId: control.workspaceId, id: { in: conflicts } }, this.dependencies.orderWhere()] }, select: { id: true, orderNo: true, status: true } }) : [];
      await current?.();
      throw new ConflictException({ message: "管控与原分配或预约峰值容量冲突，请先经原订单流程处理", conflicts: { available, orders } });
    }
    return conflicts;
  }
  async change(tenantId: string, controlId: string, action: "extend" | "cancel" | "release",
    value: RentalAssetControlCommand | ExtendRentalAssetControlRequest, tx: Tx) {
    const input = structuredClone(value), scope = await this.scope(tenantId, "manage", tx);
    await this.lockWorkspace(tx, tenantId, scope.workspaceId);
    const visible = (await this.list(tenantId, undefined, tx)).find(row => row.id === controlId);
    if (!visible) throw new NotFoundException("管控不存在或不在当前范围");
    const asset = await tx.rentalAsset.findFirst({ where: { tenantId, workspaceId: scope.workspaceId, id: visible.assetId } });
    if (!asset) throw new ConflictException("管控原资产缺失");
    await this.dependencies.lockInventory(tenantId, asset.locationId, [{ itemGroupId: asset.itemGroupId, inventoryMode: RentalInventoryMode.Serialized }], tx);
    const rows = await tx.$queryRaw<AssetControlRow[]>(sql`SELECT * FROM rental_asset_controls
      WHERE tenantId=${tenantId} AND workspaceId=${scope.workspaceId} AND id=${controlId} FOR UPDATE`);
    if (rows.length !== 1) throw new ConflictException("原管控已变化");
    const before = decodeAssetControl(rows[0]);
    const work = before.workOrderId ? await tx.rentalWorkOrder.findFirst({ where: { id: before.workOrderId, tenantId,
      workspaceId: scope.workspaceId, assetId: before.assetId } }) : undefined;
    const after = changeAssetControl(before, action, input, new Date().toISOString(), work ? { ...work, assetId: work.assetId ?? undefined } : undefined);
    if (action === "extend") await this.admission(tx, { ...after, itemGroupId: asset.itemGroupId, locationId: asset.locationId }, false, scope.current);
    // 待生效取消可取消尚未开始的原工单；处理已开始时须先沿原工单结束，防止隐藏工作。
    if (action === "cancel" && work && !["pending", "cancelled", "completed"].includes(work.status)) throw new ConflictException("关联工单已开始，请先沿原工单流程处理");
    if (action === "cancel" && work?.status === "pending") {
      const changed = await tx.rentalWorkOrder.updateMany({ where: { id: work.id, tenantId, workspaceId: scope.workspaceId, status: "pending", updatedAt: work.updatedAt },
        data: { status: "cancelled", reviewedAt: new Date(after.updatedAt), reviewedBy: scope.actor, reviewReason: input.reason.trim() } });
      if (changed.count !== 1) throw new ConflictException("原工单已被其他操作推进");
      await tx.operationLog.create({ data: { tenantId, workspaceId: scope.workspaceId, action: "rental.work_order.cancel",
        detail: { workOrderId: work.id, operator: scope.actor, reason: input.reason.trim(), controlId } } });
    }
    await scope.current();
    const changed = await tx.$executeRaw(sql`UPDATE rental_asset_controls SET status=${after.status}, endedAt=${after.endedAt ? new Date(after.endedAt) : null},
      revision=${after.revision},body=${JSON.stringify(after)},updatedAt=${new Date(after.updatedAt)}
      WHERE tenantId=${tenantId} AND workspaceId=${scope.workspaceId} AND id=${controlId} AND revision=${before.revision}`);
    if (changed !== 1) throw new ConflictException("管控修订已被其他操作推进");
    await this.event(tx, after, before, action, input, scope.actor); await scope.current(); return after;
  }
  private async insert(tx: Tx, row: RentalAssetControl, conflicts: string[]) {
    await tx.$executeRaw(sql`INSERT INTO rental_asset_controls (id,tenantId,workspaceId,assetId,status,startAt,endedAt,blocksRental,
      workOrderId,revision,body,conflicts,createdAt,updatedAt) VALUES (${row.id},${row.tenantId},${row.workspaceId},${row.assetId},${row.status},
      ${new Date(row.startAt)},NULL,${row.policy.blocksRental},${row.workOrderId ?? null},${row.revision},${JSON.stringify(row)},
      ${JSON.stringify(conflicts)},${new Date(row.createdAt)},${new Date(row.updatedAt)})`);
  }
  private async event(tx: Tx, after: RentalAssetControl, before: RentalAssetControl | undefined,
    action: RentalAssetControlEvent["action"], input: RentalAssetControlCommand, actorUserId: string) {
    const event: RentalAssetControlEvent = { id: randomUUID(), controlId: after.id, operationId: input.operationId, action,
      revision: after.revision, reason: input.reason.trim(), actorUserId, createdAt: after.updatedAt, before, after };
    await tx.$executeRaw(sql`INSERT INTO rental_asset_control_events (id,tenantId,workspaceId,objectId,revision,body,createdAt)
      VALUES (${event.id},${after.tenantId},${after.workspaceId},${after.id},${after.revision},${JSON.stringify(event)},${new Date(event.createdAt)})`);
  }
}
