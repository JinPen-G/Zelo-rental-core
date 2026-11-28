/** 独立养护只保存原键与资产引用。持久保存先于发送；未知结果只能读取原收据。
 * 稳定存储范围由已验证宿主供给，会话代次另作逐次复验，旧页面不能清除新引用。 */
import { clearSettingsReference, readSettingsReference, retainSettingsReference } from "@rental-os/platform-admin/forms";
import type { CreateRentalWorkOrderRequest } from "@rental-os/rental-core";
import type { RentalWorkOrderApi } from "./client";

interface ManualCreationReference { operationId: string; assetId: string }
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type LockPort = Pick<LockManager, "request">;

export function createManualWorkOrderRecovery(input: {
  scopeKey?: string; storage?: StoragePort; locks?: LockPort;
  api: Pick<RentalWorkOrderApi, "createWorkOrder" | "workOrderCreationReceipt">;
  assertCurrent(): void; changed(): void;
}) {
  const key = input.scopeKey ? `rental:manual-work-order:v1:${input.scopeKey}` : "";
  const read = () => readSettingsReference(input.storage, key, (value): ManualCreationReference | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    return Object.keys(row).length === 2 && typeof row.operationId === "string" && row.operationId.trim() === row.operationId
      && row.operationId.length > 0 && row.operationId.length <= 128
      && typeof row.assetId === "string" && row.assetId.trim() === row.assetId && row.assetId.length > 0 && row.assetId.length <= 191
      ? { operationId: row.operationId, assetId: row.assetId } : null;
  });
  const exclusive = async <T>(consume: () => Promise<T>) => {
    input.assertCurrent();
    if (!key || !input.storage || !input.locks) throw new Error("当前浏览器无法安全保存养护操作，请恢复浏览器存储后重试");
    // Web Locks protects the original locator across tabs as well as form instances.
    return input.locks.request(key, { ifAvailable: true }, async lock => {
      if (!lock) throw new Error("另一页面正在核对或提交养护操作，请稍后再试");
      input.assertCurrent();
      try { return await consume(); }
      catch (error) {
        if (error instanceof Error && error.message === "AI_SETTINGS_REFERENCE_UNAVAILABLE")
          throw new Error("原养护操作引用无法读取，请检查浏览器存储");
        throw error;
      }
      finally { input.changed(); }
    });
  };
  return {
    key,
    read: () => ({ ...read(), unavailable: !input.locks }),
    async create(data: CreateRentalWorkOrderRequest) {
      const frozen = structuredClone(data);
      return exclusive(async () => {
        const previous = read();
        if (previous.blocked || previous.pending) throw new Error("请先核对已有的养护创建结果");
        if (!frozen.assetId || !frozen.operationId || frozen.dispositionId) throw new Error("独立养护缺少资产或原操作号");
        const reference = { operationId: frozen.operationId, assetId: frozen.assetId };
        retainSettingsReference(input.storage, key, reference);
        input.changed();
        const result = await input.api.createWorkOrder(frozen);
        input.assertCurrent();
        if (!result.id || result.assetId !== reference.assetId || result.dispositionId || result.orderId)
          throw new Error("养护创建结果尚未确认，请核对原操作");
        clearSettingsReference(input.storage, key, reference);
        return result;
      });
    },
    recover: () => exclusive(async () => {
      const current = read();
      if (current.blocked || !current.pending) throw new Error("原养护操作引用无法读取，请检查浏览器存储");
      const reference = current.pending;
      const receipt = await input.api.workOrderCreationReceipt(reference.assetId, reference.operationId);
      input.assertCurrent();
      if (receipt.status === "unknown") return receipt;
      if (receipt.status !== "committed" || receipt.operationId !== reference.operationId
        || receipt.assetId !== reference.assetId || !receipt.workOrderId)
        throw new Error("养护创建结果尚未确认，请核对原操作");
      clearSettingsReference(input.storage, key, reference);
      return receipt;
    })
  };
}
