/** 营销版本的草稿/发布状态和受信操作权限。金额仍由 discount-selection 计算；
 * 本模块不读库、不分配权限、不迁移旧方案或更新历史报价。 */
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import type { RequestIdentity } from "@rental-os/platform-server/request-identity";
import {
  RENTAL_SINGLE_MARKETING_RULE_POLICY, type ChangeRentalMarketingPlanStatusRequest,
  type RentalMarketingPlan, type RentalMarketingPlanEvent, type RentalMarketingPlanVersion,
  type SaveRentalMarketingPlanDraftRequest, type RentalDiscountPlan, type ImportRentalMarketingPlanRequest
} from "./contracts";
import { assertMarketingPlan, RentalMarketingSelectionError } from "./discount-selection";

export const RENTAL_MARKETING_READ_PERMISSIONS = ["rental-os:marketing:view", "rental-os:marketing:edit",
  "rental-os:marketing:publish", "rental-os:marketing:manage", "rental-os:price:manage"] as const;
export const RENTAL_MARKETING_EDIT_PERMISSIONS = ["rental-os:marketing:edit", "rental-os:marketing:manage", "rental-os:price:manage"] as const;
export const RENTAL_MARKETING_PUBLISH_PERMISSIONS = ["rental-os:marketing:publish"] as const;

export interface RentalMarketingScope { tenantId: string; workspaceId: string; categoryCode: string }
export type RentalMarketingOperationScope = Pick<RentalMarketingScope, "tenantId" | "workspaceId">;
export type RentalMarketingAction = RentalMarketingPlanEvent["action"];

export function assertMarketingOperation(action: RentalMarketingAction, operationId: string): void {
  if (!["save_draft", "publish", "pause", "end"].includes(action)
    || typeof operationId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(operationId))
    throw new BadRequestException("营销原操作类型或操作号无效");
}

/** 原 Auth/Guard/ALS 身份是唯一授权来源；页面准入和旧编辑权限不产生发布权。
 * 保留当前空间管理员及显式*的原授权，SaaS/client不进入经营配置。 */
export function assertMarketingAuthority(identity: Partial<RequestIdentity> | undefined, scope: RentalMarketingOperationScope,
  action: "read" | RentalMarketingAction): string {
  const permissions = action === "read" ? RENTAL_MARKETING_READ_PERMISSIONS
    : action === "save_draft" ? RENTAL_MARKETING_EDIT_PERMISSIONS : RENTAL_MARKETING_PUBLISH_PERMISSIONS;
  if (!identity?.userId || identity.tenantId !== scope.tenantId || !scope.workspaceId || identity.workspaceId !== scope.workspaceId
    || identity.isSaasAdmin || identity.audience === "client" || !Array.isArray(identity.permissions)
    || !(identity.isPlatformAdmin || identity.permissions.includes("*") || permissions.some(code => identity.permissions!.includes(code)))) {
    throw new ForbiddenException(action === "read" ? "没有当前经营空间的营销读取权限"
      : action === "save_draft" ? "没有当前经营空间的营销草稿编辑权限" : "发布、暂停或结束营销方案需要独立发布权限");
  }
  return identity.userId;
}

export function assertMarketingRevision(current: RentalMarketingPlan | undefined, expected: number): void {
  if (!Number.isSafeInteger(expected) || expected < 0) throw new BadRequestException("营销方案修订无效");
  if ((current?.revision ?? 0) !== expected) throw new ConflictException("营销方案已变化，请重新读取原方案");
}

function reasonOf(input: { changeReason: string }): string {
  if (typeof input.changeReason !== "string" || !input.changeReason.trim() || input.changeReason.length > 500)
    throw new BadRequestException("营销变更原因须为1～500字");
  return input.changeReason.trim();
}

function validateVersion(version: RentalMarketingPlanVersion): void {
  try { assertMarketingPlan(version); }
  catch (error) {
    if (error instanceof RentalMarketingSelectionError) throw new BadRequestException(error.message);
    throw error;
  }
  if (version.rules.length > 100 || [version.code, version.name].some(value => value.length > 191)
    || version.rules.some(rule => rule.id.length > 191 || rule.name.length > 191))
    throw new BadRequestException("营销方案最多100条规则，标识和名称不得超过191字");
}

export function prepareMarketingDraft(scope: RentalMarketingScope, input: SaveRentalMarketingPlanDraftRequest,
  current: RentalMarketingPlan | undefined, at: string): RentalMarketingPlan {
  assertMarketingRevision(current, input.expectedRevision);
  reasonOf(input);
  if (current?.status === "ended") throw new ConflictException("已结束方案不能继续编辑，请新建方案");
  if (input.id && !current) throw new ConflictException("待修改的营销方案不存在");
  if (current && (current.tenantId !== scope.tenantId || current.workspaceId !== scope.workspaceId
    || current.categoryCode !== scope.categoryCode || current.id !== input.id)) throw new ConflictException("营销方案归属不一致");
  if (typeof input.code !== "string" || typeof input.name !== "string" || !Array.isArray(input.rules))
    throw new BadRequestException("营销编码、名称和规则集合无效");
  // 已有方案编码是稳定查找依据。改名和范围调整形成新正文，编码不在保存中换身份。
  if (current && current.code !== input.code.trim()) throw new ConflictException("既有营销方案编码不能更改");
  const revision = (current?.revision ?? 0) + 1;
  const id = current?.id ?? `marketing_${randomUUID()}`;
  const draft: RentalMarketingPlanVersion = {
    id, ...scope, code: input.code.trim(), name: input.name.trim(), status: "draft", version: `draft-${revision}`,
    pricingPolicy: input.pricingPolicy, appliesTo: input.appliesTo,
    minimumSpend: input.minimumSpend, customerScope: input.customerScope,
    applicableItemGroupIds: structuredClone(input.applicableItemGroupIds),
    applicablePricingGroupIds: structuredClone(input.applicablePricingGroupIds ?? []),
    applicableDayTypes: structuredClone(input.applicableDayTypes), priority: input.priority,
    effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo,
    legacySource: structuredClone(current?.draft?.legacySource ?? current?.published?.legacySource),
    rules: input.rules.map(rule => ({ ...structuredClone(rule), version: `draft-${revision}` })),
    createdAt: current?.createdAt ?? at, updatedAt: at
  };
  validateVersion(draft);
  return { id, ...scope, code: draft.code, status: current?.status ?? "draft", revision, draft,
    published: current?.published ? structuredClone(current.published) : undefined,
    createdAt: current?.createdAt ?? at, updatedAt: at };
}

