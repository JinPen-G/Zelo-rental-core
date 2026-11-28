/** 多规则营销 HTTP 合同；字段与正式 DTO/服务端版本相同，不将发布权归并为编辑权。 */
import { RENTAL_MARKETING_RULE_ACTIONS, RENTAL_MARKETING_DURATION_UNITS, RENTAL_SINGLE_MARKETING_RULE_POLICY } from "./contracts";
import { RENTAL_MARKETING_READ_PERMISSIONS, RENTAL_MARKETING_EDIT_PERMISSIONS, RENTAL_MARKETING_PUBLISH_PERMISSIONS } from "./marketing-plan";
import { arrayOf, objectOf, objectSchema, ref, type SchemaObject, type ContractOperation } from "./http-openapi-contract";

const id: SchemaObject = { type: "string", minLength: 1, maxLength: 191 };
const date: SchemaObject = { type: "string", format: "date-time" };
const money: SchemaObject = { type: "number", minimum: 0 };
const revision: SchemaObject = { type: "integer", minimum: 0 };
const scope: SchemaObject = { type: "string", enum: ["all", "personal", "corporate", "member"] };
const days = arrayOf({ type: "string", enum: ["workday", "weekend", "statutory_holiday", "makeup_workday", "tenant_special"] });
const reason: SchemaObject = { type: "string", minLength: 1, maxLength: 500 };
const operationId: SchemaObject = { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$", minLength: 1, maxLength: 128 };
const operationAction: SchemaObject = { type: "string", enum: ["save_draft", "publish", "pause", "end"] };
const pricingPolicy: SchemaObject = { type: "string", enum: ["legacy", "single_rule_v1"] };
const conditions = { minimumSpend: money, customerScope: scope, applicableItemGroupIds: arrayOf(id),
  applicablePricingGroupIds: arrayOf(id), applicableDayTypes: days, effectiveFrom: date, effectiveTo: date };
const rule = { id, name: id, status: { type: "string", enum: ["enabled", "disabled"] } as SchemaObject,
  priority: revision, conditions: ref("RentalMarketingRuleConditions"), action: ref("RentalMarketingRuleAction") };
const common = { code: id, name: id, pricingPolicy: { type: "string", enum: [RENTAL_SINGLE_MARKETING_RULE_POLICY] } as SchemaObject,
  appliesTo: { type: "string", enum: ["rental"] } as SchemaObject, ...conditions, priority: revision };
const commonRequired = ["code", "name", "pricingPolicy", "appliesTo", "minimumSpend", "customerScope",
  "applicableItemGroupIds", "applicableDayTypes", "priority", "effectiveFrom"];

export const RENTAL_MARKETING_SCHEMAS: Record<string, SchemaObject> = {
  RentalMarketingPricingSnapshot: objectOf({ policy: { type: "string", enum: ["single_rule_v1"] },
    policyRevision: { type: "integer", minimum: 1 }, baseRentalAmount: money, marketingRentalAmount: money,
    selected: objectOf({ planId: id, planVersion: id, ruleId: id, ruleVersion: id }, ["planId", "planVersion", "ruleId", "ruleVersion"], false),
    rentalLines: arrayOf(objectOf({ id, itemGroupId: id, pricingGroupId: id, amount: money,
      quantity: { type: "integer", minimum: 1 }, pricingUnit: { type: "string" }, billableUnits: money },
      ["id", "itemGroupId", "amount", "quantity", "pricingUnit", "billableUnits"], false)), dayTypes: days },
    ["policy", "policyRevision", "baseRentalAmount", "marketingRentalAmount", "rentalLines", "dayTypes"], false),
  RentalMarketingPricingPolicy: objectOf({ tenantId: id, workspaceId: id, policy: pricingPolicy,
    revision, updatedAt: date, updatedBy: id }, ["tenantId", "workspaceId", "policy", "revision"], false),
  ChangeRentalMarketingPricingPolicyRequest: objectOf({ operationId, expectedRevision: revision,
    policy: pricingPolicy, changeReason: reason }, ["operationId", "expectedRevision", "policy", "changeReason"], false),
  RentalMarketingPricingPolicyReceipt: { oneOf: [objectOf({ status: { type: "string", enum: ["unknown"] } }, ["status"], false),
    objectOf({ status: { type: "string", enum: ["committed"] }, operationId, result: ref("RentalMarketingPricingPolicy") },
      ["status", "operationId", "result"], false)] },
  RentalMarketingRentalDuration: objectOf({ unit: { type: "string", enum: [...RENTAL_MARKETING_DURATION_UNITS] },
    minimum: { type: "number", minimum: 0, exclusiveMinimum: true }, maximum: { type: "number", minimum: 0, exclusiveMinimum: true } }, ["unit"], false),
  RentalMarketingRuleConditions: objectOf({ ...conditions, rentalDuration: ref("RentalMarketingRentalDuration") }, [], false),
  RentalMarketingRuleAction: objectOf({ type: { type: "string", enum: [...RENTAL_MARKETING_RULE_ACTIONS] }, value: money,
    thresholdAmount: money, maximumDiscount: money }, ["type", "value"], false),
  RentalMarketingRuleDraft: objectOf(rule, Object.keys(rule), false),
  RentalMarketingRule: objectOf({ ...rule, version: id }, [...Object.keys(rule), "version"], false),
  SaveRentalMarketingPlanDraftRequest: objectOf({ ...common, id, operationId, expectedRevision: revision,
    rules: { ...arrayOf("RentalMarketingRuleDraft"), minItems: 1, maxItems: 100 }, changeReason: reason },
    [...commonRequired, "operationId", "expectedRevision", "rules", "changeReason"], false),
  ChangeRentalMarketingPlanStatusRequest: objectOf({ operationId, expectedRevision: { ...revision, minimum: 1 }, changeReason: reason }, ["operationId", "expectedRevision", "changeReason"], false),
  RentalMarketingPlanOperationReceipt: { oneOf: [objectOf({ status: { type: "string", enum: ["unknown"] } }, ["status"], false),
    objectOf({ status: { type: "string", enum: ["committed"] }, operationId, action: operationAction, planId: id, revision: { ...revision, minimum: 1 } },
      ["status", "operationId", "action", "planId", "revision"], false)] },
  RentalMarketingPlanVersion: objectOf({ ...common, id, tenantId: id, workspaceId: id, categoryCode: id,
    status: { type: "string", enum: ["draft", "enabled", "disabled"] }, version: id,
    rules: arrayOf("RentalMarketingRule"), createdAt: date, updatedAt: date },
    [...commonRequired, "id", "tenantId", "workspaceId", "categoryCode", "status", "version", "rules", "createdAt", "updatedAt"], false),
  RentalMarketingPlan: objectOf({ id, tenantId: id, workspaceId: id, categoryCode: id, code: id,
    status: { type: "string", enum: ["draft", "enabled", "paused", "ended"] }, revision: { ...revision, minimum: 1 },
    draft: ref("RentalMarketingPlanVersion"), published: ref("RentalMarketingPlanVersion"), createdAt: date, updatedAt: date },
    ["id", "tenantId", "workspaceId", "categoryCode", "code", "status", "revision", "createdAt", "updatedAt"], false),
  RentalMarketingPlanEvent: objectOf({ id, planId: id, revision, action: { type: "string", enum: ["save_draft", "publish", "pause", "end"] },
    publishedVersion: id, actorUserId: id, reason, at: date }, ["id", "planId", "revision", "action", "actorUserId", "reason", "at"], false),
  RentalMarketingPlanHistory: objectOf({ versions: arrayOf("RentalMarketingPlanVersion"), events: arrayOf("RentalMarketingPlanEvent") }, ["versions", "events"], false)
};

const errors = { "400": { description: "规则或请求字段无效", schema: objectSchema },
  "403": { description: "当前身份缺少此动作权限", schema: objectSchema },
  "404": { description: "当前空间不存在该营销方案", schema: objectSchema },
  "409": { description: "方案修订、范围或发布依据已变化", schema: objectSchema },
  "503": { description: "必要持久化或规则资料不可用", schema: objectSchema } };
const operations: Omit<ContractOperation, "tag">[] = [
  { method: "get", path: "/api/rental/v1/marketing-pricing-policy", operationId: "readRentalMarketingPricingPolicy",
    summary: "读取当前空间营销策略及原修订", permissions: [...RENTAL_MARKETING_READ_PERMISSIONS], responseSchema: "RentalMarketingPricingPolicy" },
  { method: "put", path: "/api/rental/v1/marketing-pricing-policy", operationId: "changeRentalMarketingPricingPolicy",
    summary: "显式切换后续新报价的营销策略", permissions: [...RENTAL_MARKETING_PUBLISH_PERMISSIONS],
    requestSchema: "ChangeRentalMarketingPricingPolicyRequest", responseSchema: "RentalMarketingPricingPolicy" },
  { method: "get", path: "/api/rental/v1/marketing-pricing-policy/operations/{operationId}", operationId: "readRentalMarketingPricingPolicyOperation",
    summary: "只读核对本人原营销策略切换收据", permissions: [...RENTAL_MARKETING_READ_PERMISSIONS], responseSchema: "RentalMarketingPricingPolicyReceipt",
    parameters: [{ name: "operationId", in: "path", required: true, schema: operationId }] },
  { method: "get", path: "/api/rental/v1/marketing-plans", operationId: "listRentalMarketingPlans", summary: "读取营销草稿及当前发布版本",
    permissions: [...RENTAL_MARKETING_READ_PERMISSIONS], responseSchema: arrayOf("RentalMarketingPlan") },
  { method: "get", path: "/api/rental/v1/marketing-plans/operations/{operationId}", operationId: "readRentalMarketingPlanOperation", summary: "只读核对本人原营销操作收据",
    permissions: [...RENTAL_MARKETING_READ_PERMISSIONS], responseSchema: "RentalMarketingPlanOperationReceipt",
    parameters: [{ name: "operationId", in: "path", required: true, schema: operationId }, { name: "action", in: "query", required: true, schema: operationAction }] },
  { method: "get", path: "/api/rental/v1/marketing-plans/{id}/history", operationId: "readRentalMarketingPlanHistory", summary: "读取不可变营销版本及操作记录",
    permissions: [...RENTAL_MARKETING_READ_PERMISSIONS], responseSchema: "RentalMarketingPlanHistory" },
  { method: "post", path: "/api/rental/v1/marketing-plans", operationId: "createRentalMarketingPlanDraft", summary: "新建多规则营销草稿",
    permissions: [...RENTAL_MARKETING_EDIT_PERMISSIONS], requestSchema: "SaveRentalMarketingPlanDraftRequest", responseSchema: "RentalMarketingPlan", successStatus: 201 },
  { method: "put", path: "/api/rental/v1/marketing-plans/{id}/draft", operationId: "saveRentalMarketingPlanDraft", summary: "按原修订保存完整规则草稿",
    permissions: [...RENTAL_MARKETING_EDIT_PERMISSIONS], requestSchema: "SaveRentalMarketingPlanDraftRequest", responseSchema: "RentalMarketingPlan" },
  ...(["publish", "pause", "end"] as const).map(action => ({ method: "post" as const,
    path: `/api/rental/v1/marketing-plans/{id}/${action}`, operationId: `${action}RentalMarketingPlan`,
    summary: { publish: "发布营销规则版本", pause: "暂停营销方案后续适用", end: "结束营销方案后续适用" }[action],
    permissions: [...RENTAL_MARKETING_PUBLISH_PERMISSIONS], requestSchema: "ChangeRentalMarketingPlanStatusRequest", responseSchema: "RentalMarketingPlan",
    successStatus: 201 as const }))
];
export const RENTAL_MARKETING_OPERATIONS: ContractOperation[] = operations.map(operation => ({ ...operation, tag: "RentalBusiness", errorResponses: errors }));
