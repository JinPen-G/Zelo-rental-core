import { objectOf, arrayOf, ref, stringSchema, numberSchema, booleanSchema, type SchemaObject } from "./http-openapi-contract";
import { RentalCoreOrderStatus, RENTAL_FULFILLMENT_MODES, RENTAL_WORK_ORDER_TYPES } from "./contracts";

const optionalTime: SchemaObject = { type: "string", format: "date-time", nullable: true };
export const RENTAL_ASSET_SCHEDULE_SCHEMAS: Record<string, SchemaObject> = {
  RentalAssetScheduleEntry: objectOf({ id: stringSchema, kind: { type: "string", enum: ["reservation", "rental", "preparation", "turnaround", "work_order", "asset_hold"] },
    startAt: optionalTime, endAt: optionalTime, plannedEndAt: { type: "string", format: "date-time" }, overdue: booleanSchema,
    source: { type: "string", enum: ["order", "work_order", "asset_status", "restricted"] }, sourceId: stringSchema, sourceNo: stringSchema,
    order: objectOf({ status: { type: "string", enum: Object.values(RentalCoreOrderStatus) },
      fulfillmentMode: { type: "string", enum: [...RENTAL_FULFILLMENT_MODES] }, effectiveEndAt: { type: "string", format: "date-time" } }, ["status", "fulfillmentMode"]),
    status: stringSchema, assigneeName: stringSchema, workOrderType: { type: "string", enum: [...RENTAL_WORK_ORDER_TYPES] },
    bufferBasis: { type: "string", enum: ["historical_rule", "legacy_missing"] } },
  ["id", "kind", "startAt", "endAt", "overdue", "source"]),
  RentalAssetScheduleOverlap: objectOf({ startAt: { type: "string", format: "date-time" }, endAt: { type: "string", format: "date-time" },
    reservationCount: { type: "integer", minimum: 2 } }, ["startAt", "endAt", "reservationCount"]),
  RentalAssetSchedule: objectOf({ source: { type: "string", enum: ["persisted_inventory_facts"] }, observedAt: { type: "string", format: "date-time" },
    timeZone: stringSchema, startAt: { type: "string", format: "date-time" }, endAt: { type: "string", format: "date-time" }, page: numberSchema, pageSize: numberSchema, total: numberSchema,
    rows: arrayOf(objectOf({ id: stringSchema, assetNo: stringSchema, itemGroupId: stringSchema, itemGroupName: stringSchema, locationId: stringSchema, locationName: stringSchema,
      status: stringSchema, entries: arrayOf(ref("RentalAssetScheduleEntry")), overlaps: arrayOf(ref("RentalAssetScheduleOverlap")) },
    ["id", "assetNo", "itemGroupId", "itemGroupName", "locationId", "locationName", "status", "entries", "overlaps"])),
    locations: arrayOf(objectOf({ id: stringSchema, name: stringSchema }, ["id", "name"])), itemGroups: arrayOf(objectOf({ id: stringSchema, name: stringSchema }, ["id", "name"])),
    capacity: arrayOf(objectOf({ itemGroupId: stringSchema, itemGroupName: stringSchema, locationId: stringSchema, locationName: stringSchema,
      operableQuantity: numberSchema, reservedPeak: numberSchema, unassignedPeak: numberSchema, availableQuantity: numberSchema, shortage: numberSchema, enabled: booleanSchema },
    ["itemGroupId", "itemGroupName", "locationId", "locationName", "operableQuantity", "reservedPeak", "unassignedPeak", "availableQuantity", "shortage", "enabled"])),
    unassigned: arrayOf({ allOf: [ref("RentalAssetScheduleEntry"), objectOf({ itemGroupId: stringSchema, locationId: stringSchema, quantity: numberSchema }, ["itemGroupId", "locationId", "quantity"])] }) },
  ["source", "observedAt", "timeZone", "startAt", "endAt", "page", "pageSize", "total", "rows", "locations", "itemGroups", "capacity", "unassigned"])
};