export function legacyMarketingPlanId(scope: RentalMarketingScope, sourcePlanId: string) {
  return `marketing_legacy_${createHash("sha256").update(JSON.stringify([scope.tenantId, scope.workspaceId, sourcePlanId])).digest("hex")}`;
}

/** 单规则等价映射只接受原租金且不叠加/允许券的配置；不能静默改造旧权益。 */
export function prepareLegacyMarketingImport(scope: RentalMarketingScope, source: RentalDiscountPlan,
  input: ImportRentalMarketingPlanRequest, at: string): RentalMarketingPlan {
  if (input.expectedRevision !== 0 || source.id !== input.sourcePlanId || source.version !== input.sourceVersion
    || source.tenantId !== scope.tenantId || source.categoryCode !== scope.categoryCode)
    throw new ConflictException("旧优惠方案来源或版本已变化");
  if (source.appliesTo !== "rental" || source.stackableWithOtherPlans || !source.stackableWithCoupon)
    throw new ConflictException("旧方案含叠加、禁券或非租金目标，请按新策略明确新建，不能自动等价转换");
  const stableId = legacyMarketingPlanId(scope, source.id), pricingIds = source.applicablePricingGroupIds ?? [];
  const next = prepareMarketingDraft(scope, { operationId: input.operationId, expectedRevision: 0, changeReason: input.changeReason,
    code: source.code, name: source.name, pricingPolicy: RENTAL_SINGLE_MARKETING_RULE_POLICY, appliesTo: "rental",
    minimumSpend: source.minimumSpend, customerScope: source.customerScope,
    // 原单规则用定价分组优先于商品。保持其实际命中范围，原字段完整保存在来源快照。
    applicableItemGroupIds: pricingIds.length ? [] : [...source.applicableItemGroupIds], applicablePricingGroupIds: [...pricingIds],
    applicableDayTypes: [...source.applicableDayTypes], priority: source.priority, effectiveFrom: source.effectiveFrom, effectiveTo: source.effectiveTo,
    rules: [{ id: `legacy_rule_${stableId.slice(-64)}`, name: source.name, status: "enabled", priority: source.priority, conditions: {},
      action: { type: source.discountType, value: source.discountValue, thresholdAmount: source.thresholdAmount, maximumDiscount: source.maximumDiscount } }] }, undefined, at);
  next.id = stableId; next.draft!.id = stableId;
  next.draft!.legacySource = { importedAt: at, plan: structuredClone(source) };
  return next;
}

/** published 正文只在发布时产生新版本。暂停/结束保留同一份不可变正文及历史版本。 */
export function transitionMarketingPlan(current: RentalMarketingPlan, action: Exclude<RentalMarketingAction, "save_draft">,
  input: ChangeRentalMarketingPlanStatusRequest, at: string): RentalMarketingPlan {
  assertMarketingRevision(current, input.expectedRevision);
  reasonOf(input);
  if (current.status === "ended") throw new ConflictException("营销方案已结束");
  const next: RentalMarketingPlan = { ...structuredClone(current), revision: current.revision + 1, updatedAt: at };
  if (action === "publish") {
    if (!current.draft) throw new ConflictException("没有可发布的营销草稿");
    const sequence = current.published ? Number(current.published.version) + 1 : 1;
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new ConflictException("原营销发布版本不可用");
    const draft = structuredClone(current.draft);
    const rules = draft.rules.map(rule => {
      const old = current.published?.rules.find(row => row.id === rule.id);
      const content = ({ version: _version, ...value }: typeof rule) => value;
      return { ...rule, version: old && isDeepStrictEqual(content(old), content(rule)) ? old.version : String(sequence) };
    });
    next.published = { ...draft, pricingPolicy: RENTAL_SINGLE_MARKETING_RULE_POLICY, status: "enabled",
      version: String(sequence), rules, updatedAt: at };
    validateVersion(next.published);
    next.status = "enabled";
    delete next.draft;
  } else {
    if (!current.published) throw new ConflictException("尚未发布的营销方案不能暂停或结束");
    if (action === "pause" && current.status !== "enabled") throw new ConflictException("仅生效方案可以暂停");
    next.status = action === "pause" ? "paused" : "ended";
  }
  return next;
}

export function marketingEvent(next: RentalMarketingPlan, action: RentalMarketingAction,
  actorUserId: string, input: { changeReason: string }): RentalMarketingPlanEvent {
  return { id: `marketing_event_${randomUUID()}`, planId: next.id, revision: next.revision,
    action, publishedVersion: next.published?.version, actorUserId, reason: reasonOf(input), at: next.updatedAt };
}
