/** 管控命令发送前持久保存原引用；未知结果只核原收据，关闭/刷新不能换键重做。 */
import { clearSettingsReference, readSettingsReference, retainSettingsReference } from "@rental-os/platform-admin/forms";
import type { RentalAssetControlReceipt } from "@rental-os/rental-core";
import type { RentalCatalogApi } from "./client";
export type AssetControlAction = "create" | "emergency" | "extend" | "cancel" | "release" | "save_type";
export interface AssetControlOperation { operationId: string; action: AssetControlAction; targetId: string; expectedRevision: number }
const actions: AssetControlAction[] = ["create", "emergency", "extend", "cancel", "release", "save_type"];
export function createAssetControlRecovery(input: {
  scopeKey?: string; storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">; locks?: Pick<LockManager, "request">;
  api: Pick<RentalCatalogApi, "assetControlReceipt">; assertCurrent(): void; changed(): void;
}) {
  const key = input.scopeKey ? `rental:asset-control:v1:${input.scopeKey}` : "";
  const read = () => readSettingsReference(input.storage, key, (value): AssetControlOperation | null => {
    const row = value as AssetControlOperation | undefined;
    return row && Object.keys(row).length === 4 && /^[A-Za-z0-9_-]{1,128}$/u.test(row.operationId)
      && actions.includes(row.action) && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(row.targetId)
      && Number.isSafeInteger(row.expectedRevision) && row.expectedRevision >= 0 ? row : null;
  });
  const checkReceipt = (reference: AssetControlOperation, result: RentalAssetControlReceipt) => {
    if (result.status !== "committed" || result.operationId !== reference.operationId || result.action !== reference.action
      || result.revision !== reference.expectedRevision + 1 || !result.objectId
      || !["create", "emergency"].includes(reference.action) && result.objectId !== reference.targetId)
      throw new Error("管控原操作仍待核对，请保留原键");
  };
  const exclusive = async <T,>(work: () => Promise<T>) => {
    input.assertCurrent();
    if (!key || !input.storage || !input.locks) throw new Error("当前浏览器无法可靠保存管控原操作");
    return input.locks.request(key, { ifAvailable: true }, async lock => {
      if (!lock) throw new Error("另一页面正在处理管控原操作");
      input.assertCurrent(); try { return await work(); } finally { input.changed(); }
    });
  };
  return { key, read: () => ({ ...read(), unavailable: !key || !input.locks }),
    execute: (action: AssetControlAction, targetId: string, expectedRevision: number, assertWrite: () => void,
      send: (operationId: string) => Promise<RentalAssetControlReceipt>) => exclusive(async () => {
      assertWrite(); const state = read();
      if (state.blocked || state.pending) throw new Error("请先核对原管控操作");
      const reference = { operationId: crypto.randomUUID(), action, targetId, expectedRevision };
      retainSettingsReference(input.storage, key, reference); input.changed();
      try {
        input.assertCurrent(); assertWrite(); const result = await send(reference.operationId); input.assertCurrent();
        checkReceipt(reference, result); clearSettingsReference(input.storage, key, reference); return result;
      } catch (error) {
        const response = (error as { response?: { status?: number; data?: { code?: string; operationId?: string } } })?.response;
        if (response && [400, 403, 404, 409].includes(response.status ?? 0) && response.data?.code === "rental_asset_control_write_rejected"
          && response.data.operationId === reference.operationId) { input.assertCurrent(); clearSettingsReference(input.storage, key, reference); }
        throw error;
      }
    }),
    recover: () => exclusive(async () => {
      const state = read(); if (state.blocked || !state.pending) throw new Error("原管控操作引用不可读取");
      const reference = state.pending, result = await input.api.assetControlReceipt(reference.operationId, reference.action, reference.targetId);
      input.assertCurrent();
      if (result.status === "rejected" && result.operationId === reference.operationId && result.action === reference.action
        && result.targetId === reference.targetId && result.expectedRevision === reference.expectedRevision) {
        clearSettingsReference(input.storage, key, reference); return result;
      }
      checkReceipt(reference, result); clearSettingsReference(input.storage, key, reference); return result;
    }) };
}
