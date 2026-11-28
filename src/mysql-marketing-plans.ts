/** 多规则营销持久化。复用业务配置仓储的原数据库、品类锁和事务；
 * 只追加发布正文/事件，以修订核对草稿与生命周期，不迁移旧方案或计价。 */
import { ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { sqltag as sql, join } from "@prisma/client/runtime/library";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import type { RequestIdentity } from "@rental-os/platform-server/request-identity";
import type { RentalBusinessConfigurationTransaction, RentalBusinessConfigurationStorage, RentalBusinessConfigurationContacts } from "./business-configuration-storage";
import type { CategoryWriteBinding } from "./configuration-basis";
import type { ChangeRentalMarketingPlanStatusRequest, RentalMarketingPlan, RentalMarketingPlanEvent,
  RentalMarketingPlanHistory, RentalMarketingPlanVersion, SaveRentalMarketingPlanDraftRequest } from "./contracts";
import { assertMarketingPlan, RentalMarketingSelectionError } from "./discount-selection";
import { assertMarketingAuthority, marketingEvent, prepareMarketingDraft, transitionMarketingPlan,
  type RentalMarketingAction, type RentalMarketingScope } from "./marketing-plan";

type PlanRow = Omit<RentalMarketingPlan, "draft" | "published" | "createdAt" | "updatedAt"> & {
  draft: unknown; published: unknown; publishedVersion: string | null; createdAt: Date; updatedAt: Date;
};
const json = (value: unknown): unknown => typeof value === "string" ? JSON.parse(value) : value;
const parseVersion = (value: unknown, row: Pick<PlanRow, "id" | "tenantId" | "workspaceId" | "categoryCode" | "code">): RentalMarketingPlanVersion => {
  let parsed: RentalMarketingPlanVersion;
  try { parsed = json(value) as RentalMarketingPlanVersion; assertMarketingPlan(parsed); }
  catch (error) {
    if (error instanceof SyntaxError || error instanceof RentalMarketingSelectionError)
      throw new ServiceUnavailableException("持久营销版本或规则集合不可用");
    throw error;
  }
  if (parsed.id !== row.id || parsed.tenantId !== row.tenantId || parsed.workspaceId !== row.workspaceId
    || parsed.categoryCode !== row.categoryCode || parsed.code !== row.code) throw new ConflictException("营销版本与方案归属不一致");
  return structuredClone(parsed);
};
function decodePlan(row: PlanRow): RentalMarketingPlan {
  if (!Number.isSafeInteger(row.revision) || row.revision < 1 || !["draft", "enabled", "paused", "ended"].includes(row.status))
    throw new ConflictException("营销方案修订或生命周期无效");
  const draft = row.draft == null ? undefined : parseVersion(row.draft, row);
  const published = row.published == null ? undefined : parseVersion(row.published, row);
  if (draft && draft.status !== "draft" || published && (published.status !== "enabled" || published.version !== row.publishedVersion)
    || Boolean(row.publishedVersion) !== Boolean(published) || row.status !== "draft" && !published
    || row.status === "draft" && (published || !draft)) throw new ConflictException("营销草稿或原发布正文缺失");
  return { id: row.id, tenantId: row.tenantId, workspaceId: row.workspaceId, categoryCode: row.categoryCode,
    code: row.code, status: row.status, revision: row.revision, draft, published,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export class RentalMarketingPlanRepository<Tx extends RentalBusinessConfigurationTransaction> {
  constructor(private readonly database: RentalBusinessConfigurationStorage<Tx>,
    private readonly contacts: RentalBusinessConfigurationContacts<Tx>) {}

  private identity() { return this.contacts.getRequestIdentity() as Partial<RequestIdentity> | undefined; }
  private async currentRows(tx: RentalBusinessConfigurationTransaction, scope: RentalMarketingScope, id?: string): Promise<PlanRow[]> {
    return tx.$queryRaw<PlanRow[]>(sql`
      SELECT p.*, v.snapshot AS published FROM rental_marketing_plans p
      LEFT JOIN rental_marketing_plan_versions v ON v.tenantId = p.tenantId AND v.workspaceId = p.workspaceId
        AND v.planId = p.id AND v.version = p.publishedVersion
      WHERE p.tenantId = ${scope.tenantId} AND p.workspaceId = ${scope.workspaceId}
        AND p.categoryCode = ${scope.categoryCode} ${id === undefined ? sql`` : sql`AND p.id = ${id}`}
      ORDER BY p.updatedAt DESC, p.id ASC`);
  }

  async list(scope: RentalMarketingScope): Promise<RentalMarketingPlan[]> {
    assertMarketingAuthority(this.identity(), scope, "read");
    const identity = requestFingerprint(this.identity());
    if (await this.contacts.resolveWorkspaceId(this.database, scope.tenantId) !== scope.workspaceId)
      throw new ConflictException("营销读取空间已变化");
    const plans = (await this.currentRows(this.database, scope)).map(decodePlan);
    assertMarketingAuthority(this.identity(), scope, "read");
    if (identity !== requestFingerprint(this.identity())) throw new ConflictException("营销读取期间身份已变化");
    return plans;
  }

  async history(scope: RentalMarketingScope, id: string): Promise<RentalMarketingPlanHistory> {
    assertMarketingAuthority(this.identity(), scope, "read");
    const identity = requestFingerprint(this.identity());
    if (await this.contacts.resolveWorkspaceId(this.database, scope.tenantId) !== scope.workspaceId)
      throw new ConflictException("营销读取空间已变化");
    const rows = await this.currentRows(this.database, scope, id);
    if (!rows.length) throw new NotFoundException("营销方案不存在");
    const current = decodePlan(rows[0]);
    const [versions, events] = await Promise.all([
      this.database.$queryRaw<Array<{ snapshot: unknown }>>(sql`SELECT snapshot FROM rental_marketing_plan_versions
        WHERE tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId} AND planId = ${id} ORDER BY createdAt ASC, version ASC`),
      this.database.$queryRaw<Array<Omit<RentalMarketingPlanEvent, "at"> & { createdAt: Date }>>(sql`
        SELECT id, planId, revision, action, publishedVersion, actorUserId, reason, createdAt FROM rental_marketing_plan_events
        WHERE tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId} AND planId = ${id} ORDER BY revision ASC`)
    ]);
    assertMarketingAuthority(this.identity(), scope, "read");
    if (identity !== requestFingerprint(this.identity())) throw new ConflictException("营销历史读取期间身份已变化");
    return { versions: versions.map(row => parseVersion(row.snapshot, current)),
      events: events.map(({ createdAt, ...event }) => ({ ...event, publishedVersion: event.publishedVersion ?? undefined, at: createdAt.toISOString() })) };
  }

  /** 报价已持有原配置事务及空间锁；这里不另开事务或把操作人员管理权限施加给客户报价。 */
  async configuration(tx: Tx, scope: RentalMarketingScope): Promise<RentalMarketingPlan[]> {
    return (await this.currentRows(tx, scope)).map(decodePlan);
  }

  private async validateReferences(tx: Tx, scope: RentalMarketingScope, version: RentalMarketingPlanVersion): Promise<void> {
    const itemIds = [...new Set([...version.applicableItemGroupIds, ...version.rules.flatMap(rule => rule.conditions.applicableItemGroupIds ?? [])])];
    const pricingIds = [...new Set([...(version.applicablePricingGroupIds ?? []), ...version.rules.flatMap(rule => rule.conditions.applicablePricingGroupIds ?? [])])];
    if (itemIds.length) {
      const items = await tx.$queryRaw<Array<{ id: string }>>(sql`SELECT id FROM rental_item_groups
        WHERE tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId} AND id IN (${join(itemIds)}) AND status = 'enabled'`);
      if (items.length !== itemIds.length) throw new ConflictException("营销规则包含当前空间不可用的商品组");
    }
    if (pricingIds.length) {
      const pricing = await tx.$queryRaw<Array<{ id: string }>>(sql`SELECT id FROM rental_pricing_groups
        WHERE tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId} AND id IN (${join(pricingIds)}) AND status = 'enabled'`);
      if (pricing.length !== pricingIds.length) throw new ConflictException("营销规则包含当前空间不可用的定价分组");
    }
  }

  async write(scope: RentalMarketingScope, expectedBinding: CategoryWriteBinding, action: RentalMarketingAction,
    input: SaveRentalMarketingPlanDraftRequest | ChangeRentalMarketingPlanStatusRequest, id?: string): Promise<RentalMarketingPlan> {
    const actorUserId = assertMarketingAuthority(this.identity(), scope, action);
    const identity = requestFingerprint(this.identity());
    if (!expectedBinding?.categoryVersionId || !Number.isSafeInteger(expectedBinding.adoptionRevision))
      throw new ServiceUnavailableException("营销写入缺少当前品类绑定依据");
    if (await this.contacts.resolveWorkspaceId(this.database, scope.tenantId) !== scope.workspaceId)
      throw new ConflictException("营销写入空间已变化");
    return this.database.$transaction(async tx => {
      await this.contacts.lockCategoryBinding(tx, scope.tenantId, scope.workspaceId, expectedBinding, scope.categoryCode);
      assertMarketingAuthority(this.identity(), scope, action);
      if (identity !== requestFingerprint(this.identity())) throw new ConflictException("营销写入期间身份已变化");
      const rows = id ? await this.currentRows(tx, scope, id) : [];
      if (id && !rows.length) throw new NotFoundException("营销方案不存在");
      const current = rows[0] ? decodePlan(rows[0]) : undefined;
      const at = new Date().toISOString();
      const next = action === "save_draft"
        ? prepareMarketingDraft(scope, { ...input as SaveRentalMarketingPlanDraftRequest, id }, current, at)
        : current ? transitionMarketingPlan(current, action, input, at) : undefined;
      if (!next) throw new NotFoundException("营销方案不存在");
      if (action === "save_draft" || action === "publish") await this.validateReferences(tx, scope, action === "save_draft" ? next.draft! : next.published!);
      const duplicate = await tx.$queryRaw<Array<{ id: string }>>(sql`SELECT id FROM rental_marketing_plans
        WHERE tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId} AND code = ${next.code} AND id <> ${next.id}`);
      if (duplicate.length) throw new ConflictException("营销方案编码已存在");
      const draft = next.draft ? JSON.stringify(next.draft) : null;
      if (!current) {
        await tx.$executeRaw(sql`INSERT INTO rental_marketing_plans
          (tenantId, workspaceId, id, categoryCode, code, status, revision, draft, publishedVersion, createdAt, updatedAt)
          VALUES (${scope.tenantId}, ${scope.workspaceId}, ${next.id}, ${scope.categoryCode}, ${next.code}, ${next.status},
            ${next.revision}, ${draft}, NULL, ${new Date(at)}, ${new Date(at)})`);
      } else {
        const count = await tx.$executeRaw(sql`UPDATE rental_marketing_plans SET status = ${next.status}, revision = ${next.revision},
          draft = ${draft}, publishedVersion = ${next.published?.version ?? null}, updatedAt = ${new Date(at)}
          WHERE tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId} AND id = ${next.id} AND revision = ${input.expectedRevision}`);
        if (count !== 1) throw new ConflictException("营销方案修订已变化");
      }
      if (action === "publish") await tx.$executeRaw(sql`INSERT INTO rental_marketing_plan_versions
        (tenantId, workspaceId, planId, version, snapshot, publishedBy, createdAt)
        VALUES (${scope.tenantId}, ${scope.workspaceId}, ${next.id}, ${next.published!.version},
          ${JSON.stringify(next.published)}, ${actorUserId}, ${new Date(at)})`);
      const event = marketingEvent(next, action, actorUserId, input);
      await tx.$executeRaw(sql`INSERT INTO rental_marketing_plan_events
        (tenantId, workspaceId, id, planId, revision, action, publishedVersion, actorUserId, reason, createdAt)
        VALUES (${scope.tenantId}, ${scope.workspaceId}, ${event.id}, ${next.id}, ${next.revision}, ${action},
          ${event.publishedVersion ?? null}, ${actorUserId}, ${event.reason}, ${new Date(at)})`);
      assertMarketingAuthority(this.identity(), scope, action);
      if (identity !== requestFingerprint(this.identity())) throw new ConflictException("营销提交前身份已变化");
      return next;
    });
  }
}
