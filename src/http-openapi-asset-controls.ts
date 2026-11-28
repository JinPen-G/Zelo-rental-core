/** 人工管控的公开HTTP描述。原权限、事务及收据校验由正式应用入口执行。 */
import { ASSET_CONTROL_READ_CODES } from "./asset-controls";
import { RENTAL_WORK_ORDER_TYPES } from "./contracts";
import { objectOf, arrayOf, ref, stringSchema as text, booleanSchema as flag, type SchemaObject, type ContractOperation } from "./http-openapi-contract";
const time: SchemaObject = { type: "string", format: "date-time" };
const revision: SchemaObject = { type: "integer", minimum: 0 };
const typeFields = { code: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$" }, name: { type: "string", minLength: 1, maxLength: 191 },
  enabled: flag, blocksRental: flag, requiresWorkOrder: flag, releaseRequiresAcceptance: flag, workOrderType: { type: "string", enum: [...RENTAL_WORK_ORDER_TYPES] } };
const typeRequired = ["code", "name", "enabled", "blocksRental", "requiresWorkOrder", "releaseRequiresAcceptance"];
const command = { operationId: { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" }, expectedRevision: revision,
  reason: { type: "string", pattern: "\\S", maxLength: 500 } };
const commandRequired = Object.keys(command);
const create = { ...command, assetId: text, typeCode: text, startAt: time, plannedEndAt: time, assigneeId: text };
export const RENTAL_ASSET_CONTROL_SCHEMAS: Record<string, SchemaObject> = {
  RentalAssetControlType: objectOf({ ...typeFields, revision }, [...typeRequired, "revision"], false),
  RentalAssetControlCommand: objectOf(command, commandRequired, false),
  CreateRentalAssetControlRequest: objectOf(create, [...commandRequired, "assetId", "typeCode"], false),
  EmergencyRentalAssetControlRequest: objectOf({ ...create, confirmed: { type: "boolean", enum: [true] } }, [...commandRequired, "assetId", "typeCode", "confirmed"], false),
  ExtendRentalAssetControlRequest: objectOf({ ...command, plannedEndAt: time }, [...commandRequired, "plannedEndAt"], false),
  SaveRentalAssetControlTypeRequest: objectOf({ ...command, type: objectOf(typeFields, typeRequired, false) }, [...commandRequired, "type"], false),
  RentalAssetControl: objectOf({ id: text, tenantId: text, workspaceId: text, assetId: text, itemGroupId: text, locationId: text,
    policy: ref("RentalAssetControlType"), status: { type: "string", enum: ["active", "cancelled", "released"] }, startAt: time, plannedEndAt: time,
    endedAt: time, workOrderId: text, assigneeId: text, reason: text, emergency: flag, conflictsPending: flag, revision,
    createdBy: text, createdAt: time, updatedAt: time }, ["id", "tenantId", "workspaceId", "assetId", "itemGroupId", "locationId", "policy", "status",
    "startAt", "reason", "emergency", "conflictsPending", "revision", "createdBy", "createdAt", "updatedAt"], false),
  RentalAssetControlReceipt: { oneOf: [objectOf({ status: { type: "string", enum: ["unknown"] } }, ["status"], false),
    objectOf({ status: { type: "string", enum: ["rejected"] }, operationId: text, action: text, targetId: text, expectedRevision: revision, message: text },
      ["status", "operationId", "action", "targetId", "expectedRevision", "message"], false),
    objectOf({ status: { type: "string", enum: ["committed"] }, operationId: text, action: { type: "string", enum: ["create", "emergency", "extend", "cancel", "release", "save_type"] },
      objectId: text, revision }, ["status", "operationId", "action", "objectId", "revision"], false)] },
  RentalAssetControlEvent: objectOf({ id: text, controlId: text, operationId: text, action: text, revision, reason: text, actorUserId: text,
    createdAt: time, before: ref("RentalAssetControl"), after: ref("RentalAssetControl") }, ["id", "controlId", "operationId", "action", "revision", "reason", "actorUserId", "createdAt", "after"], false),
  RentalAssetControlOptions: objectOf({ timeZone: text, assets: arrayOf(objectOf({ id: text, assetNo: text, itemGroupName: text,
    locationId: text, locationName: text, status: text }, ["id", "assetNo", "itemGroupName", "locationId", "locationName", "status"], false)) }, ["timeZone", "assets"], false),
  RentalAssetControlConflicts: objectOf({ available: flag, orders: arrayOf(objectOf({ id: text, orderNo: text, status: text }, ["id", "orderNo", "status"], false)) }, ["available", "orders"], false)
};
const read = (path: string, operationId: string, summary: string, responseSchema: string | SchemaObject): ContractOperation =>
  ({ method: "get", path: `/api/rental/v1/${path}`, operationId, summary, tag: "RentalCore", permissions: [...ASSET_CONTROL_READ_CODES], responseSchema });
export const RENTAL_ASSET_CONTROL_OPERATIONS: ContractOperation[] = [
  read("asset-control-types", "readRentalAssetControlTypes", "读取当前空间管控类型及原修订", arrayOf("RentalAssetControlType")),
  read("asset-control-options", "readRentalAssetControlOptions", "读取原资产范围和经营时区", "RentalAssetControlOptions"),
  { ...read("asset-control-assignees", "readRentalAssetControlAssignees", "按原受权地点读取处理人", arrayOf(objectOf({ id: text, displayName: text }, ["id", "displayName"], false))),
    parameters: [{ name: "locationId", in: "query", required: true, schema: text }] },
  { ...read("asset-controls", "listRentalAssetControls", "读取当前资产范围内的管控原事实", arrayOf("RentalAssetControl")), parameters: [{ name: "assetId", in: "query", schema: text }] },
  read("asset-controls/{id}/history", "readRentalAssetControlHistory", "读取本条管控最近200条追加履历", arrayOf("RentalAssetControlEvent")),
  read("asset-controls/{id}/conflicts", "readRentalAssetControlConflicts", "沿当前原订单权投影待处理冲突，不授予订单操作权", "RentalAssetControlConflicts"),
  { ...read("asset-control-operations/{operationId}", "readRentalAssetControlReceipt", "按本人、空间、动作及原键只读核对；unknown不代表可重发", "RentalAssetControlReceipt"),
    parameters: [{ name: "action", in: "query", required: true, schema: { type: "string", enum: ["create", "emergency", "extend", "cancel", "release", "save_type"] } },
      { name: "targetId", in: "query", required: true, schema: { type: "string", description: "创建为原资产，配置为类型code，其他为管控ID" } }] },
  ...([
    ["put", "asset-control-types", "saveRentalAssetControlType", "configure", "SaveRentalAssetControlTypeRequest"],
    ["post", "asset-controls", "createRentalAssetControl", "manage", "CreateRentalAssetControlRequest"],
    ["post", "asset-controls/emergency", "emergencyRentalAssetControl", "emergency", "EmergencyRentalAssetControlRequest"],
    ["post", "asset-controls/{id}/extend", "extendRentalAssetControl", "manage", "ExtendRentalAssetControlRequest"],
    ["post", "asset-controls/{id}/cancel", "cancelRentalAssetControl", "manage", "RentalAssetControlCommand"],
    ["post", "asset-controls/{id}/release", "releaseRentalAssetControl", "manage", "RentalAssetControlCommand"]
  ] as const).map(([method, path, operationId, action, requestSchema]) => ({ method, path: `/api/rental/v1/${path}`, operationId,
    summary: "原幂等事务提交管控与追加履历；预计结束不释放，原工单验收及当前权限保持", tag: "RentalCore",
    permissions: [`rental-core:asset:control:${action}`], requestSchema, responseSchema: "RentalAssetControlReceipt" }))
];
