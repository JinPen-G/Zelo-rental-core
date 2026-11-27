/** Rental compatibility: same C05 persistence, original closed tool set and transaction. */
import type { RentalApprovalToolCode as AiToolCode } from './approval-tool-codes';
import type { AiProposalTarget } from '@rental-os/platform-contracts';
import { fingerprintAiProposalDraft } from './approval-binding';
import { withAiTaskTransaction, withHeldAiTaskTransaction } from './task-transactions';
import { ProposalPersistenceRepository, type ProposalPersistenceDatabase, type AiProposalCreateInput as CreateInput } from '@rental-os/ai-native-server/runtime/public-approval-persistence';
export { AiProposalRepositoryError, type AiProposalActionBinding, type AiProposalHead } from '@rental-os/ai-native-server/runtime/public-approval-persistence';
export type AiProposalCreateInput = CreateInput<AiToolCode, AiProposalTarget>;

export class AiProposalRepository extends ProposalPersistenceRepository<AiToolCode, AiProposalTarget> {
  constructor(db: ProposalPersistenceDatabase) { super(db, { fingerprintAiProposalDraft }, { withAiTaskTransaction, withHeldAiTaskTransaction }); }
}
