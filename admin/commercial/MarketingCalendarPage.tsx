/** 正式活动日程消费服务端营业日投影；公共日期/表格组件负责浏览，不在前端重算命中或拖动发布数据。 */
import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { useQuery } from "@tanstack/react-query";
import { CorePage, QueryState } from "@rental-os/platform-admin/core";
import { Alert, Button, DatePicker, DataTableText, ListSection, ListFilterBar, ListFilterItem, RecordFacts, Select, Table, Tabs } from "@rental-os/platform-admin/ui";
import { useLocale } from "@rental-os/platform-admin/locale";
import { resolveCorePageLocation } from "@rental-os/core-contracts";
import type { RentalMarketingSchedule, RentalMarketingScheduleQuery } from "@rental-os/rental-core";
import { rentalPagePermissions } from "@rental-os/rental-core/permissions";
import { RentalCommercialPageProvider, useRentalCommercialWorkspaceAccess, type RentalCommercialPageContext } from "./page-context";
import { marketingDayLabels, marketingStatusLabels } from "./MarketingPlanEditor";
import { marketingWindowLabels } from "./MarketingQualificationFields";

export function MarketingCalendarPage(context: RentalCommercialPageContext) {
  return <RentalCommercialPageProvider context={context}><CalendarWorkspace key={context.scopeKey} /></RentalCommercialPageProvider>;
}
function CalendarWorkspace() {
  const { t, locale } = useLocale();
  const { api, scope, host, canManage, assertManage } = useRentalCommercialWorkspaceAccess(rentalPagePermissions("marketing-calendar"));
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().startOf("month"), dayjs().endOf("month")]);
  const [status, setStatus] = useState<RentalMarketingScheduleQuery["status"]>();
  const [dayType, setDayType] = useState<RentalMarketingScheduleQuery["dayType"]>();
  const [windowKind, setWindowKind] = useState<NonNullable<RentalMarketingScheduleQuery["windowKind"]>>("rental");
  const query = { from: range[0].format("YYYY-MM-DD"), to: range[1].format("YYYY-MM-DD"), status, dayType, windowKind };
  const result = useQuery({ queryKey: [scope, "marketing-schedule", query], enabled: Boolean(scope) && canManage,
    queryFn: async ({ signal }) => { assertManage(); const value = await api.marketingSchedule(query, { signal }); assertManage();
      if (signal.aborted) throw new DOMException("Aborted", "AbortError"); return value; } });
  const data = canManage && !result.isError ? result.data : undefined;
  const days = new Map<string, RentalMarketingSchedule["rows"]>();
  for (const row of data?.rows ?? []) { const group = days.get(row.date) ?? []; group.push(row); days.set(row.date, group); }
  const time = (value?: string) => value && data ? new Intl.DateTimeFormat(locale, { timeZone: data.timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : t("未设置");
  const navigate = (planId: string) => { assertManage(); host.navigate(resolveCorePageLocation(host.pages, { coreId: "rental", pageId: "marketing-plan-detail", params: { planId } })); };
  if (!canManage) return <Alert type="warning" title={t("当前页面不可用")} />;
  return <>
    <CorePage summary={t("活动日程按营业时区展示；价格与最终资格请用正式试算核对。")}
      actions={[{ id: "refresh", kind: "command", label: { default: "刷新" }, pending: result.isFetching,
        execute: async () => { assertManage(); const value = await result.refetch(); assertManage(); if (value.error) throw value.error; } },
      { id: "back", kind: "navigate", slot: "navigation", label: { default: "返回列表" }, to: { coreId: "rental", pageId: "discounts" } }]}>{null}</CorePage>
    <Tabs activeKey={windowKind} onChange={value => setWindowKind(value as typeof windowKind)}
      items={Object.entries(marketingWindowLabels).map(([key, label]) => ({ key, label: t(label) }))} />
    <ListSection title={t("活动区间")} controls={<ListFilterBar>
      <ListFilterItem label={t("营业日期范围")} width="dateRange"><DatePicker.RangePicker allowClear={false} value={range}
        onChange={value => { if (value?.[0] && value[1]) setRange([value[0], value[1]]); }} /></ListFilterItem>
      <ListFilterItem label={t("状态")}><Select allowClear value={status} onChange={setStatus} placeholder={t("全部")}
        options={Object.entries(marketingStatusLabels).map(([value, label]) => ({ value, label: t(label) }))} /></ListFilterItem>
      <ListFilterItem label={t("适用日类型")}><Select allowClear value={dayType} onChange={setDayType} placeholder={t("全部")}
        options={Object.entries(marketingDayLabels).map(([value, label]) => ({ value, label: t(label) }))} /></ListFilterItem>
    </ListFilterBar>}>
      <QueryState loading={result.isPending} error={result.error} onRetry={result.refetch} transitionKey={JSON.stringify(query)}>
        {data && <>
          <RecordFacts items={[{ key: "zone", label: "营业时区", value: data.timeZone },
            { key: "window", label: "时间范围", value: t(marketingWindowLabels[windowKind]) },
            { key: "basis", label: "判定依据", value: t(windowKind === "rental" ? "起租时点及完整租期共同约束；日类型仍需核整段租期" : "活动与下单窗按服务端本次报价时点判断，仍需同时满足用租条件") }]} />
          <Table rowKey="date" dataSource={[...days].map(([date, rows]) => ({ date, rows }))} pagination={{ pageSize: 14 }}
            locale={{ emptyText: t("所选日期和筛选条件内没有活动区间") }} columns={[
              { title: t("营业日期"), dataIndex: "date" },
              { title: t("适用日类型"), key: "dayType", render: (_, row) => t(marketingDayLabels[row.rows[0].dayType]) },
              { title: t("规则区间数"), key: "count", render: (_, row) => row.rows.length },
            ]} expandable={{ expandedRowRender: day => <Table rowKey="id" dataSource={day.rows} pagination={{ pageSize: 10 }} columns={[
              { title: t("方案与规则"), key: "name", render: (_, row) => <DataTableText primary={`${row.planName} · ${row.ruleName}`} secondary={`${row.planVersion} · ${row.ruleVersion}`} /> },
              { title: t("当日区间"), key: "range", render: (_, row) => <DataTableText primary={time(row.visibleFrom)} secondary={time(row.visibleTo)} /> },
              { title: t("状态"), key: "status", render: (_, row) => <DataTableText primary={t(marketingStatusLabels[row.planStatus])}
                secondary={t(row.ruleStatus === "disabled" ? "规则已停用" : row.dayCondition === "not_evaluated" ? "用租日类型须按实际租期判断" : row.dayCondition === "excluded" ? "该日类型不在规则范围" : "该日类型在规则范围")} /> },
              { title: t("发布时点"), key: "published", render: (_, row) => row.versionKind === "draft" ? t("尚未发布，草稿不参与报价") : time(row.publishedAt) },
              { title: t("完整时间范围"), key: "original", render: (_, row) => <DataTableText primary={row.windowFrom ? time(row.windowFrom) : t("无下限")} secondary={row.windowTo ? time(row.windowTo) : t("无上限")} /> },
              { title: t("原规则时段"), key: "clock", render: (_, row) => row.clockWindows.length ? row.clockWindows.map(value => `${value.start}～${value.end}`).join(" ∩ ") : t("全天") },
              { title: t("完整租期终点上限"), key: "end", render: (_, row) => row.rentalEndTo ? time(row.rentalEndTo) : t("未设置") },
              { title: t("操作"), key: "action", render: (_, row) => <Button type="link" onClick={() => navigate(row.planId)}>{t("查看方案与规则")}</Button> },
            ]} /> }} />
        </>}
      </QueryState>
    </ListSection>
  </>;
}
