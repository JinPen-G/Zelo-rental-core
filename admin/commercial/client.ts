/** 商业配置沿原 Rental HTTP，价格、版本、券预算和容量由服务端裁定。 */
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";
import type {
  CancelRentalPriceAdjustmentRequest,
  CreateRentalPriceAdjustmentRequest,
  RentalCouponTemplate,
  RentalCustomerCoupon,
  RentalDiscountPlan,
  RentalMarketingPlan,
  RentalMarketingQuotePreview,
  RentalMarketingSchedule,
  RentalMarketingScheduleQuery,
  RentalQuoteRequest,
  RentalMarketingPricingPolicy,
  RentalMarketingPricingPolicyReceipt,
  ChangeRentalMarketingPricingPolicyRequest,
  RentalMarketingPlanHistory,
  RentalMarketingPlanOperationReceipt,
  RentalMarketingPlanEvent,
  SaveRentalMarketingPlanDraftRequest,
  ImportRentalMarketingPlanRequest,
  ChangeRentalMarketingPlanStatusRequest,
  RentalPriceAdjustmentPlan,
  RentalPriceAdjustmentPreviewRow,
  RentalPriceVersion,
  RentalPricingGroup,
  RentalRuleVersion,
  RentalServiceCapacity,
  RentalValueAddedService,
  RestoreRentalPriceVersionRequest,
  SaveRentalCouponTemplateRequest,
  SaveRentalDiscountPlanRequest,
  SaveRentalPricingGroupRequest,
  SaveRentalServiceCapacityRequest,
  SaveRentalValueAddedServiceRequest,
  UpdateRentalPricingGroupSecurityRatesRequest,
} from "@rental-os/rental-core";
import { createRentalOrderApi } from "../orders/client";
import { createRentalCatalogApi, type RentalCatalogImageRequest } from "../catalog/client";

type ReadOptions = Pick<AdminRequestOptions, "signal">;
const readOptions = (options?: ReadOptions) => (options?.signal ? { signal: options.signal } : undefined);

