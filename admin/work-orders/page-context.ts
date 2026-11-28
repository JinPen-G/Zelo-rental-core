/** 原宿主和标准 Core 路由提供同一组工单事实与受控导航，页面不拥有认证或范围解析。 */
import type { RentalWorkOrderApi } from "./client";

export interface RentalWorkOrderPageContext {
  api: RentalWorkOrderApi;
  /** 来自当前会话、经营空间及权限快照，用于既有查询和浏览器看板布局隔离。 */
  scopeKey: string;
  currentScopeKey: () => string | undefined;
  /** 宿主验证后的租户/空间/用户稳定键，刷新后定位原操作；不是会话代次或授权。 */
  operationScopeKey?: string;
  permissions: {
    manage: boolean;
    review: boolean;
    viewOrders: boolean;
    restore: boolean;
  };
  /** 目标由宿主已登记的 Rental 订单路由生成，页面不接受模型提供的 URL。 */
  openOrder: (orderId: string) => void;
}
