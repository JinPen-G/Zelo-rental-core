/** 业务拒绝与成功共用原幂等账。局部写入先回滚保存点，拒绝结论提交后方可确认；
 * 连接/提交失败仍为unknown，不从暂时查无收据推断可以换键。 */
import { ConflictException, HttpException } from "@nestjs/common";
import { sqltag as sql } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import type { RentalMarketingOperationRejection } from "./contracts";
import type { RentalBusinessTenantTransaction } from "./mysql-business-fence";
import type { IdempotentActionInput, RentalIdempotentActionService } from "./mysql-idempotent-actions";

interface RejectedCommand {
  format: "rental-marketing-rejected-1";
  tenantId: string; workspaceId: string; actorUserId: string; action: string;
  receipt: RentalMarketingOperationRejection;
}
export function readMarketingRejection(value: unknown, expected: Pick<RejectedCommand, "tenantId" | "workspaceId" | "actorUserId" | "action">,
  operationId: string): RentalMarketingOperationRejection | undefined {
  if (!value || typeof value !== "object" || !("format" in value) || value.format !== "rental-marketing-rejected-1") return undefined;
  const saved = value as RejectedCommand, receipt = saved.receipt;
  const publicAction = expected.action === "marketing_policy.change" ? "change_policy" : expected.action.slice("marketing_plan.".length);
  if (saved.tenantId !== expected.tenantId || saved.workspaceId !== expected.workspaceId || saved.actorUserId !== expected.actorUserId
    || saved.action !== expected.action || !receipt || receipt.status !== "rejected" || receipt.operationId !== operationId
    || receipt.action !== publicAction || !Number.isSafeInteger(receipt.expectedRevision) || receipt.expectedRevision < 0
    || typeof receipt.message !== "string" || !receipt.message || receipt.planId !== undefined && (typeof receipt.planId !== "string" || !receipt.planId))
    throw new ConflictException("营销拒绝收据与本人原操作不一致");
  return structuredClone(receipt);
}

export async function executeMarketingCommand<Result, Tx extends RentalBusinessTenantTransaction & Pick<Prisma.TransactionClient, "$executeRaw">>(
  actions: RentalIdempotentActionService<Tx>, operationId: string, input: IdempotentActionInput<Result, Tx>, assertCurrent: () => Promise<void>
): Promise<Result> {
  const request = input.request as { tenantId: string; workspaceId: string; actorUserId: string; id?: string | null; input: { expectedRevision: number } };
  const scope = { tenantId: input.tenantId, workspaceId: request.workspaceId, actorUserId: request.actorUserId, action: input.action };
  const publicAction = input.action === "marketing_policy.change" ? "change_policy" : input.action.slice("marketing_plan.".length) as RentalMarketingOperationRejection["action"];
  const result = await actions.execute<Result | RejectedCommand>({ ...input, replay: async response => {
      await assertCurrent(); const rejection = readMarketingRejection(response, scope, operationId);
      if (rejection) {
        if (rejection.planId !== (request.id ?? undefined) || rejection.expectedRevision !== request.input.expectedRevision)
          throw new ConflictException("营销拒绝收据的原对象或修订不一致");
        return response as RejectedCommand;
      }
      return input.replay(response);
    }, run: async tx => {
      await tx.$executeRaw(sql`SAVEPOINT rental_marketing_command`);
      try {
        const value = await input.run(tx);
        await tx.$executeRaw(sql`RELEASE SAVEPOINT rental_marketing_command`);
        return value;
      }
      catch (error) {
        if (!(error instanceof HttpException) || ![400, 403, 404, 409].includes(error.getStatus())) throw error;
        await tx.$executeRaw(sql`ROLLBACK TO SAVEPOINT rental_marketing_command`);
        await tx.$executeRaw(sql`RELEASE SAVEPOINT rental_marketing_command`);
        return { format: "rental-marketing-rejected-1", ...scope,
          receipt: { status: "rejected", operationId, action: publicAction, planId: request.id ?? undefined,
            expectedRevision: request.input.expectedRevision, message: error.message } };
      }
    } });
  await assertCurrent();
  const rejected = readMarketingRejection(result, scope, operationId);
  if (rejected) throw new ConflictException({ code: "rental_marketing_write_rejected", operationId, message: rejected.message });
  return result as Result;
}
