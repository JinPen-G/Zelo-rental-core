/** 单车/资产详情只组合原受权资产、状态历史与工单读取。
 * 路由仅定位对象；每项读取和导航复核当前会话及原权限，库存释放仍走原工单流程。 */
import { useLayoutEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { corePageKey, resolveCorePageLocation, type CorePageLocation } from "@rental-os/core-contracts";
import { CorePage, QueryState, useCorePageHost, type CoreAdminPageAction } from "@rental-os/platform-admin/core";
import { useLocale } from "@rental-os/platform-admin/locale";
import { Alert, ArrowLeftOutlined, Button, DataTableStatus, DataTableText, ListSection, RecordDetailLayout,
  RecordDetailStack, Table, Tabs } from "@rental-os/platform-admin/ui";
import type { RentalAssetStatusHistory, RentalWorkOrder, RentalWorkOrderType } from "@rental-os/rental-core";
import type { RentalCatalogPageContext } from "./page-context";
import { rentalAssetLocation, RENTAL_CATALOG_PAGES } from "./pages";
import { rentalWorkOrderLocation } from "../work-orders/pages";

const statusLabels: Record<string, string> = { available: "可用", reserved: "已预占", rented: "租赁中",
  inspection: "检查中", maintenance: "维护中", disabled: "停用" };
const sourceLabels: Record<RentalAssetStatusHistory["source"], string> = {
  onboarding: "资产登记", manual: "资料维护", order: "订单流程", disposition: "归还处置"
};
const workTypes: Record<RentalWorkOrderType, string> = { cleaning: "清洁", restock: "补货/缺件", calibration: "校准", repair: "维修" };
const workStatuses: Record<string, string> = { pending: "待处理", in_progress: "处理中", pending_review: "待验收",
  completed: "已完成", rejected: "验收驳回", cancelled: "已取消" };
// 原接口未供给营业时区，不用浏览器时区重解释历史；保留事实自带的偏移。
const recordedTime = (value: string) => <time dateTime={value}>{value.replace("T", " ").replace(/Z$/u, " UTC")}</time>;

export function AssetDetailPage(context: RentalCatalogPageContext) {
  const { assetId = "" } = useParams<{ assetId: string }>();
  return <AssetDetailBody key={JSON.stringify([context.scopeKey, assetId])} {...context} assetId={assetId} />;
}

function AssetDetailBody({ api, scopeKey, currentScopeKey, assetId }: RentalCatalogPageContext & { assetId: string }) {
  const host = useCorePageHost(), { t } = useLocale();
  const [tab, setTab] = useState("history");
  const active = useRef(false), live = useRef({ host, scopeKey, assetId });
  live.current = { host, scopeKey, assetId };
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const sameScope = () => Boolean(scopeKey) && currentScopeKey() === scopeKey
    && live.current.scopeKey === scopeKey && live.current.assetId === assetId;
  const canRead = () => sameScope() && (
    live.current.host.canAccess("rental", [{ resource: "asset", action: "view" }])
    || live.current.host.canAccess("rental", [{ resource: "asset", action: "manage" }]));
  const canReadWork = () => canRead() && live.current.host.canAccess("rental", [{ resource: "maintenance", action: "view" }]);
  const assertRead = (work = false) => {
    if (!active.current || !(work ? canReadWork() : canRead())) throw new DOMException(t("当前资产页面已失效"), "AbortError");
  };
  const asset = useQuery({ queryKey: ["rental-core", "asset-detail", scopeKey, assetId], enabled: Boolean(assetId) && canRead(), retry: false,
    queryFn: async ({ signal }) => { assertRead(); const rows = await api.assets({ signal }); assertRead(); return rows.find(row => row.id === assetId) ?? null; } });
  const current = canRead() && !asset.isError && asset.data?.id === assetId ? asset.data : undefined;
  const visibleAsset = useRef(current); visibleAsset.current = current;
  const history = useQuery({ queryKey: ["rental-core", "asset-status-history", assetId, scopeKey],
    enabled: Boolean(current) && tab === "history", retry: false,
    queryFn: async ({ signal }) => { assertRead(); const rows = await api.assetStatusHistory(assetId, { signal }); assertRead(); return rows; } });
  const workOrders = useQuery({ queryKey: ["rental-core", "asset-work-orders", scopeKey, assetId],
    enabled: Boolean(current) && canReadWork() && tab === "work", retry: false,
    queryFn: async ({ signal }) => { assertRead(true); const rows = await api.workOrders(undefined, { signal }); assertRead(true); return rows.filter(row => row.assetId === assetId); } });
  const canOpen = (target: CorePageLocation) => {
    const page = live.current.host.pages.get(corePageKey(target.coreId, target.pageId));
    return Boolean(page && live.current.host.canAccess(target.coreId, page.definition.permissions));
  };
  const navigate = (target: CorePageLocation, selectedAsset = false) => {
    if (!active.current || !canRead() || !canOpen(target) || selectedAsset && !visibleAsset.current) return;
    const path = resolveCorePageLocation(live.current.host.pages, target);
    live.current.host.navigate(selectedAsset ? `${path}?${new URLSearchParams({ assetId })}` : path);
  };
  const actions: CoreAdminPageAction<unknown>[] = [{ id: "back-assets", kind: "open", slot: "navigation", label: { default: t("返回列表") },
    permissions: RENTAL_CATALOG_PAGES.assets.permissions, icon: <ArrowLeftOutlined />, open: () => navigate(rentalAssetLocation()) }];
  if (canRead()) actions.push({ id: "refresh-asset", kind: "command", slot: "tools", label: { default: t("刷新") }, intent: "refresh",
    permissions: RENTAL_CATALOG_PAGES.assetDetail.permissions, pending: asset.isFetching || history.isFetching || workOrders.isFetching,
    execute: async () => {
      assertRead(); const result = await asset.refetch({ throwOnError: true }); assertRead();
      if (!result.data) return;
      if (tab === "history") await history.refetch({ throwOnError: true });
      if (tab === "work" && canReadWork()) await workOrders.refetch({ throwOnError: true });
    } });
  const schedule = { coreId: "rental", pageId: RENTAL_CATALOG_PAGES.schedule.id };
  if (current && canOpen(schedule)) actions.push({ id: "asset-schedule", kind: "open", label: { default: t("查看排班") },
    permissions: RENTAL_CATALOG_PAGES.schedule.permissions, open: () => navigate(schedule, true) });
  if (current && canReadWork() && canOpen(rentalWorkOrderLocation())) actions.push({ id: "asset-maintenance", kind: "open",
    label: { default: t("养护管控") }, permissions: [{ resource: "maintenance", action: "view" }], open: () => navigate(rentalWorkOrderLocation(), true) });
  const title = current?.assetNo ?? t("资产详情");
  return <RecordDetailLayout title={title} onBack={() => navigate(rentalAssetLocation())}
    header={<CorePage title={title} actions={actions}>{null}</CorePage>}
    status={current && <DataTableStatus tone={current.status === "maintenance" || current.status === "inspection" ? "warning" : "neutral"}>
      {t(statusLabels[current.status] ?? current.status)}</DataTableStatus>}
    facts={current ? [{ key: "model", label: t("型号"), value: current.itemGroupName }, { key: "location", label: t("地点"), value: current.locationName },
      { key: "serial", label: t("序列号"), value: current.serialNo || t("未登记序列号") },
      { key: "updated", label: t("更新时间"), value: recordedTime(current.updatedAt) }] : undefined}>
    {!canRead() ? <Alert type="warning" showIcon title={t("资产读取受限")} /> : <QueryState loading={asset.isLoading} error={asset.error}
      onRetry={() => { assertRead(); return asset.refetch({ throwOnError: true }); }} transitionKey={`${scopeKey}:${assetId}`}>
      {!current ? <Alert type="warning" showIcon title={t("未找到当前范围内的资产")} /> : <RecordDetailStack>
        {(current.status === "maintenance" || current.status === "inspection" || current.status === "disabled") && <Alert type="warning" showIcon
          title={t("该资产当前存在库存限制")} description={t("工单完成或计划时间到达不等于恢复可租，请以原验收和库存结果为准。")} />}
        <Tabs aria-label={t("资产详情")} activeKey={tab} onChange={setTab} items={[
          { key: "history", label: t("状态历史"), children: <ListSection>
            <QueryState loading={history.isLoading} error={history.error} onRetry={() => { assertRead(); return history.refetch({ throwOnError: true }); }}>
              <Table<RentalAssetStatusHistory> rowKey="id" dataSource={history.isError ? undefined : history.data} pagination={{ pageSize: 10 }}
                refreshing={history.isFetching} onRefresh={() => { assertRead(); return history.refetch({ throwOnError: true }); }}
                locale={{ emptyText: t("暂无已登记的状态历史") }} columns={[
                  { title: t("时间"), dataIndex: "createdAt", render: recordedTime },
                  { title: t("状态变化"), render: (_: unknown, row) => `${row.fromStatus ? t(statusLabels[row.fromStatus] ?? row.fromStatus) : "—"} → ${t(statusLabels[row.toStatus] ?? row.toStatus)}` },
                  { title: t("来源"), dataIndex: "source", render: (value: RentalAssetStatusHistory["source"]) => t(sourceLabels[value]) },
                  { title: t("原因"), dataIndex: "reason" }, { title: t("操作人"), dataIndex: "operator" }
                ]} />
              <p className="muted">{t("显示最近200条原状态记录；记录缺失不代表过去没有限制。")}</p>
            </QueryState>
          </ListSection> },
          { key: "work", label: t("养护工单"), children: !canReadWork() ? <Alert type="info" showIcon title={t("养护记录读取受限")} /> : <ListSection>
            <QueryState loading={workOrders.isLoading} error={workOrders.error} onRetry={() => { assertRead(true); return workOrders.refetch({ throwOnError: true }); }}>
              <Table<RentalWorkOrder> rowKey="id" dataSource={workOrders.isError ? undefined : workOrders.data} pagination={{ pageSize: 10 }}
                refreshing={workOrders.isFetching} onRefresh={() => { assertRead(true); return workOrders.refetch({ throwOnError: true }); }}
                locale={{ emptyText: t("当前范围内没有该资产的养护工单") }} columns={[
                  { title: t("工单号"), dataIndex: "workNo", render: (value: string, row) => <DataTableText primary={value} secondary={t(workTypes[row.type])} /> },
                  { title: t("状态"), dataIndex: "status", render: (value: string) => t(workStatuses[value] ?? value) },
                  { title: t("处理原因"), dataIndex: "reason" },
                  { title: t("负责人"), render: (_: unknown, row) => row.assigneeName || t("未派工") },
                  { title: t("更新时间"), dataIndex: "updatedAt", render: recordedTime },
                  { title: t("操作"), render: (_: unknown, row) => canOpen(rentalWorkOrderLocation(row.id))
                    ? <Button onClick={() => { assertRead(true); navigate(rentalWorkOrderLocation(row.id), true); }}>{t("查看工单")}</Button> : t("来源读取受限") }
                ]} />
            </QueryState>
          </ListSection> }
        ]} />
      </RecordDetailStack>}
    </QueryState>}
  </RecordDetailLayout>;
}
