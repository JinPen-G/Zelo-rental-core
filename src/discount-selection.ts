import {
  RENTAL_SINGLE_MARKETING_RULE_POLICY,
  type RentalMarketingPlanVersion,
  type RentalMarketingRule,
  type RentalDayType,
  type RentalDiscountPlan,
  type RentalDiscountTarget,
  type RentalQuoteDiscountEvaluation
} from "./contracts";
import { roundMoney } from "./money";

/**
 * 原优惠策略的资格/叠加计算，以及显式版本的新单规则营销选择。
 * selectDiscountPlans 保留历史语义；selectMarketingRule 不读取当前配置、不用券、不追加会员金额。
 *
 * 独立成纯函数模块的理由：优惠取舍是**可解释性**要求最强的一段逻辑——
 * 「为什么用的是 A 不是 B」必须能逐条回放。放在 createQuote 里就只能靠端到端报价
 * 反推，任一判据改错都很难定位；抽出来之后每条规则都能单独断言。
 *
 * 这里刻意**不**处理客户优惠券：需求把「系统自动计算的营销规则」与「客户持有的
 * 凭证」定为两个对象，两者的资格、生命周期与审计都不同。券的锁定与预算属 MKT-01B。
 */

/** 每个作用对象的优惠前金额。押金、预授权与异常费用不在其中——它们不可被普通优惠减免。 */
export interface RentalDiscountBases {
  rental: number;
  fulfillment: number;
  service: number;
}

export interface RentalDiscountContext {
  /** 各作用对象的优惠前金额。 */
  bases: RentalDiscountBases;
  /**
   * 最低消费的判定基数（需求 4.4.10：租金优惠的最低消费按「商品租金 + 使用量费用」
   * 的**优惠前**金额计算，不含履约费、增值服务、押金、预授权与异常费用）。
   */
  minimumSpendBase: number;
  customerType: "personal" | "corporate";
  /** 有客户 id 即视为会员场景（member scope 的判据）。 */
  hasCustomer: boolean;
  itemGroupIds: string[];
  pricingGroupIds?: string[];
  /** 每行真实租金，用于限定商品优惠及逐行分摊。id 为定价组/商品的稳定标识。 */
  rentalLines?: Array<{ id: string; itemGroupId: string; pricingGroupId?: string; amount: number }>;
  /** 报价租期覆盖的日期类型集合，与逐单位取价同一日界口径。 */
  dayTypes: Set<string>;
  /** 租期开始时点，用于有效期判定——不是报价创建时刻。 */
  rentalStartAt: string;
  workspaceId: string;
  /** 调用方显式指定的方案。给定时只评估它，落选即报错由调用方处理。 */
  requestedPlanId?: string;
}

const money = roundMoney;

export function allocateDiscount(amount: number, bases: Record<string, number>): Record<string, number> {
  const entries = Object.entries(bases).filter(([, value]) => value > 0).sort(([a], [b]) => a.localeCompare(b));
  const total = entries.reduce((sum, [, value]) => sum + Math.round(value * 100), 0);
  let remaining = Math.min(Math.round(amount * 100), total);
  let remainingBase = total;
  return Object.fromEntries(entries.map(([id, value]) => {
    const cents = Math.round(value * 100);
    const allocated = remainingBase ? Math.min(cents, Math.round(remaining * cents / remainingBase)) : 0;
    remaining -= allocated; remainingBase -= cents;
    return [id, allocated / 100];
  }));
}

function matchingRentalLines(plan: RentalDiscountPlan, ctx: RentalDiscountContext) {
  const lines = ctx.rentalLines ?? (ctx.itemGroupIds.length === 1 ? [{ id: ctx.pricingGroupIds?.[0] ?? ctx.itemGroupIds[0], itemGroupId: ctx.itemGroupIds[0], pricingGroupId: ctx.pricingGroupIds?.[0], amount: ctx.bases.rental }] : []);
  return lines.filter(line => (plan.applicablePricingGroupIds?.length ? Boolean(line.pricingGroupId && plan.applicablePricingGroupIds.includes(line.pricingGroupId)) : !plan.applicableItemGroupIds.length || plan.applicableItemGroupIds.includes(line.itemGroupId)));
}

