/** Legacy Task projection retains the registered Rental result categories. */
import { AI_TEXT_MODEL_STEP_CODE, AI_IMAGE_MODEL_STEP_CODE, AI_AUDIO_MODEL_STEP_CODE } from '@rental-os/platform-contracts/ai-task';
import type { AiTaskRepositoryAuthority } from '@rental-os/ai-native-server/runtime/public-rental-adapter-ports';
import { aiTaskAccessFromContext } from '@rental-os/ai-native-server/runtime/public-rental-adapter-ports';
import { AiTaskRepositoryError } from '@rental-os/ai-native-server/runtime/public-rental-adapter-ports';
import { TaskEventReader, type TaskEventDatabase } from '@rental-os/ai-native-server/runtime/public-rental-adapter-ports';

export class AiTaskEventRepository extends TaskEventReader {
  constructor(db: TaskEventDatabase, authority: AiTaskRepositoryAuthority, clock: () => Date = () => new Date()) {
    super(db, { async resolveAccess(taskId, operation) {
      try { return aiTaskAccessFromContext(await authority.resolve(taskId, operation), taskId, clock()); }
      catch { throw new AiTaskRepositoryError('AI_ACCESS_DENIED'); }
    } }, code => {
      if (code === 'rental.order.commit' || code === 'tenant.notifications.commit') return 'confirmation';
      if ([AI_TEXT_MODEL_STEP_CODE, AI_IMAGE_MODEL_STEP_CODE, AI_AUDIO_MODEL_STEP_CODE].some(model => model === code)) return 'model';
    });
  }
}
