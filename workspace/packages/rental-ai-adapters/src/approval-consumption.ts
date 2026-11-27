/** Original Rental order participant; generic C05 rows and fencing stay public. */
import { ApprovalConsumptionPersistenceRepository, AiApprovalConsumptionRepositoryError } from '@rental-os/ai-native-server/runtime/public-approval-persistence';
import type { Prisma } from '@prisma/client';
import type { ApprovedOrderBinding, ApprovedOrderTransaction } from '@rental-os/rental-core/approved-order-ports';
import type { AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import type { HeldApprovalConsumptionInput } from '@rental-os/ai-native-server/runtime/public-approval-persistence';
export interface AiApprovedOrderAuthority {
  resolve(input: Readonly<HeldApprovalConsumptionInput>, binding: Readonly<ApprovedOrderBinding>,
    action: 'execute' | 'replay', tx?: Prisma.TransactionClient): Promise<AiExecutionContext>;
}
export { AiApprovalConsumptionRepositoryError } from '@rental-os/ai-native-server/runtime/public-approval-persistence';

export class PrismaAiApprovalConsumptionRepository extends ApprovalConsumptionPersistenceRepository {
  createOrderTransaction(value: HeldApprovalConsumptionInput, authority: AiApprovedOrderAuthority): ApprovedOrderTransaction<Prisma.TransactionClient> {
    if (!authority || typeof authority.resolve !== 'function') throw new AiApprovalConsumptionRepositoryError('INVALID_BINDING');
    return this.effectTransaction<ApprovedOrderBinding>(value, 'rental.order.commit', {
      resolve: (input, binding, action, tx) => {
        if (input.context.actor.kind !== 'user' || input.context.scope.kind !== 'workspace'
          || binding.tenantId !== input.context.scope.tenantId || binding.workspaceId !== input.context.scope.workspaceId
          || binding.idempotencyKey !== input.businessIdempotencyKey || binding.requestFingerprint !== input.actionFingerprint)
          throw new AiApprovalConsumptionRepositoryError('INVALID_BINDING');
        return authority.resolve(input, binding, action, tx);
      },
      async assertCommitted(tx, binding, orderId) {
        const order = await tx.rentalOrder.findFirst({ where: { tenantId: binding.tenantId, workspaceId: binding.workspaceId,
          id: orderId }, select: { id: true } });
        const receipt = await tx.rentalOrderIdempotencyRecord.findFirst({ where: { tenantId: binding.tenantId,
          workspaceId: binding.workspaceId, action: 'rental.order.create', idempotencyKey: binding.idempotencyKey,
          requestHash: binding.requestFingerprint, orderId, status: 'succeeded' }, select: { id: true } });
        if (!order || !receipt) throw new AiApprovalConsumptionRepositoryError('INVALID_BINDING');
      }
    });
  }
}
