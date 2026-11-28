/** 只标明原事务回调内的确定拒绝，供页面解除本次未提交意图。
 * 连接/提交失败、回放失败及宿主后置拒绝仍为未知，不能据此换键重做。 */
import { HttpException } from "@nestjs/common";
import type { RentalBusinessTenantTransaction } from "./mysql-business-fence";
import type { IdempotentActionInput, RentalIdempotentActionService } from "./mysql-idempotent-actions";

export async function executeMarketingCommand<Result, Tx extends RentalBusinessTenantTransaction>(
  actions: RentalIdempotentActionService<Tx>, operationId: string, input: IdempotentActionInput<Result, Tx>
): Promise<Result> {
  let rejected: HttpException | undefined;
  try {
    return await actions.execute({ ...input, run: async tx => {
      try { return await input.run(tx); }
      catch (error) {
        if (error instanceof HttpException && [400, 403, 404, 409].includes(error.getStatus())) rejected = error;
        throw error;
      }
    } });
  } catch (error) {
    // 必须是原执行器在回滚该回调后抛回同一个错误；提交阶段故障不满足此条件。
    if (error === rejected && rejected) throw new HttpException({ code: "rental_marketing_write_rejected",
      operationId, message: rejected.message }, rejected.getStatus());
    throw error;
  }
}
