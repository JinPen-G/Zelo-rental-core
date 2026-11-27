/** Rental compatibility: original C05 decisions and the original Task boundary. */
import type { RentalApprovalToolCode as AiToolCode } from './approval-tool-codes';
import type { AiProposalTarget } from '@rental-os/platform-contracts';
import { fingerprintAiProposalDraft } from './approval-binding';
import { withAiTaskTransaction } from './task-transactions';
import { ApprovalDecisionService, ApprovalPersistenceRepository, type ApprovalPersistenceDatabase,
  type AiApprovalAuthority as Authority, type AiApprovalDecisionInput as Decision, type AiApprovalRepository as Repository } from '@rental-os/ai-native-server/runtime/public-approval-persistence';
export { AiApprovalRepositoryError, type AiApprovalDecisionValue, type AiApprovalPrincipal, type AiApprovalRecord } from '@rental-os/ai-native-server/runtime/public-approval-persistence';
export type AiApprovalDecisionInput = Decision<AiToolCode, AiProposalTarget>;
export type AiApprovalRepository = Repository<AiToolCode, AiProposalTarget>;
export type AiApprovalAuthority = Authority<AiToolCode, AiProposalTarget>;

export class AiApprovalService extends ApprovalDecisionService<AiToolCode, AiProposalTarget> {
  constructor(repository: AiApprovalRepository, authority: AiApprovalAuthority) { super(repository, authority, { fingerprintAiProposalDraft }); }
}

export class PrismaAiApprovalRepository extends ApprovalPersistenceRepository<AiToolCode, AiProposalTarget> {
  constructor(db: ApprovalPersistenceDatabase, clock?: () => Date) { super(db, { withAiTaskTransaction }, clock); }
}
