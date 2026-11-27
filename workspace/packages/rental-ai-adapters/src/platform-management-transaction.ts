/** Rental selected-host adapter for the public management transaction boundary.
 * Original sorted principal/Tenant locks and final data checks stay in Core. */
import type { Prisma } from '@prisma/client';
import type { RentalMysqlAuthenticationRepository } from '@rental-os/rental-core/mysql-auth-source';
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { hasRentalBusinessTenantFence, lockRentalBusinessTenant,
  assertRentalBusinessTenantAccessAfterLock } from '@rental-os/rental-core/mysql-business-fence';
import { AiTaskRepositoryError, beginPlatformAiManagementTransaction as beginPublicTransaction } from '@rental-os/ai-native-server/runtime/public-rental-adapter-ports';

export type RentalRetentionUsers = Pick<RentalMysqlAuthenticationRepository, 'findUserById'>;

export async function beginPlatformAiManagementTransaction(transaction: Prisma.TransactionClient, actorId: string,
  users: RentalRetentionUsers, assertActive: () => void) {
  const tenantId = getRequestIdentity()?.tenantId;
  if (!hasRentalBusinessTenantFence() || !tenantId || typeof users?.findUserById !== 'function')
    throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  return beginPublicTransaction(transaction, actorId, { async begin(tx) {
    assertActive();
    await lockRentalBusinessTenant(tx, tenantId);
    const revalidate = async () => {
      assertActive();
      await assertRentalBusinessTenantAccessAfterLock(tx, tenantId);
      assertActive();
    };
    return { revalidate, async currentUser() {
      // The selected Core fence already holds the original session/user locks.
      // Project permissions through the same Native instead of opening another connection.
      await revalidate();
      const user = await users.findUserById(actorId, tx);
      if (!user || user.id !== actorId || user.tenantId !== tenantId || !user.isActive || !user.isSaasAdmin || user.mustChangePassword)
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      assertActive();
      return user;
    }, close() {} };
  } });
}
