/** 营销配置单次派发和原收据恢复。浏览器只保存本人/空间的原键与对象引用，
 * 不保存规则正文或凭据；页面撤权、未知结果及损坏引用都不能换号自动重做。 */
import { useLayoutEffect, useRef, useState } from "react";
import type { RentalMarketingPlan, RentalMarketingPlanEvent, RentalMarketingPricingPolicy } from "@rental-os/rental-core";
import type { RentalCommercialPageContext } from "./page-context";

export type MarketingAction = RentalMarketingPlanEvent["action"] | "change_policy";
export interface MarketingOperationReference {
  version: 1; scope: string; operationId: string; action: MarketingAction; planId?: string; expectedRevision: number;
}
const actions: MarketingAction[] = ["save_draft", "publish", "pause", "end", "change_policy"];
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);

export function marketingOperationScope(scope: RentalCommercialPageContext["operationScope"]): string {
  return scope && [scope.tenantId, scope.workspaceId, scope.actorUserId].every(value => typeof value === "string" && value.trim())
    ? JSON.stringify([scope.tenantId, scope.workspaceId, scope.actorUserId]) : "";
}
export function readMarketingOperation(storage: Pick<Storage, "getItem">, scope: string): MarketingOperationReference | undefined {
  if (!scope) throw new Error("当前营销操作身份不可用");
  const raw = storage.getItem(`rental.marketing-operation.v1:${scope}`);
  if (raw === null) return undefined;
  const row = JSON.parse(raw) as MarketingOperationReference;
  if (!row || Array.isArray(row) || Object.keys(row).some(key => !["version", "scope", "operationId", "action", "planId", "expectedRevision"].includes(key))
    || row.version !== 1 || row.scope !== scope || !validId(row.operationId) || row.operationId.length > 128
    || !actions.includes(row.action) || !Number.isSafeInteger(row.expectedRevision) || row.expectedRevision < 0
    || row.planId !== undefined && !validId(row.planId)
    || ["publish", "pause", "end"].includes(row.action) && !row.planId
    || row.action === "change_policy" && row.planId !== undefined) throw new Error("原营销操作引用不可读取，请保留原引用核对");
  return row;
}
export function isMarketingWriteRejected(error: unknown, reference: MarketingOperationReference): boolean {
  const response = (error as { response?: { status?: number; data?: { code?: string; operationId?: string } } })?.response;
  return Boolean(response && [400, 403, 404, 409].includes(response.status ?? 0)
    && response.data?.code === "rental_marketing_write_rejected" && response.data.operationId === reference.operationId);
}

