/** Selected Rental authority and HTTP for the original PLATFORM retention journal.
 * The owning Core request keeps the original Guard and Native transaction. */
import type { PrismaClient } from '@prisma/client';
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';
import { createHash, randomUUID } from 'node:crypto';
import { beginPlatformAiManagementTransaction, type RentalRetentionUsers } from './platform-management-transaction';
import { AiTaskRepositoryError, createAiBodyStorageDatabase, createAiTaskBodyErasure, PlatformRetentionOperations,
  type PlatformRetentionIdentity } from '@rental-os/ai-native-server/runtime/public-rental-adapter-ports';
import type { RentalAuthService } from '@rental-os/rental-core/auth-service';
import { captureAiRequestBinding } from '@rental-os/ai-native-server/request-binding';
import { createPlatformRetentionController, platformRetentionRestoreKeyHash,
  type AiPlatformRetentionRequestFactory } from '@rental-os/ai-native-server/runtime/platform-retention-http';
import { AI_CONTRACT_DRAFT_VERSION } from '@rental-os/platform-contracts/ai-gateway';
import { hasEffectivePermission } from '@rental-os/platform-server/permission-match';
export { platformRetentionCleanupSchema } from '@rental-os/ai-native-server/runtime/public-rental-adapter-ports';

const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const { erasePlatformTaskBodies } = createAiTaskBodyErasure(['rental.order.commit', 'tenant.notifications.commit', 'membership.profile.commit']);
export class AiPlatformRetentionService extends PlatformRetentionOperations {
  constructor(db: PrismaClient, identity: PlatformRetentionIdentity, users: RentalRetentionUsers, assertActive: () => void,
    restoreKeyHash?: string) {
    super(db, identity, {
      begin: (tx, actorId) => beginPlatformAiManagementTransaction(tx, actorId, users, assertActive),
      eraseTaskBodies: erasePlatformTaskBodies,
      assertSelectedIdentity(context) {
        assertActive();
        const selected = getRequestIdentity();
        if (!hasRentalBusinessTenantFence() || !selected || selected.isSaasAdmin !== true || selected.audience !== 'operator' || selected.staffApi
          || context.actor.kind !== 'saas_admin' || selected.userId !== context.actor.userId || !('permissions' in context)
          || fingerprint([...(selected.permissions ?? [])].sort()) !== fingerprint([...context.permissions].sort()))
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      }
    }, undefined, restoreKeyHash);
  }
}

export { AI_PLATFORM_RETENTION_REQUESTS, AI_NATIVE_RETENTION_RESTORE_CONFIGURATION,
  AI_NATIVE_PLATFORM_RETENTION_RESTORE_KEY_HASH } from '@rental-os/ai-native-server/runtime/platform-retention-http';

const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');

export const AiPlatformRetentionController = createPlatformRetentionController(async work => {
  if (!hasRentalBusinessTenantFence()) throw denied();
  return work();
});

export function createRentalPlatformRetentionRequests(native: PrismaClient, auth: Pick<RentalAuthService, 'resolveAccessContext'>,
  users: RentalRetentionUsers, cipher: Parameters<typeof createAiBodyStorageDatabase>[1],
  keyHash?: unknown, configuration?: unknown): AiPlatformRetentionRequestFactory {
  const restoreKeyHash = platformRetentionRestoreKeyHash(keyHash, structuredClone(configuration));
  // The SDK must own its protection view. Its compatibility peer can have a different module instance.
  const db = createAiBodyStorageDatabase(native, cipher);
  return request => {
    const header = request?.headers?.authorization;
    if (typeof header !== 'string' || header.length > 8192 || !/^Bearer [A-Za-z0-9._~+/-]+=*$/u.test(header)) throw denied();
    const binding = captureAiRequestBinding(denied), identity = binding.identity;
    const { accessSession } = identity, requestId = randomUUID();
    const active = () => {
      binding.assertCurrent();
      if (!hasRentalBusinessTenantFence() || request.aborted || request.headers.authorization !== header || identity.isSaasAdmin !== true
        || identity.audience !== 'operator' || identity.staffApi || !identity.tenantId || !identity.userId
        || !accessSession?.sessionId || !Number.isSafeInteger(accessSession.expiresAt) || accessSession.expiresAt <= Date.now() / 1000)
        throw denied();
    };
    try { active(); } catch (error) { binding.close(); throw error; }
    const service = new AiPlatformRetentionService(db, { async resolve() {
      active();
      // As with the original directory Guard, a read grant is required here.
      // The original platform service independently requires manage for cleanup.
      const current = await auth.resolveAccessContext(header, { allowInvalidWorkspace: true, audience: 'operator' }).catch(() => undefined);
      active();
      const user = current?.user;
      if (!user?.isActive || !user.isSaasAdmin || user.mustChangePassword || user.id !== identity.userId || user.tenantId !== identity.tenantId
        || current?.workspaceId !== identity.workspaceId || current?.accessSession.sessionId !== accessSession!.sessionId
        || current.accessSession.expiresAt !== accessSession!.expiresAt
        || !hasEffectivePermission(user.permissions, 'system:ai-provider:view')) throw denied();
      return { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId, authorizedAt: new Date().toISOString(), audience: 'operator',
        actor: { kind: 'saas_admin', userId: user.id }, scope: { kind: 'platform' }, permissions: [...user.permissions] };
    } }, users, active, restoreKeyHash);
    return { cleanup: service.cleanup.bind(service), receipt: service.receipt.bind(service), receipts: service.receipts.bind(service),
      protectStoredBodies: service.protectStoredBodies.bind(service), exportRestoreManifest: service.exportRestoreManifest.bind(service),
      reapplyRestore: service.reapplyRestore.bind(service), close: binding.close };
  };
}
