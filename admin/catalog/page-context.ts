/** 宿主供给当前会话和唯一JSON/图片传输，异步结果归属同一经营空间。 */
import { createContext, createElement, useContext, type ReactNode } from "react";
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";
import { createRentalCatalogApi, type RentalCatalogApi, type RentalCatalogImageRequest } from "./client";

export interface RentalCatalogPageContext {
  api: RentalCatalogApi;
  scopeKey: string;
  currentScopeKey: () => string | undefined;
  /** 受信会话的租户/空间/账号稳定引用；会话代次仍由scopeKey复验。 */
  operationScopeKey?: string;
}
export function createRentalCatalogPageContext({
  runtime,
  requestImage,
  scopeKey,
  currentScopeKey,
  operationScopeKey,
}: {
  runtime: AdminRuntime;
  requestImage: RentalCatalogImageRequest;
  scopeKey: string;
  currentScopeKey: RentalCatalogPageContext["currentScopeKey"];
  operationScopeKey?: string;
}): RentalCatalogPageContext {
  const assertCurrent = () => {
    if (!scopeKey || currentScopeKey() !== scopeKey)
      throw new DOMException("商品资产页面的会话或经营空间已变化", "AbortError");
  };
  const request: AdminRuntime["request"] = async <Result,>(
    path: string,
    options?: AdminRequestOptions,
  ): Promise<Result> => {
    assertCurrent();
    const result = await runtime.request<Result>(path, options);
    assertCurrent();
    return result;
  };
  const imageRequest: RentalCatalogImageRequest = async (path, options) => {
    assertCurrent();
    const image = await requestImage(path, options);
    assertCurrent();
    return image;
  };
  return { api: createRentalCatalogApi(request, imageRequest), scopeKey, currentScopeKey, operationScopeKey };
}
const CatalogContext = createContext<RentalCatalogPageContext | null>(null);
export function RentalCatalogPageProvider({
  context,
  children,
}: {
  context: RentalCatalogPageContext;
  children: ReactNode;
}) {
  return createElement(CatalogContext.Provider, { value: context }, children);
}
export function useRentalCatalogPageContext(): RentalCatalogPageContext {
  const context = useContext(CatalogContext);
  if (!context) throw new Error("商品资产页面上下文不可用");
  return context;
}