function eligibleBase(plan: RentalDiscountPlan, ctx: RentalDiscountContext) {
  if (plan.appliesTo !== "rental" || (!ctx.rentalLines && !plan.applicablePricingGroupIds?.length && !plan.applicableItemGroupIds.length)) return ctx.bases[plan.appliesTo];
  return money(matchingRentalLines(plan, ctx).reduce((sum, line) => sum + line.amount, 0));
}

/** 该方案在给定基数上的减免额。上限依次是「最大优惠金额」与「基数本身」（不得优惠成负数）。 */
function amountFor(plan: RentalDiscountPlan, base: number) {
  if (base <= 0) return 0;
  const raw =
    plan.discountType === "percentage"
      ? (base * plan.discountValue) / 100
      : plan.discountValue;
  const capped = plan.maximumDiscount === undefined ? raw : Math.min(raw, plan.maximumDiscount);
  return money(Math.max(0, Math.min(base, capped)));
}

function formulaFor(plan: RentalDiscountPlan, base: number, amount: number) {
  const head =
    plan.discountType === "percentage"
      ? `${base} × ${plan.discountValue}%`
      : plan.discountType === "threshold_amount"
        ? `满 ${plan.thresholdAmount ?? 0} 减 ${plan.discountValue}`
        : `固定减免 ${plan.discountValue}`;
  const cap =
    plan.maximumDiscount !== undefined && amount >= plan.maximumDiscount
      ? `；封顶 ${plan.maximumDiscount}`
      : "";
  return `${head} = ${amount}${cap}`;
}

/**
 * 稳定排序键：先按优先级（数字小者优先），再按编码。
 *
 * 存在的全部理由是**不依赖加载顺序**（需求 4.4.10 点名禁止「按数据库装载顺序或
 * 配置创建顺序随机择一」）。任何比较都要以此收尾，否则同分时结果随重启漂移。
 */
function comparePlans(left: RentalDiscountPlan, right: RentalDiscountPlan) {
  if (left.priority !== right.priority) return left.priority - right.priority;
  return left.code.localeCompare(right.code);
}

/** 资格判定。返回逐条判据，便于报价直接展示「哪一项没过」。 */
function evaluateEligibility(plan: RentalDiscountPlan, ctx: RentalDiscountContext) {
  const eligibility: RentalQuoteDiscountEvaluation["eligibility"] = [];
  let skipReason: RentalQuoteDiscountEvaluation["skipReason"];

  const record = (rule: string, passed: boolean, detail?: string) => {
    eligibility.push({ rule, passed, detail });
    return passed;
  };

  if (!record("status", plan.status === "enabled", `状态 ${plan.status}`)) {
    skipReason = "status_not_enabled";
  }
  const at = new Date(ctx.rentalStartAt).getTime();
  const inPeriod =
    at >= new Date(plan.effectiveFrom).getTime() &&
    (plan.effectiveTo === undefined || at <= new Date(plan.effectiveTo).getTime());
  if (!record("effective_period", inPeriod, `按租期开始时点 ${ctx.rentalStartAt} 判定`) && !skipReason) {
    skipReason = "outside_effective_period";
  }
  if (!record("minimum_spend", ctx.minimumSpendBase >= plan.minimumSpend, `优惠前租金 ${ctx.minimumSpendBase} / 门槛 ${plan.minimumSpend}`) && !skipReason) {
    skipReason = "below_minimum_spend";
  }
  // 满额固定减免的门槛与最低消费是两个判据：前者决定「减多少」的适用性，
  // 后者是活动准入。合并成一个会让「满 500 减 50」在 minimumSpend=0 时对 100 元单也生效。
  if (plan.discountType === "threshold_amount") {
    const threshold = plan.thresholdAmount ?? 0;
    if (!record("threshold", ctx.minimumSpendBase >= threshold, `优惠前租金 ${ctx.minimumSpendBase} / 满减门槛 ${threshold}`) && !skipReason) {
      skipReason = "below_threshold";
    }
  }
  const scopeOk =
    plan.customerScope === "all" ||
    plan.customerScope === ctx.customerType ||
    (plan.customerScope === "member" && ctx.hasCustomer);
  if (!record("customer_scope", scopeOk, `方案范围 ${plan.customerScope}`) && !skipReason) {
    skipReason = "customer_scope_mismatch";
  }
  const pricingScope = plan.applicablePricingGroupIds ?? [];
  const groupOk = pricingScope.length
    ? (ctx.pricingGroupIds ?? []).some((id) => pricingScope.includes(id))
    : !plan.applicableItemGroupIds.length || ctx.itemGroupIds.some((id) => plan.applicableItemGroupIds.includes(id));
  if (!record("pricing_group", groupOk) && !skipReason) skipReason = "item_group_mismatch";
  const dayTypeOk =
    !plan.applicableDayTypes.length || plan.applicableDayTypes.some((dayType) => ctx.dayTypes.has(dayType));
  if (!record("day_type", dayTypeOk) && !skipReason) skipReason = "day_type_mismatch";
  const gross = ctx.bases[plan.appliesTo];
  if (!record("target_amount", gross > 0, `${plan.appliesTo} 优惠前金额 ${gross}`) && !skipReason) {
    skipReason = "no_chargeable_target";
  }

  return { eligibility, skipReason, eligible: !skipReason };
}

