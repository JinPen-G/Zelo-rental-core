/** 人工管控原事实读取。库存只消费区间与资产标识，计划结束不会截断未解除的占用。 */
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { sqltag as sql, join, empty } from "@prisma/client/runtime/library";
import type { RentalCoreFactTransaction } from "./core-fact-storage";
import type { RentalAssetControl } from "./asset-controls";
import type { RentalWorkOrder } from "./contracts";
import { assertAssetControlType, assetControlOccupancies } from "./asset-control-policy";

export interface AssetControlRow {
  id: string; tenantId: string; workspaceId: string; assetId: string; status: string;
  startAt: Date; endedAt: Date | null; blocksRental: boolean | number; workOrderId: string | null;
  revision: number; body: unknown; conflicts: unknown;
}
export function decodeAssetControl(row: AssetControlRow): RentalAssetControl {
  const body = (typeof row.body === "string" ? JSON.parse(row.body) : structuredClone(row.body)) as RentalAssetControl;
  if (!body || body.id !== row.id || body.tenantId !== row.tenantId || body.workspaceId !== row.workspaceId
    || body.assetId !== row.assetId || body.status !== row.status || body.revision !== row.revision
    || body.startAt !== row.startAt.toISOString() || (body.endedAt ?? null) !== (row.endedAt?.toISOString() ?? null)
    || body.policy?.blocksRental !== Boolean(row.blocksRental) || (body.workOrderId ?? null) !== row.workOrderId
    || !["active", "cancelled", "released"].includes(body.status) || body.policy.requiresWorkOrder && !body.workOrderId
    || !Number.isSafeInteger(body.revision) || body.revision < 1 || typeof body.emergency !== "boolean" || typeof body.conflictsPending !== "boolean"
    || body.status === "active" && Boolean(body.endedAt) || body.status !== "active" && !body.endedAt
    || body.status === "released" && Date.parse(body.endedAt!) < Date.parse(body.startAt))
    throw new ConflictException("人工管控原事实与索引不一致");
  assertAssetControlType(body.policy);
  return body;
}
export async function readAssetControls(client: Pick<RentalCoreFactTransaction, "$queryRaw">, tenantId: string, workspaceId: string,
  assetIds?: readonly string[], activeOnly = false): Promise<RentalAssetControl[]> {
  if (assetIds && !assetIds.length) return [];
  const rows = await client.$queryRaw<AssetControlRow[]>(sql`SELECT * FROM rental_asset_controls
    WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId}
      ${assetIds ? sql`AND assetId IN (${join([...assetIds])})` : empty}
      ${activeOnly ? sql`AND status = 'active'` : empty}
    ORDER BY id LIMIT 10001`);
  if (rows.length > 10000) throw new ServiceUnavailableException("人工管控事实超出读取上限，请缩小资产范围");
  if (rows.some(row => row.tenantId !== tenantId || row.workspaceId !== workspaceId || assetIds && !assetIds.includes(row.assetId)))
    throw new ConflictException("人工管控不属于本次库存范围");
  return rows.map(decodeAssetControl);
}
export async function readAssetControlReservations(client: Pick<RentalCoreFactTransaction, "$queryRaw" | "rentalAsset">,
  tenantId: string, workspaceId: string, assetIds?: readonly string[]) {
  const controls = await readAssetControls(client, tenantId, workspaceId, assetIds, true);
  if (!controls.length) return [];
  // 原维护/停用已经从总容量排除，不能重复扣减。地点使用当前资产，移动不能绕过原限制。
  const assets = await client.rentalAsset.findMany({ where: { tenantId, workspaceId,
    id: { in: [...new Set(controls.map(row => row.assetId))] }, status: { notIn: ["MAINTENANCE", "DISABLED"] } },
    select: { id: true, itemGroupId: true, locationId: true } });
  return assetControlOccupancies(controls).flatMap(period => {
    const asset = assets.find(row => row.id === period.assetId);
    return asset ? [{ assetIds: [asset.id], itemGroupId: asset.itemGroupId, locationId: asset.locationId,
      quantity: 1, startAt: period.startAt, endAt: period.endAt, source: "asset_control" as const }] : [];
  });
}

/** 原工单列表先取得受权对象，此处只补这些工单的来源，不扩大为资产管控列表权。 */
export async function readWorkOrderControlSources(client: Pick<RentalCoreFactTransaction, "$queryRaw">, tenantId: string, workspaceId: string,
  workOrders: ReadonlyArray<Pick<RentalWorkOrder, "id" | "assetId">>) {
  const result = new Map<string, NonNullable<RentalWorkOrder["assetControl"]>>();
  for (let offset = 0; offset < workOrders.length; offset += 200) {
    const batch = workOrders.slice(offset, offset + 200);
    const rows = await client.$queryRaw<AssetControlRow[]>(sql`SELECT * FROM rental_asset_controls
      WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId} AND workOrderId IN (${join(batch.map(row => row.id))}) LIMIT 201`);
    if (rows.length > batch.length) throw new ConflictException("养护工单的管控来源不唯一");
    for (const row of rows) {
      const work = batch.find(work => work.id === row.workOrderId);
      if (!work || work.assetId !== row.assetId || row.tenantId !== tenantId || row.workspaceId !== workspaceId || result.has(work.id))
        throw new ConflictException("养护工单的管控来源不一致");
      const control = decodeAssetControl(row);
      result.set(work.id, { id: control.id, status: control.status, startAt: control.startAt,
        releaseRequiresAcceptance: control.policy.releaseRequiresAcceptance });
    }
  }
  return result;
}