export function useMarketingOperation(context: RentalCommercialPageContext, assertRead: () => void) {
  const scope = marketingOperationScope(context.operationScope), key = `rental.marketing-operation.v1:${scope}`;
  const live = useRef({ active: true, scope, context, assertRead });
  live.current = { ...live.current, scope, context, assertRead };
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false), [, redraw] = useState(0);
  let pending: MarketingOperationReference | undefined, storageFailure = "";
  try { pending = readMarketingOperation(window.localStorage, scope); }
  catch (error) { storageFailure = error instanceof Error ? error.message : "原营销操作引用不可读取，请保留原引用核对"; }
  const assertCurrent = () => {
    const now = live.current;
    if (!now.active || now.scope !== scope || now.context.scopeKey !== context.scopeKey
      || context.currentScopeKey() !== context.scopeKey) throw new DOMException("营销页面身份已变化", "AbortError");
    now.assertRead();
  };
  useLayoutEffect(() => {
    live.current.active = true;
    const update = (event: StorageEvent) => { if (event.storageArea === window.localStorage && (event.key === key || event.key === null)) redraw(n => n + 1); };
    window.addEventListener("storage", update);
    return () => { live.current.active = false; window.removeEventListener("storage", update); };
  }, [key]);
  const refresh = () => { if (live.current.active && live.current.scope === scope) redraw(n => n + 1); };
  const clear = (reference: MarketingOperationReference) => {
    assertCurrent();
    if (JSON.stringify(readMarketingOperation(window.localStorage, scope)) !== JSON.stringify(reference))
      throw new Error("原营销操作引用已变化");
    window.localStorage.removeItem(key);
    if (window.localStorage.getItem(key) !== null) throw new Error("原营销操作引用未清除，请继续核对");
    refresh();
  };
  const locked = async <Result,>(work: () => Promise<Result>): Promise<Result> => {
    assertCurrent();
    if (storageFailure || inFlight.current || !navigator.locks) throw new Error(storageFailure || "当前营销操作正在处理或缺少页面协调能力");
    inFlight.current = true; setBusy(true);
    try { return await navigator.locks.request(key, { mode: "exclusive" }, async () => { assertCurrent(); return work(); }); }
    finally { inFlight.current = false; if (live.current.active && live.current.scope === scope) setBusy(false); }
  };
  const run = async <Result extends RentalMarketingPlan | RentalMarketingPricingPolicy>(
    action: MarketingAction, planId: string | undefined, expectedRevision: number,
    assertWrite: () => void, send: (operationId: string) => Promise<Result>
  ): Promise<Result> => locked(async () => {
    assertWrite();
    if (readMarketingOperation(window.localStorage, scope)) throw new Error("请先核对原营销操作结果");
    const reference: MarketingOperationReference = { version: 1, scope, operationId: crypto.randomUUID(), action, planId, expectedRevision };
    const text = JSON.stringify(reference);
    window.localStorage.setItem(key, text);
    if (window.localStorage.getItem(key) !== text) throw new Error("原营销操作引用未可靠保存，未发送命令");
    refresh();
    try {
      assertCurrent(); assertWrite();
      const result = await send(reference.operationId);
      assertCurrent();
      const original = context.operationScope!;
      if (result.tenantId !== original.tenantId || result.workspaceId !== original.workspaceId || result.revision !== expectedRevision + 1
        || action === "change_policy" && (!("policy" in result) || result.updatedBy !== original.actorUserId)
        || action !== "change_policy" && (!("id" in result) || !validId(result.id) || planId !== undefined && result.id !== planId))
        throw new Error("营销提交结果缺少原对象或修订，请核对原操作");
      clear(reference);
      return result;
    } catch (error) {
      if (isMarketingWriteRejected(error, reference)) clear(reference);
      throw error;
    }
  });
  const reconcile = async () => locked(async () => {
    const reference = readMarketingOperation(window.localStorage, scope);
    if (!reference) return undefined;
    const receipt = reference.action === "change_policy"
      ? await context.api.marketingPricingPolicyOperation(reference.operationId)
      : await context.api.marketingPlanOperation(reference.operationId, reference.action);
    assertCurrent();
    if (receipt.status === "unknown") throw new Error("原操作结果仍待核对，请保留原键，不要再次提交");
    if (receipt.status === "rejected") {
      if (receipt.operationId !== reference.operationId || receipt.action !== reference.action || receipt.planId !== reference.planId
        || receipt.expectedRevision !== reference.expectedRevision) throw new Error("营销原收据与当前引用不一致");
      clear(reference); throw new Error(receipt.message);
    }
    if (receipt.operationId !== reference.operationId || ("result" in receipt
      ? reference.action !== "change_policy" || receipt.result.tenantId !== context.operationScope!.tenantId
        || receipt.result.workspaceId !== context.operationScope!.workspaceId || receipt.result.updatedBy !== context.operationScope!.actorUserId
        || receipt.result.revision !== reference.expectedRevision + 1
      : receipt.action !== reference.action || receipt.revision !== reference.expectedRevision + 1
        || !validId(receipt.planId) || reference.planId !== undefined && receipt.planId !== reference.planId))
      throw new Error("营销原收据与当前引用不一致");
    clear(reference);
    return "planId" in receipt ? receipt.planId : undefined;
  });
  return { pending, busy, storageFailure, blocked: Boolean(storageFailure || pending || busy), run, reconcile };
}
