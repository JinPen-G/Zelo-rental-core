/** 甘特到原续租表单的一次性时间建议，仅保存在当前页面运行实例内。
 * 引用不是授权或操作收据；刷新后不恢复，使用前仍核当前范围及原订单事实。 */
import type { RentalOrder } from "@rental-os/rental-core";
import { isValidTimeZone } from "@rental-os/rental-core/business-day";

export interface OrderExtensionPreparation {
  orderId: string;
  status: RentalOrder["status"];
  fulfillmentMode: RentalOrder["fulfillmentMode"];
  originalEndAt: string;
  newEndAt: string;
  timeZone: string;
}
let pending: { key: string; value: Readonly<OrderExtensionPreparation>; isCurrentScope: () => boolean } | undefined;

export function extendedOrderEndAt(originalEndAt: string, minutes: number): string | undefined {
  const end = Date.parse(originalEndAt) + minutes * 60000;
  return Number.isSafeInteger(minutes) && minutes > 0 && Number.isFinite(end) && Math.abs(end) <= 8640000000000000
    ? new Date(end).toISOString() : undefined;
}

export function retainOrderExtensionPreparation(value: OrderExtensionPreparation, isCurrentScope: () => boolean): string {
  const from = Date.parse(value.originalEndAt), to = Date.parse(value.newEndAt);
  if (!isCurrentScope() || !value.orderId || !["ready_for_pickup", "renting"].includes(value.status)
    || value.fulfillmentMode === "carrier_shipping" || !Number.isFinite(from) || !Number.isFinite(to) || to <= from
    || !isValidTimeZone(value.timeZone)) throw new Error("排班续租建议已失效，请重新核对");
  const key = crypto.randomUUID();
  pending = { key, value: Object.freeze({ ...value }), isCurrentScope };
  return key;
}

export function readOrderExtensionPreparation(key: string | null, order: Pick<RentalOrder, "id" | "status" | "fulfillmentMode" | "endAt" | "effectiveEndAt">): Readonly<OrderExtensionPreparation> | undefined {
  if (!key || pending?.key !== key) return undefined;
  const { value, isCurrentScope } = pending;
  if (!isCurrentScope() || value.orderId !== order.id || value.status !== order.status || value.fulfillmentMode !== order.fulfillmentMode
    || Date.parse(value.originalEndAt) !== Date.parse(order.effectiveEndAt ?? order.endAt)) {
    pending = undefined;
    return undefined;
  }
  return value;
}

export function discardOrderExtensionPreparation(key: string | null): void {
  if (pending?.key === key) pending = undefined;
}
