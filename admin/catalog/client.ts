/** 商品、资产与库存沿原API路径；JSON和图片共用宿主已认证的传输接点。 */
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";
import type {
  RentalAsset,
  RentalAssetSchedule,
  RentalAssetScheduleQuery,
  RentalAssetStatusHistory,
  RentalItemGroup,
  RentalStockBalance,
  RentalStockLedgerEntry,
  RentalStockOperationRequest,
  RentalStockOperationResult,
  SaveRentalAssetRequest,
  SaveRentalItemGroupRequest,
  RentalAssetControl, RentalAssetControlType, RentalAssetControlOptions, RentalAssetControlReceipt, RentalAssetControlEvent,
  RentalAssetControlCommand, CreateRentalAssetControlRequest, EmergencyRentalAssetControlRequest,
  ExtendRentalAssetControlRequest, SaveRentalAssetControlTypeRequest, RentalWorkOrderAssignee,
} from "@rental-os/rental-core";
import { createRentalOrderApi } from "../orders/client";
import { createRentalLocationApi } from "../locations/client";
import { createRentalWorkOrderApi } from "../work-orders/client";

type ReadOptions = Pick<AdminRequestOptions, "signal">;
export type RentalCatalogImageRequest = (path: string, options?: ReadOptions) => Promise<Blob>;

export function createRentalCatalogApi(
  request: AdminRuntime["request"],
  requestImage: RentalCatalogImageRequest,
) {
  const orders = createRentalOrderApi(request);
  const locations = createRentalLocationApi(request);
  const workOrders = createRentalWorkOrderApi(request);
  return {
    profile: orders.profile,
    itemGroups: orders.itemGroups,
    pricingGroups: orders.pricingGroups,
    locations: orders.locations,
    categories: locations.categories,
    saveItemGroup: (data: SaveRentalItemGroupRequest) =>
      request<RentalItemGroup>(data.id ? "/rental/v1/item-groups/" + data.id : "/rental/v1/item-groups", {
        method: data.id ? "put" : "post",
        data,
      }),
    uploadItemGroupImage: (id: string, file: File) => {
      const data = new FormData();
      data.append("file", file);
      return request<RentalItemGroup>("/rental/v1/item-groups/" + id + "/images", { method: "post", data });
    },
    removeItemGroupImage: (id: string, imageId: string) =>
      request<RentalItemGroup>("/rental/v1/item-groups/" + id + "/images/" + imageId, { method: "delete" }),
    itemGroupImageBlob: (id: string, imageId: string, options?: ReadOptions) =>
      requestImage("/rental/v1/item-groups/" + id + "/images/" + imageId, options),
    assets: (options?: ReadOptions) => request<RentalAsset[]>("/rental/v1/assets", options),
    assetControls: (assetId?: string, options?: ReadOptions) => request<RentalAssetControl[]>("/rental/v1/asset-controls", { params: { assetId }, ...options }),
    assetControlTypes: (options?: ReadOptions) => request<RentalAssetControlType[]>("/rental/v1/asset-control-types", options),
    assetControlOptions: (options?: ReadOptions) => request<RentalAssetControlOptions>("/rental/v1/asset-control-options", options),
    assetControlAssignees: (locationId: string, options?: ReadOptions) => request<RentalWorkOrderAssignee[]>("/rental/v1/asset-control-assignees", { params: { locationId }, ...options }),
    assetControlHistory: (id: string, options?: ReadOptions) => request<RentalAssetControlEvent[]>(`/rental/v1/asset-controls/${encodeURIComponent(id)}/history`, options),
    assetControlConflicts: (id: string, options?: ReadOptions) => request<{ available: boolean; orders: Array<{ id: string; orderNo: string; status: string }> }>(`/rental/v1/asset-controls/${encodeURIComponent(id)}/conflicts`, options),
    assetControlReceipt: (operationId: string, action: RentalAssetControlEvent["action"] | "save_type", targetId: string) =>
      request<RentalAssetControlReceipt>(`/rental/v1/asset-control-operations/${encodeURIComponent(operationId)}`, { params: { action, targetId } }),
    createAssetControl: (data: CreateRentalAssetControlRequest) => request<RentalAssetControlReceipt>("/rental/v1/asset-controls", { method: "post", data }),
    emergencyAssetControl: (data: EmergencyRentalAssetControlRequest) => request<RentalAssetControlReceipt>("/rental/v1/asset-controls/emergency", { method: "post", data }),
    changeAssetControl: (id: string, action: "extend" | "cancel" | "release", data: RentalAssetControlCommand | ExtendRentalAssetControlRequest) =>
      request<RentalAssetControlReceipt>(`/rental/v1/asset-controls/${encodeURIComponent(id)}/${action}`, { method: "post", data }),
    saveAssetControlType: (data: SaveRentalAssetControlTypeRequest) => request<RentalAssetControlReceipt>("/rental/v1/asset-control-types", { method: "put", data }),
    assetSchedule: (params: RentalAssetScheduleQuery, options?: ReadOptions) =>
      request<RentalAssetSchedule>("/rental/v1/asset-schedule", { params: { ...params }, ...options }),
    assetStatusHistory: (assetId: string, options?: ReadOptions) =>
      request<RentalAssetStatusHistory[]>(
        "/rental/v1/assets/" + encodeURIComponent(assetId) + "/status-history",
        options,
      ),
    saveAsset: (data: SaveRentalAssetRequest) =>
      request<RentalAsset>(data.id ? "/rental/v1/assets/" + data.id : "/rental/v1/assets", {
        method: data.id ? "put" : "post",
        data,
      }),
    stockBalances: (options?: ReadOptions) =>
      request<RentalStockBalance[]>("/rental/v1/stock-balances", options),
    stockDispositions: workOrders.stockDispositions,
    workOrders: workOrders.workOrders,
    stockLedger: (
      params?: {
        itemGroupId?: string;
        locationId?: string;
        batchNo?: string;
        sourceDocumentNo?: string;
        limit?: number;
      },
      options?: ReadOptions,
    ) => request<RentalStockLedgerEntry[]>("/rental/v1/stock-ledger", { params, ...options }),
    applyStockOperation: (data: RentalStockOperationRequest) =>
      request<RentalStockOperationResult>("/rental/v1/stock-operations", { method: "post", data }),
  };
}
export type RentalCatalogApi = ReturnType<typeof createRentalCatalogApi>;
