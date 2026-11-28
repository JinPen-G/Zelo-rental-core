/** 空间营销策略的显式切换与原操作读取。沿原身份、配置锁、幂等账和调用方事务；
 * 不转换旧方案、不改历史报价，不把没有观察到策略等同于已核legacy。 */
import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { sqltag as sql } from "@prisma/client/runtime/library";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import type { RequestIdentity } from "@rental-os/platform-server/request-identity";
import { RENTAL_MARKETING_PRICING_POLICIES, type ChangeRentalMarketingPricingPolicyRequest,
  type RentalMarketingPricingPolicy, type RentalMarketingPricingPolicyReceipt } from "./contracts";
import type { RentalBusinessConfigurationTransaction, RentalBusinessConfigurationStorage,
  RentalBusinessConfigurationContacts } from "./business-configuration-storage";
import type { CategoryWriteBinding } from "./configuration-basis";
import { assertMarketingAuthority, type RentalMarketingScope, type RentalMarketingOperationScope } from "./marketing-plan";
import { RentalIdempotencyRepository, assertSameRequest } from "./mysql-idempotency";
import { RentalIdempotentActionService } from "./mysql-idempotent-actions";
import { readRentalOriginalReceipt } from "./mysql-business-fence";
import { executeMarketingCommand } from "./marketing-command";

type Row = Omit<RentalMarketingPricingPolicy, "updatedAt"> & { updatedAt: Date };
type Original = { actorUserId: string; operationId: string; result: RentalMarketingPricingPolicy };
const action = "marketing_policy.change";
const operationKey = (scope: RentalMarketingOperationScope, actorUserId: string, operationId: string) =>
  requestFingerprint({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, actorUserId, operationId });
const validateOperation = (operationId: string) => {
  if (typeof operationId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(operationId))
    throw new BadRequestException("营销策略原操作号无效");
};

export function assertMarketingPricingPolicy(value: RentalMarketingPricingPolicy, scope: RentalMarketingOperationScope): void {
  if (!value || value.tenantId !== scope.tenantId || value.workspaceId !== scope.workspaceId
    || !RENTAL_MARKETING_PRICING_POLICIES.includes(value.policy) || !Number.isSafeInteger(value.revision) || value.revision < 0
    || value.revision === 0 && (value.policy !== "legacy" || value.updatedAt !== undefined || value.updatedBy !== undefined)
    || value.revision > 0 && (typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))
      || typeof value.updatedBy !== "string" || !value.updatedBy.trim())) throw new ConflictException("营销策略版本或空间依据无效");
}

export class RentalMarketingPricingPolicyRepository<Tx extends RentalBusinessConfigurationTransaction> {
  constructor(private readonly database: RentalBusinessConfigurationStorage<Tx>,
    private readonly contacts: RentalBusinessConfigurationContacts<Tx>) {}

  private identity() { return this.contacts.getRequestIdentity() as Partial<RequestIdentity> | undefined; }
  private async current(scope: RentalMarketingOperationScope, fingerprint: string, permission: "read" | "publish") {
    assertMarketingAuthority(this.identity(), scope, permission);
    if (await this.contacts.resolveWorkspaceId(this.database, scope.tenantId) !== scope.workspaceId
      || fingerprint !== requestFingerprint(this.identity())) throw new ConflictException("营销策略读取或提交期间身份、空间已变化");
  }
  private operations(scope: RentalMarketingOperationScope) {
    const records = new RentalIdempotencyRepository<Tx>(this.database, { workspaceId: async (tenantId, tx) => {
      const workspaceId = await this.contacts.resolveWorkspaceId(tx ?? this.database, tenantId);
      if (tenantId !== scope.tenantId || workspaceId !== scope.workspaceId) throw new ConflictException("营销策略原操作空间变化");
      return workspaceId;
    } });
    return { records, actions: new RentalIdempotentActionService<Tx>(this.database, records) };
  }

  /** 报价持有原配置锁时读取，不附加营运发布权限。缺表/读取错误继续抛出。 */
  async configuration(tx: RentalBusinessConfigurationTransaction, scope: RentalMarketingOperationScope): Promise<RentalMarketingPricingPolicy> {
    const rows = await tx.$queryRaw<Row[]>(sql`SELECT tenantId, workspaceId, policy, revision, updatedAt, updatedBy
      FROM rental_marketing_pricing_policies WHERE tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId}`);
    if (rows.length > 1) throw new ConflictException("营销空间策略不唯一");
    const row = rows[0];
    if (row && (!(row.updatedAt instanceof Date) || !Number.isFinite(row.updatedAt.getTime())))
      throw new ConflictException("营销策略持久时点不可用");
    const result: RentalMarketingPricingPolicy = row ? { ...row, updatedAt: row.updatedAt.toISOString() }
      : { tenantId: scope.tenantId, workspaceId: scope.workspaceId, policy: "legacy", revision: 0 };
    assertMarketingPricingPolicy(result, scope);
    return result;
  }
  async read(scope: RentalMarketingOperationScope) {
    scope = structuredClone(scope);
    const fingerprint = requestFingerprint(this.identity());
    await this.current(scope, fingerprint, "read");
    const result = await this.configuration(this.database, scope);
    await this.current(scope, fingerprint, "read");
    return result;
  }

