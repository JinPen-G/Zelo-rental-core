/** 原库存事实的有界排班读取。只投影当前可见资产和获授权来源，不创建预占、工单或配置。 */
import { ConflictException, ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import type { RentalCoreFactContacts, RentalCoreFactTransaction } from "./core-fact-storage";
import { RentalAssetStatus, type RentalRuleConfig } from "./contracts";
import type { RentalAssetSchedule, RentalAssetScheduleEntry, RentalAssetScheduleQuery } from "./asset-schedule";
import { peakReservedQuantity, reservedRentalPeriod } from "./occupancy";

const FACT_LIMIT = 10000;
const ASSET_LIMIT = 2000;
const PAGE_SIZE = 50;
type Scope = {
  assets: Prisma.RentalAssetWhereInput;
  orders: Prisma.RentalOrderWhereInput;
  workOrders: Prisma.RentalWorkOrderWhereInput;
  readOrders: boolean;
  readWorkOrders: boolean;
};

export async function readRentalAssetSchedule<Tx extends RentalCoreFactTransaction>(
  client: Tx, contacts: RentalCoreFactContacts<Tx>, tenantId: string, workspaceId: string,
  query: RentalAssetScheduleQuery, scope: Scope,
): Promise<Omit<RentalAssetSchedule, "timeZone">> {
  const identity = structuredClone(contacts.getRequestIdentity());
  const locationIds = structuredClone(contacts.getRequestLocationIds());
  const current = async () => {
    if (!identity?.userId || identity.tenantId !== tenantId || identity.workspaceId !== workspaceId || identity.isSaasAdmin
      || identity.audience === "client" || !isDeepStrictEqual(identity, contacts.getRequestIdentity())
      || !isDeepStrictEqual(locationIds, contacts.getRequestLocationIds())
      || await contacts.resolveWorkspaceId(client, tenantId) !== workspaceId)
      throw new ForbiddenException("排班读取缺少当前身份或经营范围已变化");
  };
  await current();
  if (query.locationId && locationIds !== undefined && !locationIds.includes(query.locationId))
    throw new ForbiddenException("排班地点不可访问");
  const now = new Date(), from = Date.parse(query.startAt), to = Date.parse(query.endAt);
  const [assets, locations] = await Promise.all([
    client.rentalAsset.findMany({ where: { AND: [{ tenantId, workspaceId, itemGroup: { inventoryMode: "SERIALIZED" },
      ...(query.locationId ? { locationId: query.locationId } : {}), ...(query.itemGroupId ? { itemGroupId: query.itemGroupId } : {}) }, scope.assets] },
      select: { id: true, tenantId: true, workspaceId: true, assetNo: true, status: true, itemGroupId: true, locationId: true,
        itemGroup: { select: { name: true, status: true } }, location: { select: { name: true } } },
      orderBy: [{ assetNo: "asc" }, { id: "asc" }], take: ASSET_LIMIT + 1 }),
    client.rentalFulfillmentLocation.findMany({ where: { tenantId, workspaceId,
      ...(locationIds === undefined ? {} : { id: { in: locationIds } }) }, select: { id: true, name: true }, orderBy: { id: "asc" }, take: ASSET_LIMIT + 1 })
  ]);
  const groups = await client.rentalItemGroup.findMany({ where: { tenantId, workspaceId, inventoryMode: "SERIALIZED",
    ...(query.itemGroupId ? { id: query.itemGroupId } : {}),
    ...(identity?.dataScope === "own" ? { AND: [{ id: { in: [...new Set(assets.map(row => row.itemGroupId))] } }] } : {}) },
    select: { id: true, name: true, status: true }, orderBy: { id: "asc" }, take: ASSET_LIMIT + 1 });
  if ([assets, locations, groups].some(rows => rows.length > ASSET_LIMIT)) throw new ServiceUnavailableException("排班资产超出读取上限，请缩小地点或型号范围");
  if (assets.some(row => row.tenantId !== tenantId || row.workspaceId !== workspaceId
    || locationIds !== undefined && !locationIds.includes(row.locationId))) throw new ConflictException("排班资产来源变化");
  const itemGroupIds = groups.map(row => row.id);
  const selectedLocations = locations.filter(row => !query.locationId || row.id === query.locationId).map(row => row.id);
  // Buffers live in each order's frozen rule. A raw date filter could drop an
  // overlapping preparation period, so read the bounded active set before clipping.
  const reservations = itemGroupIds.length ? await client.rentalReservation.findMany({
    where: { tenantId, workspaceId, itemGroupId: { in: itemGroupIds },
      status: { in: ["SOFT", "CONFIRMED", "FULFILLED"] }, AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
        { OR: [{ locationId: { in: selectedLocations } }, { order: { allocations: { some: { assetId: { in: assets.map(row => row.id) },
          status: { in: ["pre_assigned", "locked", "allocated", "picked_up"] } } } } }] }
      ] },
    select: { id: true, tenantId: true, workspaceId: true, orderId: true, orderLineId: true, itemGroupId: true, locationId: true,
      quantity: true, releasedQuantity: true, startAt: true, endAt: true, status: true,
      order: { select: { tenantId: true, workspaceId: true, orderNo: true, ruleSnapshot: true } } },
    orderBy: { id: "asc" }, take: FACT_LIMIT + 1
  }) : [];
  if (reservations.length > FACT_LIMIT)
    throw new ServiceUnavailableException("排班预占超出读取上限，不能按部分事实展示空闲");
  if (reservations.some(row => row.tenantId !== tenantId || row.workspaceId !== workspaceId
    || row.order.tenantId !== tenantId || row.order.workspaceId !== workspaceId)) throw new ConflictException("排班预占来源变化");
  const page = query.page ?? 1;
  const filtered = assets.filter(row => (!query.assetId || row.id === query.assetId) && (!query.status || row.status.toLowerCase() === query.status)
    && (!query.keyword || row.assetNo.toLocaleLowerCase().includes(query.keyword.trim().toLocaleLowerCase())));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const visibleIds = visible.map(row => row.id);
  const orderIds = [...new Set(reservations.map(row => row.orderId))];
  const [orders, workOrders, allocations] = await Promise.all([
    scope.readOrders && orderIds.length ? client.rentalOrder.findMany({ where: { AND: [{ tenantId, workspaceId, id: { in: orderIds } }, scope.orders] },
      select: { id: true }, take: FACT_LIMIT + 1 }) : [],
    scope.readWorkOrders && visibleIds.length ? client.rentalWorkOrder.findMany({ where: { AND: [{ tenantId, workspaceId, assetId: { in: visibleIds },
      status: { not: "cancelled" }, createdAt: { lt: new Date(to) }, OR: [{ status: { not: "completed" } }, { reviewedAt: null }, { reviewedAt: { gt: new Date(from) } }] }, scope.workOrders] },
      select: { id: true, assetId: true, workNo: true, type: true, status: true, assigneeName: true, createdAt: true, reviewedAt: true },
      orderBy: { id: "asc" }, take: FACT_LIMIT + 1 }) : [],
    orderIds.length ? client.rentalAllocation.findMany({ where: { order: { tenantId, workspaceId, id: { in: orderIds } },
      status: { in: ["pre_assigned", "locked", "allocated", "picked_up"] }, assetId: { not: null } },
      select: { orderId: true, orderLineId: true, itemGroupId: true, assetId: true }, orderBy: { id: "asc" }, take: FACT_LIMIT + 1 }) : []
  ]);
  if ([orders, workOrders, allocations].some(rows => rows.length > FACT_LIMIT)) throw new ServiceUnavailableException("排班来源超出读取上限");
  const readableOrders = new Set(orders.map(row => row.id));
  const facts = reservations.map((row, index) => {
    const quantity = Math.max(0, row.quantity - row.releasedQuantity);
    const rule = row.order.ruleSnapshot as unknown as RentalRuleConfig | undefined;
    const period = reservedRentalPeriod(row.startAt.toISOString(), row.endAt.toISOString(), row.status, rule, now);
    const assetIds = [...new Set(allocations.filter(allocation => allocation.orderId === row.orderId && allocation.orderLineId === row.orderLineId
      && (!allocation.itemGroupId || allocation.itemGroupId === row.itemGroupId)).map(row => row.assetId!))];
    const readable = readableOrders.has(row.orderId);
    const overdue = row.status === "FULFILLED" && row.endAt <= now;
    const entry: RentalAssetScheduleEntry = { id: `reservation-${index}`, kind: row.status === "FULFILLED" ? "rental" : "reservation",
      startAt: row.startAt.toISOString(), endAt: overdue ? null : row.endAt.toISOString(), plannedEndAt: row.endAt.toISOString(), overdue,
      source: readable ? "order" : "restricted", ...(readable ? { sourceId: row.orderId, sourceNo: row.order.orderNo } : {}),
      bufferBasis: rule ? "historical_rule" : "legacy_missing" };
    return { row, quantity, assetIds, period, entry, unassigned: Math.max(0, quantity - assetIds.length) };
  }).filter(fact => fact.quantity > 0 && Date.parse(fact.period.startAt) < to && Date.parse(fact.period.endAt) > from);
  const overlap = (entry: RentalAssetScheduleEntry) => (entry.startAt === null || Date.parse(entry.startAt) < to)
    && (entry.endAt === null || Date.parse(entry.endAt) > from);
  const rows = visible.map(asset => {
    const entries: RentalAssetScheduleEntry[] = [];
    for (const fact of facts.filter(fact => fact.assetIds.includes(asset.id))) {
      entries.push(fact.entry);
      if (Date.parse(fact.period.startAt) < Date.parse(fact.entry.startAt!)) entries.push({ ...fact.entry,
        id: `${fact.entry.id}-preparation`, kind: "preparation", startAt: fact.period.startAt, endAt: fact.entry.startAt, overdue: false });
      if (fact.entry.endAt && Date.parse(fact.period.endAt) > Date.parse(fact.entry.endAt)) entries.push({ ...fact.entry,
        id: `${fact.entry.id}-turnaround`, kind: "turnaround", startAt: fact.entry.endAt, endAt: fact.period.endAt, overdue: false });
    }
    for (const work of workOrders.filter(work => work.assetId === asset.id)) entries.push({ id: `work-${work.id}`, kind: "work_order",
      startAt: work.createdAt.toISOString(), endAt: work.status === "completed" ? work.reviewedAt?.toISOString() ?? null : null,
      source: "work_order", sourceId: work.id, sourceNo: work.workNo, status: work.status, assigneeName: work.assigneeName ?? undefined, overdue: false });
    const status = asset.status.toLowerCase() as RentalAssetStatus;
    // Current status has no reliable start/finish interval. Keep it explicit;
    // neither work-order creation nor updatedAt proves when this hold began.
    if ([RentalAssetStatus.Maintenance, RentalAssetStatus.Disabled, RentalAssetStatus.Inspection].includes(status)
      || [RentalAssetStatus.Reserved, RentalAssetStatus.Rented].includes(status) && !entries.some(entry => entry.kind === "rental" || entry.kind === "reservation")) entries.push({ id: `hold-${asset.id}`,
      kind: "asset_hold", startAt: null, endAt: null, source: "asset_status", status, overdue: false });
    return { id: asset.id, assetNo: asset.assetNo, itemGroupId: asset.itemGroupId, itemGroupName: asset.itemGroup.name,
      locationId: asset.locationId, locationName: asset.location.name, status, entries: entries.filter(overlap) };
  });
  const scopedFacts = facts.filter(fact => selectedLocations.includes(fact.row.locationId));
  const pairs = new Map([...assets, ...scopedFacts.map(fact => fact.row)].map(row => [`${row.locationId}\0${row.itemGroupId}`, row]));
  const capacity = [...pairs.values()].map(asset => {
    const matching = scopedFacts.filter(fact => fact.row.itemGroupId === asset.itemGroupId && fact.row.locationId === asset.locationId);
    const operableQuantity = assets.filter(row => row.itemGroupId === asset.itemGroupId && row.locationId === asset.locationId
      && row.status !== "MAINTENANCE" && row.status !== "DISABLED").length;
    const reservedPeak = peakReservedQuantity(matching.map(fact => ({ ...fact.period, quantity: fact.quantity })), query.startAt, query.endAt);
    const unassignedPeak = peakReservedQuantity(matching.map(fact => ({ ...fact.period, quantity: fact.unassigned })), query.startAt, query.endAt);
    const group = groups.find(row => row.id === asset.itemGroupId), location = locations.find(row => row.id === asset.locationId);
    if (!group || !location) throw new ConflictException("排班型号或地点来源缺失");
    const enabled = group.status === "enabled";
    return { itemGroupId: asset.itemGroupId, itemGroupName: group.name, locationId: asset.locationId, locationName: location.name,
      operableQuantity, reservedPeak, unassignedPeak, availableQuantity: enabled ? Math.max(0, operableQuantity - reservedPeak) : 0,
      shortage: Math.max(0, reservedPeak - (enabled ? operableQuantity : 0)), enabled };
  });
  await current();
  return { source: "persisted_inventory_facts", observedAt: now.toISOString(), startAt: query.startAt, endAt: query.endAt,
    page, pageSize: PAGE_SIZE, total: filtered.length, rows, locations,
    itemGroups: groups.map(row => ({ id: row.id, name: row.name })), capacity,
    unassigned: scopedFacts.filter(fact => fact.unassigned > 0).map(fact => ({ ...fact.entry,
      startAt: fact.period.startAt, endAt: fact.entry.overdue ? null : fact.period.endAt,
      itemGroupId: fact.row.itemGroupId, locationId: fact.row.locationId, quantity: fact.unassigned })) };
}
