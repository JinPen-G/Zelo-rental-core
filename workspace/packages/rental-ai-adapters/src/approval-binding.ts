/** Compatibility binding for the original closed Rental action vocabulary. */
import { RENTAL_APPROVAL_TOOL_CODES as AI_TOOL_CODES } from './approval-tool-codes';
import { AI_PROPOSAL_TARGETS } from '@rental-os/platform-contracts';
import { createAiProposalBinding } from '@rental-os/ai-native-server/runtime/public-approval-persistence';
const tools = new Set<string>(AI_TOOL_CODES), targets = new Set<string>(AI_PROPOSAL_TARGETS);
export const { fingerprintAiProposalDraft, checkAiApprovalBindingDraft } = createAiProposalBinding({
  admits: action => tools.has(action.toolCode) && targets.has(action.target.resourceType)
});
