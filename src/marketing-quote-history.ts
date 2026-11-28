/** 从原报价核对新营销策略及唯一采用规则，供原动作重算。只用冻结来源，
 * 不读取当前方案/空间策略，不把旧快照补成新策略，不重选其他候选。 */
import { ConflictException } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import type { RentalMarketingPlanVersion, RentalMarketingQuoteDiscountEvaluation, RentalQuoteSnapshotV1 } from "./contracts";
import { assertMarketingPlan, RentalMarketingSelectionError, selectMarketingRule } from "./discount-selection";
import { roundMoney } from "./money";
import { marketingQualificationSnapshotError } from "./marketing-qualification";

export function isSingleRuleEvaluation(value: RentalQuoteSnapshotV1["discountEvaluations"][number]): value is RentalMarketingQuoteDiscountEvaluation {
  return "pricingPolicy" in value && value.pricingPolicy === "single_rule_v1";
}

export function assertSingleRuleEvaluation(evaluation: RentalMarketingQuoteDiscountEvaluation): void {
  const plan = evaluation.marketingPlanSnapshot, rule = evaluation.ruleSnapshot;
  try { assertMarketingPlan(plan); }
  catch (error) {
    if (error instanceof RentalMarketingSelectionError) throw new ConflictException(error.message);
    throw error;
  }
  if (!rule || plan.workspaceId !== evaluation.workspaceId || plan.id !== evaluation.planId || plan.version !== evaluation.planVersion
    || evaluation.planName !== (plan.customerDisplayName ?? plan.name) || evaluation.planDescription !== plan.customerDescription
    || rule.id !== evaluation.ruleId || rule.version !== evaluation.ruleVersion
    || evaluation.appliesTo !== "rental" || evaluation.discountType !== rule.action.type
    || !isDeepStrictEqual(plan.rules.find(row => row.id === rule.id), rule)) throw new ConflictException("原单规则营销身份或动作不一致");
}

export function originalMarketingPlan(quote: RentalQuoteSnapshotV1, workspaceId: string): RentalMarketingPlanVersion | undefined {
  const saved = quote.pricingContext?.marketing;
  if (!saved) {
    if (quote.discountEvaluations.some(row => "pricingPolicy" in row && row.pricingPolicy === "single_rule_v1"))
      throw new ConflictException("原报价新营销策略依据缺失，不能按旧策略解释");
    return undefined;
  }
  const rows = quote.discountEvaluations as RentalMarketingQuoteDiscountEvaluation[];
  const basis = saved.qualification;
  if (basis && (marketingQualificationSnapshotError(basis) || basis.timeZone !== quote.pricingContext!.timeZone
    || basis.rentalStartAt !== quote.request.startAt || basis.rentalEndAt !== quote.request.endAt
    || basis.fulfillmentLocationId !== quote.request.fulfillmentLocationId
    || basis.returnLocationId !== (quote.request.returnLocationId ?? quote.request.fulfillmentLocationId)
    || basis.fulfillmentMode !== quote.request.fulfillmentMode || basis.audience !== quote.sourceSnapshot?.audience
    || Date.parse(basis.evaluatedAt) > Date.parse(quote.createdAt))) throw new ConflictException("原营销资格依据与原报价不一致");
  const adopted = rows.filter(row => row.applied);
  if (saved.policy !== "single_rule_v1" || !Number.isSafeInteger(saved.policyRevision) || saved.policyRevision < 1
    || !Array.isArray(saved.rentalLines) || !Array.isArray(saved.dayTypes)
    || saved.rentalLines.length !== quote.request.lines.length || saved.rentalLines.some(line => {
      const request = quote.request.lines.find(row => (row.pricingGroupId ?? row.itemGroupId) === line.id);
      const rate = quote.rateSnapshot.find(row => (row.pricingGroupId ?? row.itemGroupId) === line.id
        && row.unit === line.pricingUnit);
      return !request || request.itemGroupId !== line.itemGroupId || request.pricingGroupId !== line.pricingGroupId
        || !rate || request.quantity !== line.quantity || request.pricingUnit !== undefined && request.pricingUnit !== line.pricingUnit
        || quote.rentalLineAmounts?.[line.id] !== line.amount;
    })
    || rows.some(row => row.pricingPolicy !== saved.policy || row.workspaceId !== workspaceId)
    || adopted.length !== (saved.selected ? 1 : 0)
    || quote.membershipBenefitEvaluations?.some(row => (row.appliesTo === "rental" || row.appliesTo === "service") && row.appliedAmount > 0)
    || saved.baseRentalAmount !== quote.rentalAmount
    || saved.marketingRentalAmount !== roundMoney(quote.rentalAmount - quote.discountAmount))
    throw new ConflictException("原营销策略、唯一采用项或金额依据不完整");
  const selected = adopted[0];
  if (!selected) {
    if (quote.discountAmount !== 0 || quote.appliedDiscountPlanIds.length) throw new ConflictException("原营销无命中结果与金额不一致");
    return undefined;
  }
  const plan = selected.marketingPlanSnapshot, rule = selected.ruleSnapshot;
  assertSingleRuleEvaluation(selected);
  if (!plan || !rule || plan.tenantId !== quote.tenantId || plan.workspaceId !== workspaceId || plan.categoryCode !== quote.categoryCode
    || plan.id !== saved.selected!.planId || plan.version !== saved.selected!.planVersion
    || selected.planId !== plan.id || selected.planVersion !== plan.version
    || rule.id !== saved.selected!.ruleId || rule.version !== saved.selected!.ruleVersion
    || selected.ruleId !== rule.id || selected.ruleVersion !== rule.version
    || !isDeepStrictEqual(plan.rules.find(row => row.id === rule.id), rule)
    || !isDeepStrictEqual(quote.appliedDiscountPlanIds, [plan.id])) throw new ConflictException("原营销方案、规则及采用版本不一致");
  try {
    assertMarketingPlan(plan);
    const chosen = { ...structuredClone(plan), rules: [structuredClone(rule)] };
    const replay = selectMarketingRule([chosen], { tenantId: quote.tenantId, workspaceId, categoryCode: quote.categoryCode,
      membershipEligibility: quote.membershipSnapshot ? "member" : "not_member", customerType: quote.request.customerType,
      bases: { rental: quote.rentalAmount, fulfillment: quote.fulfillmentAmount, service: quote.serviceAmount },
      minimumSpendBase: quote.rentalAmount, itemGroupIds: [...new Set(saved.rentalLines.map(row => row.itemGroupId))],
      pricingGroupIds: [...new Set(saved.rentalLines.flatMap(row => row.pricingGroupId ? [row.pricingGroupId] : []))],
      rentalLines: saved.rentalLines, dayTypes: new Set(saved.dayTypes), rentalStartAt: quote.request.startAt, qualification: basis });
    if (!replay.selected || replay.discountByTarget.rental !== quote.discountAmount
      || !isDeepStrictEqual(replay.rentalLineDiscounts, selected.rentalAllocations)
      || selected.discountAmount !== quote.discountAmount) throw new ConflictException("原营销金额或逐行分摊无法复算");
    return chosen;
  } catch (error) {
    if (error instanceof RentalMarketingSelectionError) throw new ConflictException(error.message);
    throw error;
  }
}
