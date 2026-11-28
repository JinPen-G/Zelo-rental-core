/** 多规则营销 HTTP 合同；字段与正式 DTO/服务端版本相同，不将发布权归并为编辑权。 */
import { RENTAL_DISCOUNT_TYPES, RENTAL_SINGLE_MARKETING_RULE_POLICY } from "./contracts";
import { RENTAL_MARKETING_READ_PERMISSIONS, RENTAL_MARKETING_EDIT_PERMISSIONS, RENTAL_MARKETING_PUBLISH_PERMISSIONS } from "./marketing-plan";
import { arrayOf, objectOf, objectSchema, ref, type SchemaObject, type ContractOperation } from "./http-openapi-contract";

const id: SchemaObject = { type: "string", minLength: 1, maxLength: 191 };
const date: SchemaObject = { type: "string", format: "date-time" };
const money: SchemaObject = { type: "number", minimum: 0 };
const revision: SchemaObject = { type: "integer", minimum: 0 };
const scope: SchemaObject = { type: "string", enum: ["all", "personal", "corporate", "member"] };
const days = arrayOf({ type: "string", enum: ["workday", "weekend", "statutory_holiday", "makeup_workday", "tenant_special"] });
const reason: SchemaObject = { type: "string", minLength: 1, maxLength: 500 };
const conditions = { minimumSpend: money, customerScope: scope, applicableItemGroupIds: arrayOf(id),
  applicablePricingGroupIds: arrayOf(id), applicableDayTypes: days, effectiveFrom: date, effectiveTo: date };
const rule = { id, name: id, status: { type: "string", enum: ["enabled", "disabled"] } as SchemaObject,
  priority: revision, conditions: ref("RentalMarketingRuleConditions"), action: ref("RentalMarketingRuleAction") };
const common = { code: id, name: id, pricingPolicy: { type: "string", enum: [RENTAL_SINGLE_MARKETING_RULE_POLICY] } as SchemaObject,
  appliesTo: { type: "string", enum: ["rental"] } as SchemaObject, ...conditions, priority: revision };
const commonRequired = ["code", "name", "pricingPolicy", "appliesTo", "minimumSpend", "customerScope",
  "applicableItemGroupIds", "applicableDayTypes", "priority", "effectiveFrom"];

export const RENTAL_MARKETING_SCHEMAS: Record<string, SchemaObject> = {
  RentalMarketingRuleConditions: objectOf(conditions, [], false),
  RentalMarketingRuleAction: objectOf({ type: { type: "string", enum: [...RENTAL_DISCOUNT_TYPES] }, value: money,
    thresholdAmount: money, maximumDiscount: money }, ["type", "value"], false),
  RentalMarketingRuleDraft: objectOf(rule, Object.keys(rule), false),
  RentalMarketingRule: objectOf({ ...rule, version: id }, [...Object.keys(rule), "version"], false),
  SaveRentalMarketingPlanDraftRequest: objectOf({ ...common, id, expectedRevision: revision,
    rules: { ...arrayOf("RentalMarketingRuleDraft"), minItems: 1, maxItems: 100 }, changeReason: reason },
    [...commonRequired, "expectedRevision", "rules", "changeReason"], false),
  ChangeRentalMarketingPlanStatusRequest: objectOf({ expectedRevision: { ...revision, minimum: 1 }, changeReason: reason }, ["expectedRevision", "changeReason"], false),
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
  { method: "get", path: "/api/rental/v1/marketing-plans", operationId: "listRentalMarketingPlans", summary: "读取营销草稿及当前发布版本",
    permissions: [...RENTAL_MARKETING_READ_PERMISSIONS], responseSchema: arrayOf("RentalMarketingPlan") },
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
