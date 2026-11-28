/** 人工管控复用原 Rental 幂等账。原键绑定账号、空间与动作；收据只确认原修订，
 * 当前对象读取权仍须重核。未确认提交的结果不会变成可重发的新意图。 */
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@prisma/client";
import { sqltag as sql } from "@prisma/client/runtime/library";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import type { RentalHttpApplications } from "./http-applications";
import type { RentalAssetControl, RentalAssetControlCommand, RentalAssetControlReceipt, RentalAssetControlType } from "./asset-controls";
import { assertAssetControlAuthority } from "./mysql-asset-controls";
import { assertAssetControlCommand } from "./asset-control-policy";

export const ASSET_CONTROL_ACTIONS = ["create", "emergency", "extend", "cancel", "release", "save_type"] as const;
export type AssetControlAction = typeof ASSET_CONTROL_ACTIONS[number];
interface OriginalControlReceipt {
  tenantId: string; workspaceId: string; actorUserId: string; targetId: string;
  receipt: Exclude<RentalAssetControlReceipt, { status: "unknown" }>;
  rejection?: { status: number; conflicts?: unknown };
}
export class RentalAssetControlApplication {
  constructor(private readonly core: RentalHttpApplications["core"], private readonly idempotent: RentalHttpApplications["idempotent"]) {}
  private context(tenantId: string, actorId: string, action: AssetControlAction, operationId: string, targetId: string, write: boolean) {
    if (!ASSET_CONTROL_ACTIONS.includes(action) || !/^[A-Za-z0-9_-]{1,128}$/u.test(operationId)
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(targetId)) throw new BadRequestException("管控原操作引用无效");
    const identity = structuredClone(getRequestIdentity()), workspaceId = identity?.workspaceId ?? "";
    const authority = write ? action === "save_type" ? "configure" : action === "emergency" ? "emergency" : "manage" : "read";
    const current = () => {
      if (actorId !== identity?.userId || !isDeepStrictEqual(identity, getRequestIdentity())) throw new ForbiddenException("管控操作身份已变化");
      assertAssetControlAuthority(getRequestIdentity(), tenantId, workspaceId, authority);
    };
    current();
    return { tenantId, workspaceId, actorUserId: actorId, targetId, current,
      key: createHash("sha256").update(JSON.stringify([workspaceId, actorId, operationId])).digest("hex"), action: `asset_control.${action}` };
  }
  private async replay(context: ReturnType<RentalAssetControlApplication["context"]>, action: AssetControlAction,
    operationId: string, value: unknown): Promise<OriginalControlReceipt["receipt"] | undefined> {
    context.current();
    const original = value as OriginalControlReceipt | undefined, receipt = original?.receipt;
    if (!original || original.tenantId !== context.tenantId || original.workspaceId !== context.workspaceId
      || original.actorUserId !== context.actorUserId || original.targetId !== context.targetId
      || !receipt || receipt.operationId !== operationId || receipt.action !== action) return undefined;
    if (receipt.status === "rejected") {
      if (receipt.targetId !== context.targetId || !Number.isSafeInteger(receipt.expectedRevision) || receipt.expectedRevision < 0) return undefined;
      if (["create", "emergency"].includes(action)) {
        if (!(await this.core.assetControlOptions(context.tenantId)).assets.some(asset => asset.id === context.targetId)) return undefined;
      } else if (action !== "save_type" && !(await this.core.listAssetControls(context.tenantId)).some(row => row.id === context.targetId)) return undefined;
      context.current(); return receipt;
    }
    if (receipt.status !== "committed" || !Number.isSafeInteger(receipt.revision) || receipt.revision < 1) return undefined;
    if (action === "save_type") {
      const current = (await this.core.assetControlTypes(context.tenantId)).find(row => row.code === context.targetId);
      if (!current || receipt.objectId !== current.code || current.revision < receipt.revision) return undefined;
    } else {
      const current = (await this.core.listAssetControls(context.tenantId, ["create", "emergency"].includes(action) ? context.targetId : undefined))
        .find(row => row.id === receipt.objectId);
      if (!current || current.tenantId !== context.tenantId || current.workspaceId !== context.workspaceId
        || current.revision < receipt.revision || (!["create", "emergency"].includes(action) && current.id !== context.targetId)) return undefined;
    }
    context.current(); return receipt;
  }
  async read(tenantId: string, actorId: string, action: AssetControlAction, operationId: string, targetId: string): Promise<RentalAssetControlReceipt> {
    const context = this.context(tenantId, actorId, action, operationId, targetId, false);
    const result = await this.idempotent.readReceipt({ tenantId, action: context.action, key: context.key, orderId: null,
      replay: response => this.replay(context, action, operationId, response) });
    context.current(); return result ?? { status: "unknown" };
  }
  async execute(tenantId: string, actorId: string, action: AssetControlAction, targetId: string, value: RentalAssetControlCommand,
    run: (tx: Prisma.TransactionClient) => Promise<RentalAssetControl | RentalAssetControlType>): Promise<RentalAssetControlReceipt> {
    const input = structuredClone(value), context = this.context(tenantId, actorId, action, input.operationId, targetId, true);
    assertAssetControlCommand(input, input.expectedRevision);
    {
      const result = await this.idempotent.execute<OriginalControlReceipt>({ tenantId, action: context.action, key: context.key,
        fallbackKey: context.key, request: { tenantId, workspaceId: context.workspaceId, actorId, action, targetId, input },
        run: async tx => {
          // 可解释拒绝也保留在原账。先撤回本命令全部局部写入，再与拒绝收据一同提交；
          // 不用“暂时查无收据”证明可重发，提交/连接不明的异常继续抛给原恢复链。
          await tx.$executeRaw(sql`SAVEPOINT rental_asset_control_command`);
          try {
            context.current(); const result = await run(tx); context.current();
            await tx.$executeRaw(sql`RELEASE SAVEPOINT rental_asset_control_command`);
            return { tenantId, workspaceId: context.workspaceId, actorUserId: actorId, targetId,
              receipt: { status: "committed", operationId: input.operationId, action,
                objectId: "id" in result ? result.id : result.code, revision: result.revision } };
          } catch (error) {
            if (!(error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof ConflictException)) throw error;
            await tx.$executeRaw(sql`ROLLBACK TO SAVEPOINT rental_asset_control_command`);
            await tx.$executeRaw(sql`RELEASE SAVEPOINT rental_asset_control_command`);
            const response = error.getResponse(), conflicts = typeof response === "object" && "conflicts" in response ? response.conflicts : undefined;
            return { tenantId, workspaceId: context.workspaceId, actorUserId: actorId, targetId,
              receipt: { status: "rejected", operationId: input.operationId, action, targetId, expectedRevision: input.expectedRevision, message: error.message },
              rejection: { status: error.getStatus(), ...(conflicts ? { conflicts } : {}) } };
          }
        },
        replay: async response => {
          const receipt = await this.replay(context, action, input.operationId, response);
          // 历史拒绝只回原结论，不能带回原时点的订单字段投影。
          return receipt ? { ...(response as OriginalControlReceipt), rejection: { status: 409 } } : undefined;
        } });
      context.current();
      if (result.receipt.status === "rejected") {
        throw new ConflictException({ code: "rental_asset_control_write_rejected", operationId: input.operationId,
          message: result.receipt.message, ...(result.rejection?.conflicts ? { conflicts: result.rejection.conflicts } : {}) });
      }
      return result.receipt;
    }
  }
}