  private decode(value: unknown, scope: RentalMarketingOperationScope, actorUserId: string, operationId: string): Original {
    const original = value as Original;
    if (!original || original.actorUserId !== actorUserId || original.operationId !== operationId)
      throw new ConflictException("营销策略原收据与本人原操作不一致");
    assertMarketingPricingPolicy(original.result, scope);
    if (original.result.revision < 1 || original.result.updatedBy !== actorUserId) throw new ConflictException("营销策略原收据缺少提交事实");
    return structuredClone(original);
  }
  async original(scope: RentalMarketingOperationScope, operationId: string): Promise<RentalMarketingPricingPolicyReceipt> {
    scope = structuredClone(scope);
    validateOperation(operationId);
    const actorUserId = assertMarketingAuthority(this.identity(), scope, "read"), fingerprint = requestFingerprint(this.identity());
    return readRentalOriginalReceipt(scope.tenantId, null, async () => {
      await this.current(scope, fingerprint, "read");
      const hit = await this.operations(scope).records.find(scope.tenantId, action, operationKey(scope, actorUserId, operationId));
      if (hit && (hit.orderId !== null || hit.status !== "succeeded")) throw new ConflictException("营销策略原收据状态无效");
      const result = hit ? this.decode(hit.response, scope, actorUserId, operationId).result : undefined;
      await this.current(scope, fingerprint, "read");
      return result ? { status: "committed", operationId, result } : { status: "unknown" };
    });
  }

  async change(scope: RentalMarketingScope, binding: CategoryWriteBinding,
    input: ChangeRentalMarketingPricingPolicyRequest): Promise<RentalMarketingPricingPolicy> {
    scope = structuredClone(scope); binding = structuredClone(binding); input = structuredClone(input);
    const operationScope = { tenantId: scope.tenantId, workspaceId: scope.workspaceId };
    if (!binding?.categoryVersionId || !Number.isSafeInteger(binding.adoptionRevision) || binding.adoptionRevision < 0)
      throw new ServiceUnavailableException("营销策略切换缺少当前品类绑定依据");
    validateOperation(input.operationId);
    if (!RENTAL_MARKETING_PRICING_POLICIES.includes(input.policy) || !Number.isSafeInteger(input.expectedRevision)
      || input.expectedRevision < 0 || typeof input.changeReason !== "string" || !input.changeReason.trim()
      || input.changeReason.length > 500) throw new BadRequestException("营销策略、原修订或变更原因无效");
    const actorUserId = assertMarketingAuthority(this.identity(), scope, "publish"), fingerprint = requestFingerprint(this.identity());
    await this.current(scope, fingerprint, "publish");
    const key = operationKey(operationScope, actorUserId, input.operationId);
    const { records, actions } = this.operations(operationScope), request = { ...operationScope, actorUserId, input };
    const original = await executeMarketingCommand<Original, Tx>(actions, input.operationId, { tenantId: scope.tenantId, action, key, fallbackKey: key,
      request, replay: async value => {
        await this.current(scope, fingerprint, "publish");
        return this.decode(value, scope, actorUserId, input.operationId);
      }, run: async tx => {
        await this.contacts.lockCategoryBinding(tx, scope.tenantId, scope.workspaceId, binding, scope.categoryCode);
        assertMarketingAuthority(this.identity(), scope, "publish");
        if (fingerprint !== requestFingerprint(this.identity())) throw new ConflictException("营销策略写入身份已变化");
        // 等空间锁时同键可能已经提交；先识别原操作，不能让新修订检查遮住原收据。
        const committed = await records.find(scope.tenantId, action, key, tx);
        if (committed) {
          assertSameRequest(committed, requestFingerprint(request));
          return this.decode(committed.response, scope, actorUserId, input.operationId);
        }
        const before = await this.configuration(tx, operationScope);
        if (before.revision !== input.expectedRevision) throw new ConflictException("营销策略已变化，请重读后确认");
        if (before.policy === input.policy) throw new ConflictException("当前空间已使用所选营销策略");
        const result: RentalMarketingPricingPolicy = { ...operationScope, policy: input.policy,
          revision: before.revision + 1, updatedAt: new Date().toISOString(), updatedBy: actorUserId };
        if (before.revision === 0) await tx.$executeRaw(sql`INSERT INTO rental_marketing_pricing_policies
          (tenantId, workspaceId, policy, revision, updatedAt, updatedBy)
          VALUES (${scope.tenantId}, ${scope.workspaceId}, ${result.policy}, ${result.revision}, ${new Date(result.updatedAt!)}, ${actorUserId})`);
        else {
          const count = await tx.$executeRaw(sql`UPDATE rental_marketing_pricing_policies SET policy = ${result.policy},
            revision = ${result.revision}, updatedAt = ${new Date(result.updatedAt!)}, updatedBy = ${actorUserId}
            WHERE tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId} AND revision = ${before.revision}`);
          if (count !== 1) throw new ConflictException("营销策略修订已变化");
        }
        await tx.$executeRaw(sql`INSERT INTO rental_marketing_pricing_policy_events
          (tenantId, workspaceId, revision, previousPolicy, policy, operationId, actorUserId, reason, createdAt)
          VALUES (${scope.tenantId}, ${scope.workspaceId}, ${result.revision}, ${before.policy}, ${result.policy},
            ${input.operationId}, ${actorUserId}, ${input.changeReason.trim()}, ${new Date(result.updatedAt!)})`);
        assertMarketingAuthority(this.identity(), scope, "publish");
        if (fingerprint !== requestFingerprint(this.identity())) throw new ConflictException("营销策略提交前身份已变化");
        return { actorUserId, operationId: input.operationId, result };
      } });
    return original.result;
  }
}