export function createRentalCommercialApi(
  request: AdminRuntime["request"],
  requestImage: RentalCatalogImageRequest,
) {
  const orders = createRentalOrderApi(request);
  const catalog = createRentalCatalogApi(request, requestImage);
  return {
    profile: orders.profile,
    bookingMembers: orders.bookingMembers,
    bookingOptions: orders.bookingOptions,
    businessSettings: orders.businessSettings,
    itemGroups: orders.itemGroups,
    pricingGroups: orders.pricingGroups,
    locations: orders.locations,
    pricingPlans: orders.pricingPlans,
    discountPlans: orders.discountPlans,
    valueAddedServices: orders.valueAddedServices,
    customerCoupons: orders.customerCoupons,
    itemGroupImageBlob: catalog.itemGroupImageBlob,
    ruleVersions: (options?: ReadOptions) =>
      request<RentalRuleVersion[]>("/rental/v1/rule-versions", readOptions(options)),
    couponTemplates: (options?: ReadOptions) =>
      request<RentalCouponTemplate[]>("/rental/v1/coupon-templates", readOptions(options)),
    priceAdjustments: (options?: ReadOptions) =>
      request<RentalPriceAdjustmentPlan[]>("/rental/v1/pricing-adjustments", readOptions(options)),
    priceVersions: (page?: number, pageSize?: number, options?: ReadOptions) =>
      request<{ total: number; rows: Array<RentalPriceVersion & { rateCount: number }> }>(
        "/rental/v1/pricing-versions",
        {
          params: { page, pageSize },
          ...readOptions(options),
        },
      ),
    priceVersion: (sequence: number, options?: ReadOptions) =>
      request<RentalPriceVersion>(`/rental/v1/pricing-versions/${sequence}`, readOptions(options)),
    serviceCapacities: (serviceId?: string, options?: ReadOptions) =>
      request<RentalServiceCapacity[]>(
        `/rental/v1/service-capacities${serviceId ? `?serviceId=${encodeURIComponent(serviceId)}` : ""}`,
        readOptions(options),
      ),
    savePricingGroup: (data: SaveRentalPricingGroupRequest) =>
      request<RentalPricingGroup>(
        data.id ? `/rental/v1/pricing-groups/${data.id}` : "/rental/v1/pricing-groups",
        { method: data.id ? "put" : "post", data },
      ),
    updatePricingGroupSecurityRates: (id: string, data: UpdateRentalPricingGroupSecurityRatesRequest) =>
      request<{
        id: string;
        sequence: number;
        version: string;
        effectiveFrom: string;
        changeReason?: string;
      }>(`/rental/v1/pricing-groups/${id}/security-rates`, { method: "patch", data }),
    createPriceAdjustment: (data: CreateRentalPriceAdjustmentRequest) =>
      request<{
        id: string;
        code: string;
        name: string;
        status: string;
        preview: RentalPriceAdjustmentPreviewRow[];
      }>("/rental/v1/pricing-adjustments", { method: "post", data }),
    confirmPriceAdjustment: (adjustmentId: string) =>
      request<unknown>(`/rental/v1/pricing-adjustments/${adjustmentId}/confirm`, { method: "post" }),
    cancelPriceAdjustment: (adjustmentId: string, data: CancelRentalPriceAdjustmentRequest) =>
      request<unknown>(`/rental/v1/pricing-adjustments/${adjustmentId}/cancel`, { method: "post", data }),
    restorePriceVersion: (sequence: number, data: RestoreRentalPriceVersionRequest) =>
      request<{ id: string; sequence: number; version: string; restoredFromVersion: string }>(
        `/rental/v1/pricing-versions/${sequence}/restore`,
        { method: "post", data },
      ),
    saveDiscountPlan: (data: SaveRentalDiscountPlanRequest) =>
      request<RentalDiscountPlan>(
        data.id ? `/rental/v1/discount-plans/${data.id}` : "/rental/v1/discount-plans",
        { method: data.id ? "put" : "post", data },
      ),
    marketingPlans: (options?: ReadOptions) => request<RentalMarketingPlan[]>("/rental/v1/marketing-plans", readOptions(options)),
    marketingSchedule: (params: RentalMarketingScheduleQuery, options?: ReadOptions) =>
      request<RentalMarketingSchedule>("/rental/v1/marketing-plans/schedule", { params, ...readOptions(options) }),
    previewMarketingQuote: (data: RentalQuoteRequest, options?: ReadOptions) =>
      request<RentalMarketingQuotePreview>("/rental/v1/marketing-plans/preview", { method: "post", data, ...readOptions(options), retryAuthentication: false }),
    marketingPricingPolicy: (options?: ReadOptions) => request<RentalMarketingPricingPolicy>("/rental/v1/marketing-pricing-policy", readOptions(options)),
    marketingPricingPolicyOperation: (operationId: string, options?: ReadOptions) =>
      request<RentalMarketingPricingPolicyReceipt>(`/rental/v1/marketing-pricing-policy/operations/${encodeURIComponent(operationId)}`, readOptions(options)),
    changeMarketingPricingPolicy: (input: ChangeRentalMarketingPricingPolicyRequest) =>
      request<RentalMarketingPricingPolicy>("/rental/v1/marketing-pricing-policy", { method: "put", data: input, retryAuthentication: false }),
    marketingPlanHistory: (id: string, options?: ReadOptions) =>
      request<RentalMarketingPlanHistory>(`/rental/v1/marketing-plans/${encodeURIComponent(id)}/history`, readOptions(options)),
    marketingPlanOperation: (operationId: string, action: RentalMarketingPlanEvent["action"], options?: ReadOptions) =>
      request<RentalMarketingPlanOperationReceipt>(`/rental/v1/marketing-plans/operations/${encodeURIComponent(operationId)}`,
        { params: { action }, ...readOptions(options) }),
    importLegacyMarketingPlan: (data: ImportRentalMarketingPlanRequest) => request<RentalMarketingPlan>("/rental/v1/marketing-plans/import-legacy", { method: "post", data, retryAuthentication: false }),
    saveMarketingPlanDraft: (data: SaveRentalMarketingPlanDraftRequest) => request<RentalMarketingPlan>(
      data.id ? `/rental/v1/marketing-plans/${encodeURIComponent(data.id)}/draft` : "/rental/v1/marketing-plans",
      { method: data.id ? "put" : "post", data, retryAuthentication: false }),
    publishMarketingPlan: (id: string, data: ChangeRentalMarketingPlanStatusRequest) =>
      request<RentalMarketingPlan>(`/rental/v1/marketing-plans/${encodeURIComponent(id)}/publish`, { method: "post", data, retryAuthentication: false }),
    pauseMarketingPlan: (id: string, data: ChangeRentalMarketingPlanStatusRequest) =>
      request<RentalMarketingPlan>(`/rental/v1/marketing-plans/${encodeURIComponent(id)}/pause`, { method: "post", data, retryAuthentication: false }),
    endMarketingPlan: (id: string, data: ChangeRentalMarketingPlanStatusRequest) =>
      request<RentalMarketingPlan>(`/rental/v1/marketing-plans/${encodeURIComponent(id)}/end`, { method: "post", data, retryAuthentication: false }),
    saveValueAddedService: (data: SaveRentalValueAddedServiceRequest) =>
      request<RentalValueAddedService>(
        data.id ? `/rental/v1/value-added-services/${data.id}` : "/rental/v1/value-added-services",
        { method: data.id ? "put" : "post", data },
      ),
    saveServiceCapacity: (data: SaveRentalServiceCapacityRequest) =>
      request<RentalServiceCapacity>(
        data.id ? `/rental/v1/service-capacities/${data.id}` : "/rental/v1/service-capacities",
        { method: data.id ? "put" : "post", data },
      ),
    saveCouponTemplate: (data: SaveRentalCouponTemplateRequest) =>
      request<RentalCouponTemplate>(
        data.id ? `/rental/v1/coupon-templates/${data.id}` : "/rental/v1/coupon-templates",
        { method: data.id ? "put" : "post", data },
      ),
    claimCoupon: (templateId: string, customerId: string) =>
      request<RentalCustomerCoupon>("/rental/v1/customer-coupons/claim", {
        method: "post",
        data: { templateId, customerId },
      }),
    voidCustomerCoupon: (id: string, reason: string) =>
      request<RentalCustomerCoupon>(`/rental/v1/customer-coupons/${id}/void`, {
        method: "post",
        data: { reason },
      }),
  };
}

export type RentalCommercialApi = ReturnType<typeof createRentalCommercialApi>;