/**
 * 选出本次报价实际应用的优惠方案，并给出每个候选的完整评估。
 *
 * 算法（需求 4.4.10）：
 *   1. 逐个判定资格，记录逐条判据；
 *   2. 对合格方案按各自作用对象的**优惠前**金额算出候选减免额；
 *   3. 同一互斥组内取**实际减免最大**者；同额再按优先级、编码——绝不按加载顺序；
 *   4. 跨互斥组按稳定顺序依次尝试叠加，双方都允许叠加才同时应用；
 *   5. 已应用方案按作用对象各自累减，重算实际减免（第 2 步的候选额只用于比大小）。
 */
export function selectDiscountPlans(
  plans: RentalDiscountPlan[],
  ctx: RentalDiscountContext
): { applied: RentalDiscountPlan[]; evaluations: RentalQuoteDiscountEvaluation[]; discountByTarget: RentalDiscountBases; rentalLineDiscounts: Record<string, number> } {
  const scoped = ctx.requestedPlanId ? plans.filter((plan) => plan.id === ctx.requestedPlanId) : plans;
  const judged = scoped.map((plan) => {
    const { eligibility, skipReason, eligible } = evaluateEligibility(plan, ctx);
    const gross = eligibleBase(plan, ctx);
    const candidateAmount = eligible ? amountFor(plan, gross) : 0;
    return { plan, eligibility, skipReason, eligible, gross, candidateAmount };
  });

  // 互斥组内择优。留空的 exclusiveGroup 自成一组，用 plan.id 作组键——
  // 用空串会把所有未配互斥组的方案挤成一组，等于默认全互斥。
  const groups = new Map<string, typeof judged>();
  for (const row of judged) {
    if (!row.eligible) continue;
    const key = row.plan.exclusiveGroup?.trim() || `__self:${row.plan.id}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  const winners = new Set<string>();
  const lostTo = new Map<string, { code: string; amount: number }>();
  for (const bucket of groups.values()) {
    const ranked = [...bucket].sort((left, right) => {
      // 实际减免大者优先；同额再按优先级与编码，保证可复算。
      if (right.candidateAmount !== left.candidateAmount) return right.candidateAmount - left.candidateAmount;
      return comparePlans(left.plan, right.plan);
    });
    const winner = ranked[0];
    winners.add(winner.plan.id);
    for (const loser of ranked.slice(1)) {
      lostTo.set(loser.plan.id, { code: winner.plan.code, amount: winner.candidateAmount });
    }
  }

  // 跨组不允许叠加时也必须按客户实际减免择优，不能又退回按优先级先到先得。
  // 可叠加方案组成一个候选组合；每个不允许叠加的方案各自是单独候选，选择总减免最大者。
  // 这样「优先级 1 减 5 元」不会挡掉「优先级 100 减 60 元」。
  const orderedWinners = judged
    .filter((row) => winners.has(row.plan.id))
    .sort((left, right) => comparePlans(left.plan, right.plan));
  const calculate = (rows: typeof orderedWinners) => {
    const running: RentalDiscountBases = { ...ctx.bases };
    const rentalRemaining = Object.fromEntries((ctx.rentalLines ?? []).map(line => [line.id, line.amount]));
    const rentalLineDiscounts: Record<string, number> = {};
    const discountByTarget: RentalDiscountBases = { rental: 0, fulfillment: 0, service: 0 };
    const actual = new Map<string, { amount: number; base: number; rentalAllocations?: Record<string, number> }>();
    const applied: RentalDiscountPlan[] = [];
    for (const row of rows) {
      const target: RentalDiscountTarget = row.plan.appliesTo;
      const eligibleLines = target === "rental" ? matchingRentalLines(row.plan, ctx) : [];
      const lineBases = Object.fromEntries(eligibleLines.map(line => [line.id, rentalRemaining[line.id] ?? line.amount]));
      const base = target === "rental" && ctx.rentalLines ? money(Object.values(lineBases).reduce((sum, value) => sum + value, 0)) : Math.min(running[target], row.gross);
      const amount = amountFor(row.plan, base);
      const rentalAllocations = target === "rental" && ctx.rentalLines ? allocateDiscount(amount, lineBases) : undefined;
      actual.set(row.plan.id, { amount, base, rentalAllocations });
      for (const [id, discount] of Object.entries(rentalAllocations ?? {})) {
        rentalRemaining[id] = money(rentalRemaining[id] - discount);
        rentalLineDiscounts[id] = money((rentalLineDiscounts[id] ?? 0) + discount);
      }
      if (amount <= 0) continue;
      running[target] = money(base - amount);
      discountByTarget[target] = money(discountByTarget[target] + amount);
      applied.push(row.plan);
    }
    const total = money(discountByTarget.rental + discountByTarget.fulfillment + discountByTarget.service);
    return { rows, applied, actual, discountByTarget, rentalLineDiscounts, total };
  };
  const stackable = orderedWinners.filter((row) => row.plan.stackableWithOtherPlans);
  const options = [
    ...(stackable.length ? [calculate(stackable)] : []),
    ...orderedWinners.filter((row) => !row.plan.stackableWithOtherPlans).map((row) => calculate([row]))
  ].sort((left, right) => {
    if (right.total !== left.total) return right.total - left.total;
    const leftPlan = left.applied[0] ?? left.rows[0]?.plan;
    const rightPlan = right.applied[0] ?? right.rows[0]?.plan;
    if (!leftPlan) return 1;
    if (!rightPlan) return -1;
    return comparePlans(leftPlan, rightPlan);
  });
  const selected = options[0] ?? calculate([]);
  const { applied, actual, discountByTarget } = selected;
  const selectedIds = new Set(selected.rows.map((row) => row.plan.id));
  const blockingCode = applied[0]?.code ?? selected.rows[0]?.plan.code;
  const blocked = new Map<string, string>();
  for (const row of orderedWinners) {
    if (!selectedIds.has(row.plan.id) && blockingCode) blocked.set(row.plan.id, blockingCode);
  }

  const evaluations: RentalQuoteDiscountEvaluation[] = judged
    .sort((left, right) => comparePlans(left.plan, right.plan))
    .map((row) => {
      const hit = actual.get(row.plan.id);
      const isApplied = applied.some((plan) => plan.id === row.plan.id);
      const base = hit?.base ?? row.gross;
      const amount = hit?.amount ?? 0;
      let skipReason = row.skipReason;
      let skipDetail: string | undefined;
      if (!isApplied && !skipReason) {
        const lost = lostTo.get(row.plan.id);
        const blockedBy = blocked.get(row.plan.id);
        if (lost) {
          skipReason = "exclusive_group_lost";
          skipDetail = `同一互斥组内 ${lost.code} 减免 ${lost.amount} 更多（本方案 ${row.candidateAmount}）`;
        } else if (blockedBy) {
          skipReason = "not_stackable_with_applied";
          skipDetail = `与已应用方案 ${blockedBy} 不可叠加`;
        } else {
          skipReason = "zero_discount";
          skipDetail = `在基数 ${base} 上算不出减免`;
        }
      }
      return {
        planSnapshot: structuredClone(row.plan),
        planId: row.plan.id,
        planCode: row.plan.code,
        planName: row.plan.name,
        planVersion: row.plan.version,
        workspaceId: ctx.workspaceId,
        appliesTo: row.plan.appliesTo,
        discountType: row.plan.discountType,
        priority: row.plan.priority,
        exclusiveGroup: row.plan.exclusiveGroup,
        stackableWithOtherPlans: row.plan.stackableWithOtherPlans,
        stackableWithCoupon: row.plan.stackableWithCoupon,
        applied: isApplied,
        skipReason,
        skipDetail,
        eligibility: row.eligibility,
        grossAmount: row.gross,
        base,
        formula: formulaFor(row.plan, base, amount),
        candidateAmount: row.candidateAmount,
        discountAmount: amount,
        rentalAllocations: hit?.rentalAllocations,
        maximumDiscount: row.plan.maximumDiscount,
        capped: row.plan.maximumDiscount !== undefined && amount >= row.plan.maximumDiscount
      };
    });

  return { applied, evaluations, discountByTarget, rentalLineDiscounts: selected.rentalLineDiscounts };
}

/** 区分确定无命中与资料不可用。正式 HTTP 接入须将 unavailable 映射为不可用，
 * requested_plan_unavailable 保持原指定方案 Conflict；不能捕获后回基础价。 */
export class RentalMarketingSelectionError extends Error {
  constructor(public readonly code: "unavailable" | "requested_plan_unavailable", message: string) {
    super(message);
    this.name = "RentalMarketingSelectionError";
  }
}

export interface RentalMarketingSelection {
  pricingPolicy: typeof RENTAL_SINGLE_MARKETING_RULE_POLICY;
  selected?: { planId: string; planVersion: string; ruleId: string; ruleVersion: string };
  evaluations: RentalQuoteDiscountEvaluation[];
  baseRentalAmount: number;
  marketingRentalAmount: number;
  discountByTarget: RentalDiscountBases;
  rentalLineDiscounts: Record<string, number>;
}

export interface RentalMarketingContext extends Omit<RentalDiscountContext, "hasCustomer"> {
  tenantId: string;
  categoryCode: string;
  /** 由原会员域提供；无法读取不等于确认不是会员。 */
  membershipEligibility: "member" | "not_member" | "unavailable";
}

function unavailable(message: string): never { throw new RentalMarketingSelectionError("unavailable", message); }
const validAmount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
  && value >= 0 && Number.isSafeInteger(Math.round(value * 100));
const validText = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());
const validDate = (value: unknown): value is string => validText(value) && Number.isFinite(Date.parse(value));
const validIds = (value: unknown): value is string[] => Array.isArray(value)
  && value.every(validText) && new Set(value).size === value.length;
const customerScopes = ["all", "personal", "corporate", "member"];
const dayTypes: readonly RentalDayType[] = ["workday", "weekend", "statutory_holiday", "makeup_workday", "tenant_special"];
const validDayTypes = (value: unknown): boolean => validIds(value) && value.every(day => dayTypes.some(known => known === day));
const stableCompare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

/** 对受信仓储输入仍做结构检查：坏版本/未知动作不是一条正常的落选规则。 */
function assertMarketingPlan(plan: RentalMarketingPlanVersion): void {
  if (!plan || plan.pricingPolicy !== RENTAL_SINGLE_MARKETING_RULE_POLICY || plan.appliesTo !== "rental"
    || ![plan.id, plan.tenantId, plan.workspaceId, plan.categoryCode, plan.code, plan.name, plan.version].every(validText)
    || !["draft", "enabled", "disabled"].includes(plan.status)
    || !validAmount(plan.minimumSpend) || !Number.isSafeInteger(plan.priority) || plan.priority < 0
    || !customerScopes.includes(plan.customerScope) || !validIds(plan.applicableItemGroupIds)
    || plan.applicablePricingGroupIds !== undefined && !validIds(plan.applicablePricingGroupIds)
    || !validDayTypes(plan.applicableDayTypes) || !validDate(plan.effectiveFrom)
    || plan.effectiveTo !== undefined && (!validDate(plan.effectiveTo) || Date.parse(plan.effectiveTo) <= Date.parse(plan.effectiveFrom))
    || !Array.isArray(plan.rules) || !plan.rules.length || new Set(plan.rules.map(rule => rule?.id)).size !== plan.rules.length) {
    unavailable("营销方案版本或完整规则集合不可用");
  }
  for (const rule of plan.rules) {
    const condition = rule?.conditions, action = rule?.action;
    if (!rule || ![rule.id, rule.version, rule.name].every(validText) || !["enabled", "disabled"].includes(rule.status)
      || !Number.isSafeInteger(rule.priority) || rule.priority < 0 || !condition || Array.isArray(condition)
      || Object.keys(condition).some(key => !["minimumSpend", "customerScope", "applicableItemGroupIds",
        "applicablePricingGroupIds", "applicableDayTypes", "effectiveFrom", "effectiveTo"].includes(key))
      || !action || !["percentage", "fixed_amount", "threshold_amount"].includes(action.type)
      || Object.keys(action).some(key => !["type", "value", "thresholdAmount", "maximumDiscount"].includes(key))
      || !validAmount(action.value) || action.value <= 0 || action.type === "percentage" && action.value > 100
      || action.maximumDiscount !== undefined && (!validAmount(action.maximumDiscount) || action.maximumDiscount <= 0)
      || action.type === "threshold_amount" && (!validAmount(action.thresholdAmount) || action.thresholdAmount <= 0)
      || action.type !== "threshold_amount" && action.thresholdAmount !== undefined
      || condition.minimumSpend !== undefined && !validAmount(condition.minimumSpend)
      || condition.customerScope !== undefined && !customerScopes.includes(condition.customerScope)
      || condition.applicableItemGroupIds !== undefined && !validIds(condition.applicableItemGroupIds)
      || condition.applicablePricingGroupIds !== undefined && !validIds(condition.applicablePricingGroupIds)
      || condition.applicableDayTypes !== undefined && !validDayTypes(condition.applicableDayTypes)
      || condition.effectiveFrom !== undefined && !validDate(condition.effectiveFrom)
      || condition.effectiveTo !== undefined && !validDate(condition.effectiveTo)
      || condition.effectiveFrom !== undefined && condition.effectiveTo !== undefined
        && Date.parse(condition.effectiveTo) <= Date.parse(condition.effectiveFrom)) {
      unavailable("营销规则条件、动作或版本不可用");
    }
  }
}

/** 仅复用原资格判据，不把规则条件合并覆盖公共条件。两者必须各自通过。 */
function ruleAsDiscountPlan(plan: RentalMarketingPlanVersion, rule: RentalMarketingRule, common: boolean): RentalDiscountPlan {
  return { ...plan, ...(common ? {} : {
    minimumSpend: rule.conditions.minimumSpend ?? 0,
    customerScope: rule.conditions.customerScope ?? "all",
    applicableItemGroupIds: rule.conditions.applicableItemGroupIds ?? [],
    applicablePricingGroupIds: rule.conditions.applicablePricingGroupIds ?? [],
    applicableDayTypes: rule.conditions.applicableDayTypes ?? [],
    effectiveFrom: rule.conditions.effectiveFrom ?? plan.effectiveFrom,
    effectiveTo: rule.conditions.effectiveTo ?? plan.effectiveTo
  }), discountType: common ? "fixed_amount" : rule.action.type,
    discountValue: rule.action.value, thresholdAmount: common ? undefined : rule.action.thresholdAmount,
    maximumDiscount: rule.action.maximumDiscount, stackableWithOtherPlans: false, stackableWithCoupon: true };
}

/** 新策略的无副作用计算入口。已确定的首个切片只接一个完整租金行及原三种优惠动作。
 * 多行和固定租价单位尚未核定时明确拒绝；不自行按行挑选或将 fixed_amount 当固定租价。
 * 每条规则均从同一基础租金计算，用券不参与选择；后续动作须传原快照中的选中规则。 */
export function selectMarketingRule(plans: RentalMarketingPlanVersion[], context: RentalMarketingContext): RentalMarketingSelection {
  if (!context || !validText(context.tenantId) || !validText(context.categoryCode)
    || !["member", "not_member", "unavailable"].includes(context.membershipEligibility)) unavailable("营销身份或资格来源不可用");
  const ctx: RentalDiscountContext = { ...context, hasCustomer: context.membershipEligibility === "member" };
  if (!ctx || !validText(ctx.workspaceId) || !validDate(ctx.rentalStartAt) || !ctx.bases
    || !Object.values(ctx.bases).every(validAmount) || !validAmount(ctx.bases.rental)
    || !validAmount(ctx.bases.fulfillment) || !validAmount(ctx.bases.service)
    || !validAmount(ctx.minimumSpendBase) || money(ctx.minimumSpendBase) !== money(ctx.bases.rental)
    || !["personal", "corporate"].includes(ctx.customerType) || typeof ctx.hasCustomer !== "boolean"
    || !(ctx.dayTypes instanceof Set) || !ctx.dayTypes.size || !validDayTypes([...ctx.dayTypes])
    || !validIds(ctx.itemGroupIds) || ctx.pricingGroupIds !== undefined && !validIds(ctx.pricingGroupIds)
    || ctx.requestedPlanId !== undefined && !validText(ctx.requestedPlanId)) unavailable("营销报价的受信输入或金额依据不可用");
  const line = ctx.rentalLines?.[0];
  if (!Array.isArray(ctx.rentalLines) || ctx.rentalLines.length !== 1 || !line || !validText(line.id)
    || !validText(line.itemGroupId) || !validAmount(line.amount) || money(line.amount) !== money(ctx.bases.rental)
    || ctx.itemGroupIds.length !== 1 || ctx.itemGroupIds[0] !== line.itemGroupId
    || line.pricingGroupId !== undefined && (!validText(line.pricingGroupId)
      || ctx.pricingGroupIds?.length !== 1 || ctx.pricingGroupIds[0] !== line.pricingGroupId)
    || line.pricingGroupId === undefined && Boolean(ctx.pricingGroupIds?.length)) {
    unavailable("当前单规则营销计算需要一个完整租金行；多行作用范围尚未接入");
  }
  if (!Array.isArray(plans)) unavailable("营销方案读取结果不可用");
  // 先验证完整输入，避免把读取错误/重复版本伪装成自动无命中。
  plans.forEach(assertMarketingPlan);
  if (plans.some(plan => plan.tenantId !== context.tenantId || plan.workspaceId !== context.workspaceId
    || plan.categoryCode !== context.categoryCode)) unavailable("营销方案不属于本次报价的租户、空间或品类");
  if (new Set(plans.map(plan => plan.id)).size !== plans.length) unavailable("营销方案含重复身份或多个活动版本");
  const scoped = ctx.requestedPlanId ? plans.filter(plan => plan.id === ctx.requestedPlanId) : plans;
  if (context.membershipEligibility === "unavailable" && scoped.some(plan => plan.customerScope === "member"
    || plan.rules.some(rule => rule.conditions.customerScope === "member"))) unavailable("营销规则所需会员资格不可用");
  const judged = scoped.flatMap(plan => plan.rules.map(rule => {
    const common = evaluateEligibility(ruleAsDiscountPlan(plan, rule, true), ctx);
    const effective = ruleAsDiscountPlan(plan, rule, false);
    const individual = evaluateEligibility(effective, ctx);
    // 新合同的商品与定价组限制同时成立，保留旧策略自身的历史判据不变。
    const itemScopeMatches = (ids: readonly string[] | undefined) => !ids?.length || ids.includes(line.itemGroupId);
    const commonItemScope = itemScopeMatches(plan.applicableItemGroupIds);
    const ruleItemScope = itemScopeMatches(rule.conditions.applicableItemGroupIds);
    const skipReason = common.skipReason ?? (!commonItemScope || !ruleItemScope ? "item_group_mismatch" as const : undefined)
      ?? (rule.status !== "enabled" ? "rule_not_enabled" as const : individual.skipReason);
    const candidateAmount = skipReason ? 0 : amountFor(effective, line.amount);
    return { plan, rule, effective, skipReason, candidateAmount,
      eligibility: [...common.eligibility.map(row => ({ ...row, rule: `plan.${row.rule}` })),
        { rule: "plan.item_group", passed: commonItemScope }, { rule: "rule.item_group", passed: ruleItemScope },
        { rule: "rule.status", passed: rule.status === "enabled", detail: `状态 ${rule.status}` },
        ...individual.eligibility.map(row => ({ ...row, rule: `rule.${row.rule}` }))] };
  }));
  const compare = (a: typeof judged[number], b: typeof judged[number]) => b.candidateAmount - a.candidateAmount
    || a.rule.priority - b.rule.priority || a.plan.priority - b.plan.priority
    || stableCompare(a.plan.id, b.plan.id) || stableCompare(a.rule.id, b.rule.id);
  const winner = judged.filter(row => !row.skipReason && row.candidateAmount > 0).sort(compare)[0];
  if (ctx.requestedPlanId && !winner) throw new RentalMarketingSelectionError("requested_plan_unavailable", "指定营销方案不满足本次报价条件");
  const discount = winner?.candidateAmount ?? 0;
  const allocations = winner ? allocateDiscount(discount, { [line.id]: line.amount }) : {};
  return {
    pricingPolicy: RENTAL_SINGLE_MARKETING_RULE_POLICY,
    selected: winner ? { planId: winner.plan.id, planVersion: winner.plan.version, ruleId: winner.rule.id, ruleVersion: winner.rule.version } : undefined,
    baseRentalAmount: money(ctx.bases.rental), marketingRentalAmount: money(ctx.bases.rental - discount),
    discountByTarget: { rental: discount, fulfillment: 0, service: 0 }, rentalLineDiscounts: allocations,
    evaluations: judged.sort((a, b) => stableCompare(a.plan.id, b.plan.id) || stableCompare(a.rule.id, b.rule.id)).map(row => {
      const applied = row === winner;
      const reason = applied ? undefined : row.skipReason ?? (row.candidateAmount <= 0 ? "zero_discount"
        : row.candidateAmount === winner?.candidateAmount ? "same_price_lower_priority" : "lower_marketing_price_available");
      return {
        pricingPolicy: RENTAL_SINGLE_MARKETING_RULE_POLICY, marketingPlanSnapshot: structuredClone(row.plan),
        ruleSnapshot: structuredClone(row.rule), ruleId: row.rule.id, ruleVersion: row.rule.version,
        planId: row.plan.id, planCode: row.plan.code, planName: row.plan.name, planVersion: row.plan.version,
        workspaceId: ctx.workspaceId, appliesTo: "rental", discountType: row.rule.action.type,
        priority: row.rule.priority, stackableWithOtherPlans: false, stackableWithCoupon: true,
        applied, skipReason: reason,
        skipDetail: !applied && !row.skipReason && winner ? `选用 ${winner.plan.code}/${winner.rule.id}，营销后租金 ${money(ctx.bases.rental - discount)}` : undefined,
        eligibility: row.eligibility, grossAmount: money(line.amount), base: money(line.amount),
        comparisonRentalAmount: money(ctx.bases.rental), candidateRentalAmount: money(ctx.bases.rental - row.candidateAmount),
        formula: formulaFor(row.effective, line.amount, row.candidateAmount), candidateAmount: row.candidateAmount,
        discountAmount: applied ? row.candidateAmount : 0, rentalAllocations: applied ? { ...allocations } : undefined,
        maximumDiscount: row.rule.action.maximumDiscount,
        capped: applied && row.rule.action.maximumDiscount !== undefined && row.candidateAmount >= row.rule.action.maximumDiscount
      };
    })
  };
}
