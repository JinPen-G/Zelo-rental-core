/** 正式营销列表/详情、完整规则草稿、发布历史与空间策略入口。
 * 使用公共UIArc/Core页面和原请求链；页面不计算金额，不把编辑权当作发布权。 */
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CorePage, QueryState, useCorePageHost, type CoreAdminPageAction } from "@rental-os/platform-admin/core";
import { ActionButton, Alert, App, Button, DataTableRowActions, DataTableText, Form, Input,
  ListFilters, ListSection, Modal, RecordDetailLayout, RecordFacts, SaveButton, Select, Table, Tabs, useListFilter } from "@rental-os/platform-admin/ui";
import { useLocale } from "@rental-os/platform-admin/locale";
import { Pencil } from "lucide-react";
import { businessDateKey } from "@rental-os/rental-core/business-day";
import { marketingWindowLabels } from "./MarketingQualificationFields";
import { resolveCorePageLocation } from "@rental-os/core-contracts";
import { rentalPagePermissions } from "@rental-os/rental-core/permissions";
import { RENTAL_PRICING_UNIT_LABELS, type RentalMarketingPlan, type RentalMarketingPlanVersion, type RentalMarketingPricingPolicy,
  type RentalDiscountPlan, type ImportRentalMarketingPlanRequest } from "@rental-os/rental-core";
import { RENTAL_COMMERCIAL_PAGES } from "./pages";
import { RentalCommercialPageProvider, useRentalCommercialWorkspaceAccess, type RentalCommercialPageContext } from "./page-context";
import { MarketingPlanEditor, marketingActionLabels, marketingStatusLabels, marketingCustomerLabels, marketingDayLabels, type MarketingDraftValues } from "./MarketingPlanEditor";
import { useMarketingOperation, type MarketingAction } from "./marketing-operation";
import { useOrderEditor } from "../orders/useOrderEditor";
import { MarketingQuotePreview } from "./MarketingQuotePreview";

const editPermissions = [{ resource: "marketing", action: "edit" }, { resource: "marketing", action: "manage" }, { resource: "price", action: "manage" }];
const publishPermissions = [{ resource: "marketing", action: "publish" }];
const catalogPermissions = [{ resource: "catalog", action: "view" }, { resource: "catalog", action: "manage" },
  { resource: "order", action: "view" }, { resource: "order", action: "create" }];
const pricePermissions = [{ resource: "price", action: "manage" }];
const pricingReadPermissions = [...pricePermissions, { resource: "order", action: "view" }, { resource: "order", action: "create" }];
const legacyReadPermissions = [...pricePermissions, { resource: "marketing", action: "manage" }, { resource: "order", action: "view" }];
const actionLabels = { publish: "发布方案", pause: "暂停方案", end: "结束方案", change_policy: "切换空间策略" };
const policyLabels = { legacy: "旧优惠模式", single_rule_v1: "单规则最低价" };
const errorText = (error: unknown) => {
  const value = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof value === "string" ? value : error instanceof Error ? error.message : "操作失败，请保留输入后重试";
};
type Decision = { open: boolean; nonce: number } & ({ action: "change_policy"; policy: RentalMarketingPricingPolicy }
  | { action: "publish" | "pause" | "end"; plan: RentalMarketingPlan });
type DecisionValues = { changeReason: string; policy?: RentalMarketingPricingPolicy["policy"] };

function MarketingDecision({ decision, disabled, onSave, onClose, onExited, onError }: { decision: Decision; disabled: boolean;
  onSave: (value: DecisionValues) => Promise<unknown>; onClose: () => void; onExited: () => void; onError: (error: unknown) => void }) {
  const { t } = useLocale(), [form] = Form.useForm<DecisionValues>();
  const editor = useOrderEditor({ form, identity: String(decision.nonce), disabled: disabled || !decision.open, onSave, onError });
  return <Modal open={decision.open} title={t(actionLabels[decision.action])} onCancel={() => editor.dismiss(onClose)}
    afterClose={onExited} mask={{ closable: !editor.busy }} keyboard={!editor.busy}
    footer={<SaveButton form={form} label={t("确认提交")} pending={editor.busy} disabled={disabled || !decision.open} onSave={editor.submit} />}>
    <Form form={form} name="marketing-decision" layout="vertical" disabled={disabled || editor.busy} {...editor.formProps}
      initialValues={{ policy: decision.action === "change_policy" ? decision.policy.policy === "legacy" ? "single_rule_v1" : "legacy" : undefined }}>
      <Alert type={decision.action === "end" ? "warning" : "info"} title={t(decision.action === "change_policy"
        ? "切换只影响后续新报价，已有报价和订单继续使用原依据。"
        : decision.action === "publish" ? "发布完整草稿规则，后续新报价按已启用的空间策略使用。"
          : decision.action === "pause" ? "暂停后不再参与新报价，历史依据继续保留。" : "结束后不能继续编辑此方案，历史依据继续保留。")} />
      {decision.action === "change_policy" && <Form.Item name="policy" label={t("空间策略")} rules={[{ required: true }]}><Select
        options={Object.entries(policyLabels).map(([value, label]) => ({ value, label: t(label), disabled: value === decision.policy.policy }))} /></Form.Item>}
      <Form.Item name="changeReason" label={t("变更原因")} rules={[{ required: true, whitespace: true, max: 500 }]}><Input.TextArea maxLength={500} /></Form.Item>
    </Form>
  </Modal>;
}

type LegacyImportValues = Pick<ImportRentalMarketingPlanRequest, "sourcePlanId" | "sourceVersion" | "changeReason">;
function LegacyImport({ open, nonce, rows, disabled, onSave, onClose, onExited, onError }: {
  open: boolean; nonce: number; rows: RentalDiscountPlan[]; disabled: boolean;
  onSave: (value: LegacyImportValues) => Promise<unknown>; onClose: () => void; onExited: () => void; onError: (error: unknown) => void;
}) {
  const { t } = useLocale(), [form] = Form.useForm<LegacyImportValues>();
  const editor = useOrderEditor({ form, identity: String(nonce), disabled: disabled || !open, onSave, onError });
  return <Modal open={open} title={t("从旧方案建立草稿")} onCancel={() => editor.dismiss(onClose)} afterClose={onExited}
    mask={{ closable: !editor.busy }} keyboard={!editor.busy}
    footer={<SaveButton form={form} label={t("建立草稿")} pending={editor.busy} disabled={disabled || !open} onSave={editor.submit} />}>
    <Form form={form} name="marketing-legacy-import" layout="vertical" disabled={disabled || editor.busy} {...editor.formProps}>
      <Alert type="info" title={t("一份旧方案转换为一份草稿和一条规则；保留原版本及金额，不自动发布或切换空间策略。")}
        description={t("含跨方案叠加、禁用优惠券或非租金费用的旧方案不能等价转换，请明确新建。")} />
      <Form.Item name="sourcePlanId" label={t("旧优惠方案")} rules={[{ required: true }]}><Select options={rows.map(row => ({ value: row.id,
        label: `${row.name} · ${row.version}`, disabled: row.appliesTo !== "rental" || row.stackableWithOtherPlans || !row.stackableWithCoupon }))}
        onChange={id => form.setFieldValue("sourceVersion", rows.find(row => row.id === id)?.version)} /></Form.Item>
      <Form.Item name="sourceVersion" label={t("原版本")} rules={[{ required: true }]}><Input readOnly /></Form.Item>
      <Form.Item name="changeReason" label={t("变更原因")} rules={[{ required: true, whitespace: true, max: 500 }]}><Input.TextArea maxLength={500} /></Form.Item>
    </Form>
  </Modal>;
}

function MarketingVersion({ version, timeZone }: { version: RentalMarketingPlanVersion; timeZone?: string }) {
  const { t, locale } = useLocale();
  const at = (value?: string) => value ? timeZone ? new Date(value).toLocaleString(locale, { timeZone }) : value : t("未设置");
  const qualification = (value: RentalMarketingPlanVersion["qualification"]) => value && <RecordFacts items={[
    ...(["activityWindow", "bookingWindow", "rentalWindow"] as const).map((key, index) => ({ key, label: Object.values(marketingWindowLabels)[index],
      value: value[key] ? `${at(value[key]?.from)} ～ ${at(value[key]?.to)}` : t("未设置") })),
    { key: "bookingTime", label: "每日下单时段", value: value.bookingTime ? `${value.bookingTime.start}～${value.bookingTime.end}` : t("未设置") },
    { key: "rentalTime", label: "每日起租时段", value: value.rentalStartTime ? `${value.rentalStartTime.start}～${value.rentalStartTime.end}` : t("未设置") },
    { key: "advance", label: "提前预订小时", value: value.advanceBookingHours ? `${value.advanceBookingHours.minimum ?? "—"}～${value.advanceBookingHours.maximum ?? "—"}` : t("未设置") },
    { key: "pickup", label: "适用领取地点", value: ids(value.fulfillmentLocationIds) },
    { key: "return", label: "适用归还地点", value: ids(value.returnLocationIds) },
    { key: "modes", label: "适用履约方式", value: ids(value.fulfillmentModes) },
    { key: "source", label: "受信下单来源", value: ids(value.audiences) }
  ]} />;
  const ids = (values?: string[]) => values?.length ? values.join(" · ") : t("全部");
  const dayTypes = (values?: Array<keyof typeof marketingDayLabels>) => values?.length ? values.map(value => t(marketingDayLabels[value])).join(" · ") : t("全部");
  return <>
    {qualification(version.qualification)}
    {version.legacySource && <Alert type="info" title={t("旧单规则转换来源")}
      description={`${version.legacySource.plan.name} · ${version.legacySource.plan.id} · ${version.legacySource.plan.version}`} />}
    <RecordFacts items={[{ key: "name", label: "方案名称", value: version.name }, { key: "version", label: "版本", value: version.version },
      { key: "start", label: "用租开始时点下限", value: at(version.effectiveFrom) }, { key: "end", label: "用租开始时点上限", value: at(version.effectiveTo) },
      { key: "customer", label: "适用客户", value: t(marketingCustomerLabels[version.customerScope]) },
      { key: "items", label: "适用商品原标识", value: ids(version.applicableItemGroupIds) },
      { key: "pricing", label: "适用定价分组原标识", value: ids(version.applicablePricingGroupIds) },
      { key: "days", label: "适用日类型", value: dayTypes(version.applicableDayTypes) },
      { key: "minimum", label: "基础租金门槛", value: version.minimumSpend },
      { key: "priority", label: "同价优先级", value: version.priority }]} />
    <Table rowKey="id" dataSource={version.rules} pagination={false} columns={[
      { title: t("规则名称"), key: "name", render: (_, row) => <DataTableText primary={row.name} secondary={`${row.id} · ${row.version}`} /> },
      { title: t("规则状态"), dataIndex: "status", render: value => t(value === "enabled" ? "启用" : "停用") },
      { title: t("优惠方式"), key: "action", render: (_, row) => <DataTableText primary={t(marketingActionLabels[row.action.type])}
        secondary={row.action.type === "percentage" ? `${row.action.value}%` : String(row.action.value)} /> },
      { title: t("租期条件"), key: "duration", render: (_, row) => row.conditions.rentalDuration
        ? `${t(RENTAL_PRICING_UNIT_LABELS[row.conditions.rentalDuration.unit])} · ${row.conditions.rentalDuration.minimum ?? "—"}～${row.conditions.rentalDuration.maximum ?? "—"}` : t("未限制") },
      { title: t("同价优先级"), dataIndex: "priority" },
    ]} expandable={{ expandedRowRender: row => <>{qualification(row.conditions.qualification)}<RecordFacts items={[
      { key: "customer", label: "适用客户", value: row.conditions.customerScope ? t(marketingCustomerLabels[row.conditions.customerScope]) : t("沿方案公共条件") },
      { key: "items", label: "适用商品原标识", value: ids(row.conditions.applicableItemGroupIds) },
      { key: "pricing", label: "适用定价分组原标识", value: ids(row.conditions.applicablePricingGroupIds) },
      { key: "days", label: "适用日类型", value: dayTypes(row.conditions.applicableDayTypes) },
      { key: "minimum", label: "基础租金门槛", value: row.conditions.minimumSpend ?? t("未限制") },
      { key: "threshold", label: "满额门槛", value: row.action.thresholdAmount ?? t("未设置") },
      { key: "cap", label: "最大减免金额", value: row.action.maximumDiscount ?? t("未设置") },
      { key: "from", label: "用租开始时点下限", value: at(row.conditions.effectiveFrom) },
      { key: "to", label: "用租开始时点上限", value: at(row.conditions.effectiveTo) },
    ]} /></> }} />
  </>;
}

export function RentalMarketingPage(context: RentalCommercialPageContext) {
  const host = useCorePageHost();
  return <RentalCommercialPageProvider context={context}><MarketingWorkspace key={JSON.stringify([context.scopeKey, host.params?.planId])} /></RentalCommercialPageProvider>;
}

function MarketingWorkspace() {
  const { t, locale } = useLocale(), { message } = App.useApp();
  const access = useRentalCommercialWorkspaceAccess(rentalPagePermissions("discounts"));
  const { api, scope, host, canManage: canRead, assertManage: assertRead, isCurrentScope } = access;
  const any = (permissions: typeof editPermissions) => permissions.some(permission => host.canAccess("rental", [permission]));
  const canEdit = any(editPermissions), canPublish = any(publishPermissions), canCatalog = any(catalogPermissions), canPrice = any(pricingReadPermissions);
  const canReadLegacy = any(legacyReadPermissions);
  const locationPermissions = [{ resource: "station", action: "view" }], canLocations = any(locationPermissions);
  const [calendarDate] = useState(() => businessDateKey(new Date().toISOString(), "UTC"));
  const assertPermission = (permissions: typeof editPermissions) => { assertRead(); if (!any(permissions)) throw new Error(t("当前操作不可用")); };
  const read = async <Value,>(load: () => Promise<Value>, signal: AbortSignal, check = assertRead) => {
    check(); if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const value = await load(); check(); if (signal.aborted) throw new DOMException("Aborted", "AbortError"); return value;
  };
  const plans = useQuery({ queryKey: [scope, "marketing-plans"], enabled: Boolean(scope) && canRead,
    queryFn: ({ signal }) => read(() => api.marketingPlans({ signal }), signal) });
  const policy = useQuery({ queryKey: [scope, "marketing-policy"], enabled: Boolean(scope) && canRead,
    queryFn: ({ signal }) => read(() => api.marketingPricingPolicy({ signal }), signal) });
  const items = useQuery({ queryKey: [scope, "marketing-items", canCatalog], enabled: Boolean(scope) && canRead && canCatalog,
    queryFn: ({ signal }) => read(() => api.itemGroups({ signal }), signal, () => assertPermission(catalogPermissions)) });
  const pricing = useQuery({ queryKey: [scope, "marketing-rate-groups", canPrice], enabled: Boolean(scope) && canRead && canPrice,
    queryFn: ({ signal }) => read(() => api.pricingGroups({ signal }), signal, () => assertPermission(pricingReadPermissions)) });
  const locations = useQuery({ queryKey: [scope, "marketing-locations", canLocations], enabled: Boolean(scope) && canRead && canLocations,
    queryFn: ({ signal }) => read(() => api.locations({ signal }), signal, () => assertPermission(locationPermissions)) });
  const calendar = useQuery({ queryKey: [scope, "marketing-business-zone", calendarDate], enabled: Boolean(scope) && canRead,
    queryFn: ({ signal }) => read(() => api.marketingSchedule({ from: calendarDate, to: calendarDate }, { signal }), signal) });
  const timeZone = canRead && calendar.isSuccess && !calendar.isError ? calendar.data.timeZone : undefined;
  const planId = host.params?.planId;
  const selected = canRead && !plans.isError ? plans.data?.find(row => row.id === planId) : undefined;
  const history = useQuery({ queryKey: [scope, "marketing-history", planId, selected?.revision], enabled: Boolean(scope && selected && planId) && canRead,
    queryFn: ({ signal }) => read(() => api.marketingPlanHistory(planId!, { signal }), signal) });
  const operation = useMarketingOperation(access, assertRead);
  const [editing, setEditing] = useState<{ open: boolean; nonce: number; plan?: RentalMarketingPlan }>();
  const [importing, setImporting] = useState<{ open: boolean; nonce: number }>();
  const legacy = useQuery({ queryKey: [scope, "marketing-import-sources", canReadLegacy], enabled: Boolean(scope && importing?.open) && canEdit && canReadLegacy,
    queryFn: ({ signal }) => read(() => api.discountPlans({ signal }), signal, () => { assertPermission(editPermissions); assertPermission(legacyReadPermissions); }) });
  const [decision, setDecision] = useState<Decision>();
  const nonce = useRef(0);
  const rows = canRead && !plans.isError ? plans.data : undefined;
  const filter = useListFilter(rows, { fields: row => [row.code, row.draft?.name, row.published?.name], status: row => row.status });
  const report = (error: unknown) => { if (isCurrentScope()) message.error(t(errorText(error))); };
  const guarded = async <Value,>(work: () => Promise<Value>): Promise<Value> => { try { return await work(); } catch (error) { report(error); throw error; } };
  const refresh = async () => {
    assertRead();
    const results = await Promise.all([plans.refetch(), policy.refetch(), calendar.refetch(), ...(planId ? [history.refetch()] : [])]);
    assertRead(); if (results.some(result => result.isError)) throw new Error(t("营销资料刷新失败，请重试"));
  };
  const navigate = (id?: string) => {
    assertRead(); const target = id ? RENTAL_COMMERCIAL_PAGES.marketingPlanDetail : RENTAL_COMMERCIAL_PAGES.discounts;
    if (!host.canAccess("rental", target.permissions)) throw new Error(t("当前页面不可用"));
    host.navigate(resolveCorePageLocation(host.pages, { coreId: "rental", pageId: target.id, params: id ? { planId: id } : undefined }));
  };
  const openEditor = (plan?: RentalMarketingPlan) => {
    assertPermission(editPermissions);
    if (operation.blocked || plans.isError || !plans.data || plan?.status === "ended" || !timeZone) return;
    setEditing({ open: true, nonce: ++nonce.current, plan: plan ? structuredClone(plan) : undefined });
  };
  const openDecision = (action: Exclude<MarketingAction, "save_draft" | "change_policy">, plan: RentalMarketingPlan) => {
    assertPermission(publishPermissions); if (operation.blocked || plans.isError) return;
    setDecision({ open: true, nonce: ++nonce.current, action, plan: structuredClone(plan) });
  };
  const save = async (values: MarketingDraftValues) => guarded(async () => {
    if (!editing?.open || !timeZone) throw new Error(t("当前操作不可用"));
    const original = editing;
    const result = await operation.run("save_draft", original.plan?.id, original.plan?.revision ?? 0,
      () => assertPermission(editPermissions), operationId => api.saveMarketingPlanDraft({ ...values, operationId,
        id: original.plan?.id, expectedRevision: original.plan?.revision ?? 0 }));
    assertRead(); setEditing(current => current?.nonce === original.nonce ? { ...current, open: false } : current);
    await refresh(); return result;
  });
  const importLegacy = async (values: LegacyImportValues) => guarded(async () => {
    if (!importing?.open || legacy.isError || !legacy.data) throw new Error(t("当前操作不可用"));
    const original = importing;
    const result = await operation.run("save_draft", undefined, 0, () => { assertPermission(editPermissions); assertPermission(legacyReadPermissions); },
      operationId => api.importLegacyMarketingPlan({ ...values, operationId, expectedRevision: 0 }));
    assertRead(); setImporting(current => current?.nonce === original.nonce ? { ...current, open: false } : current);
    await refresh(); navigate(result.id); return result;
  });
  const decide = async (values: DecisionValues) => guarded(async () => {
    if (!decision?.open) throw new Error(t("当前操作不可用"));
    const original = decision;
    if (original.action === "change_policy") {
      if (!values.policy || values.policy === original.policy.policy) throw new Error(t("请选择不同的空间策略"));
      await operation.run("change_policy", undefined, original.policy.revision, () => assertPermission(publishPermissions), operationId =>
        api.changeMarketingPricingPolicy({ operationId, expectedRevision: original.policy.revision, policy: values.policy!, changeReason: values.changeReason }));
    } else await operation.run(original.action, original.plan.id, original.plan.revision, () => assertPermission(publishPermissions), operationId => {
      const input = { operationId, expectedRevision: original.plan.revision, changeReason: values.changeReason };
      return original.action === "publish" ? api.publishMarketingPlan(original.plan.id, input)
        : original.action === "pause" ? api.pauseMarketingPlan(original.plan.id, input) : api.endMarketingPlan(original.plan.id, input);
    });
    assertRead(); setDecision(current => current?.nonce === original.nonce ? { ...current, open: false } : current);
    await refresh();
  });
  const pageActions: CoreAdminPageAction<Record<string, unknown>>[] = [
    ...(!planId && canEdit && canReadLegacy ? [{ id: "import-legacy", kind: "open" as const, label: { default: "从旧方案建立草稿" }, slot: "tools" as const,
      disabled: operation.blocked || plans.isError, open: () => { assertPermission(editPermissions); assertPermission(legacyReadPermissions); setImporting({ open: true, nonce: ++nonce.current }); } }] : []),
    { id: "marketing-calendar", kind: "navigate", label: { default: "活动日历" }, slot: "tools", to: { coreId: "rental", pageId: "marketing-calendar" } },
    ...(canEdit ? [{ id: "edit-marketing", kind: "open" as const, label: { default: selected ? "编辑草稿" : "新建营销方案" }, emphasis: "primary" as const,
      disabled: operation.blocked || plans.isError || !plans.data || !timeZone || Boolean(planId && !selected) || selected?.status === "ended",
      open: () => openEditor(selected) }] : []),
    { id: "refresh-marketing", kind: "command", label: { default: "刷新" }, execute: () => guarded(refresh), pending: plans.isFetching || policy.isFetching },
    ...(planId ? [{ id: "back-marketing", kind: "navigate" as const, label: { default: "返回列表" }, slot: "navigation" as const,
      to: { coreId: "rental", pageId: "discounts" } }] : [{ id: "legacy-marketing", kind: "navigate" as const, label: { default: "旧优惠方案" }, slot: "tools" as const,
      permissions: pricePermissions, to: { coreId: "rental", pageId: "legacy-discounts" } }]),
  ];
  if (selected && canPublish && selected.status !== "ended") {
    for (const action of ([...(selected.draft ? ["publish" as const] : []), ...(selected.status === "enabled" ? ["pause" as const] : []), ...(selected.published ? ["end" as const] : [])]))
      pageActions.push({ id: `marketing-${action}`, kind: "open", label: { default: actionLabels[action] }, permissions: publishPermissions,
        disabled: operation.blocked || plans.isError, open: () => openDecision(action, selected) });
  }
  const pending = operation.pending || operation.storageFailure ? <Alert type="warning" title={t(operation.storageFailure || "原营销操作结果待核对")}
    description={operation.pending?.operationId} action={operation.pending && <ActionButton label={t("核对原操作")} variant="secondary"
      pending={operation.busy} onAction={() => guarded(async () => { const id = await operation.reconcile(); await refresh(); if (id) navigate(id); })} />} /> : null;
  const header = <CorePage title={planId && selected ? selected.draft?.name ?? selected.published?.name ?? selected.code : undefined} actions={pageActions}
    summary={t("基础定价 → 单条最低营销价 → 优惠券")}>{pending}</CorePage>;
  const body = <QueryState loading={plans.isPending} error={plans.error} onRetry={refresh} transitionKey={`${scope}:${planId ?? "list"}`}>
    {planId ? selected ? <Tabs items={[
      { key: "published", label: t("已发布版本"), children: selected.published ? <MarketingVersion version={selected.published} timeZone={timeZone} /> : <Alert type="info" title={t("尚未发布，草稿不参与报价")} /> },
      ...(selected.draft ? [{ key: "draft", label: t("当前草稿"), children: <MarketingVersion version={selected.draft} timeZone={timeZone} /> }] : []),
      { key: "preview", label: t("金额试算"), children: <MarketingQuotePreview plans={plans.data ?? []} planId={planId} /> },
      { key: "history", label: t("版本与操作记录"), children: <QueryState loading={history.isPending} error={history.error} onRetry={refresh}>
        {!history.isError && <Table rowKey="id" dataSource={history.data?.events ?? []} pagination={false} columns={[
          { title: t("修订"), dataIndex: "revision" }, { title: t("动作"), dataIndex: "action", render: (value: MarketingAction) => t(value === "save_draft" ? "保存草稿" : actionLabels[value]) },
          { title: t("发布版本"), dataIndex: "publishedVersion" }, { title: t("操作者"), dataIndex: "actorUserId" },
          { title: t("原因"), dataIndex: "reason" }, { title: t("时间"), dataIndex: "at", render: value => new Date(value).toLocaleString(locale) },
        ]} expandable={{ rowExpandable: row => Boolean(row.publishedVersion && history.data?.versions.some(version => version.version === row.publishedVersion)),
          expandedRowRender: row => { const version = history.data?.versions.find(item => item.version === row.publishedVersion); return version ? <MarketingVersion version={version} timeZone={timeZone} /> : null; } }} />}
      </QueryState> },
    ]} /> : <Alert type="info" title={t("当前范围内未找到营销方案")} /> : <>
      <QueryState loading={policy.isPending} error={policy.error} onRetry={refresh}>
        {canRead && !policy.isError && policy.data && <ListSection title={t("空间营销策略")} extra={canPublish && <Button disabled={operation.blocked}
          onClick={() => { assertPermission(publishPermissions); if (policy.data) setDecision({ open: true, nonce: ++nonce.current, action: "change_policy", policy: structuredClone(policy.data) }); }}>{t("切换策略")}</Button>}>
          <RecordFacts items={[{ key: "policy", label: "当前模式", value: t(policyLabels[policy.data.policy]) }, { key: "revision", label: "修订", value: policy.data.revision }]} />
        </ListSection>}
      </QueryState>
      <ListSection title={t("营销方案")} controls={<ListFilters filter={filter} placeholder={t("搜索方案名称或编码")}
        options={Object.entries(marketingStatusLabels).map(([value, label]) => ({ value, label: t(label) }))} />}>
        <Table rowKey="id" dataSource={filter.rows} loading={plans.isFetching} pagination={filter.pagination} columns={[
          { title: t("方案名称"), key: "name", render: (_, row) => <DataTableText primary={row.draft?.name ?? row.published?.name ?? row.code} secondary={row.code} /> },
          { title: t("状态"), dataIndex: "status", render: (value: RentalMarketingPlan["status"]) => t(marketingStatusLabels[value]) },
          { title: t("发布版本"), key: "version", render: (_, row) => row.published?.version ?? t("未发布") },
          { title: t("已发布规则数"), key: "rules", render: (_, row) => row.published?.rules.length ?? "—" },
          { title: t("有效期"), key: "range", render: (_, row) => { const version = row.published ?? row.draft; return version ? <DataTableText
            primary={timeZone ? new Date(version.effectiveFrom).toLocaleString(locale, { timeZone }) : version.effectiveFrom} secondary={version.effectiveTo ? timeZone ? new Date(version.effectiveTo).toLocaleString(locale, { timeZone }) : version.effectiveTo : t("长期有效")} /> : "—"; } },
          { title: t("适用范围"), key: "scope", render: (_, row) => { const version = row.published ?? row.draft; return version
            ? t("商品 {items} · 定价组 {groups}", { items: version.applicableItemGroupIds.length || t("全部"), groups: version.applicablePricingGroupIds?.length || t("全部") }) : "—"; } },
          { title: t("修订"), dataIndex: "revision" },
          { title: t("操作"), key: "actions", render: (_, row) => <DataTableRowActions details={() => navigate(row.id)} detailLabel={t("详情")} menuLabel={t("更多操作")}
            actions={canEdit ? [{ id: "edit", label: t("编辑草稿"), icon: Pencil, disabled: operation.blocked || row.status === "ended" || !timeZone, onSelect: () => openEditor(row) }] : []} /> },
        ]} />
      </ListSection>
    </>}
  </QueryState>;
  return <>
    {canRead ? planId ? <RecordDetailLayout title={selected?.code ?? t("营销方案详情")} header={header} onBack={() => navigate()}
      status={selected && t(marketingStatusLabels[selected.status])}>{body}</RecordDetailLayout> : <>{header}{body}</> : <Alert type="warning" title={t("当前页面不可用")} />}
    {canRead && calendar.isError && <Alert type="error" title={t("营业时区不可用，时间字段暂不可编辑")} action={<Button onClick={() => calendar.refetch()}>{t("重试")}</Button>} />}
    {canRead && editing && <MarketingPlanEditor key={editing.nonce} open={editing.open} plan={editing.plan}
      references={{ items: canCatalog && items.isSuccess && !items.isError ? items.data.map(row => ({ value: row.id, label: row.name })) : undefined,
        pricing: canPrice && pricing.isSuccess && !pricing.isError ? pricing.data.map(row => ({ value: row.id, label: row.name })) : undefined,
        locations: canLocations && locations.isSuccess && !locations.isError ? locations.data.filter(row => row.status === "enabled").map(row => ({ value: row.id, label: row.name })) : undefined, timeZone }}
      disabled={!canEdit || operation.blocked || !editing.open || !timeZone} onSave={save} onClose={() => setEditing(current => current ? { ...current, open: false } : current)}
      onExited={() => setEditing(current => current?.open ? current : undefined)} onError={report} />}
    {canRead && decision && <MarketingDecision key={decision.nonce} decision={decision} disabled={!canPublish || operation.blocked}
      onSave={decide} onClose={() => setDecision(current => current ? { ...current, open: false } : current)}
      onExited={() => setDecision(current => current?.open ? current : undefined)} onError={report} />}
    {canRead && importing && <>
      {legacy.isError && <Alert type="error" title={t("旧方案读取失败")} action={<Button onClick={() => legacy.refetch()}>{t("重试")}</Button>} />}
      <LegacyImport key={importing.nonce} open={importing.open} nonce={importing.nonce} rows={legacy.isError || !canReadLegacy ? [] : legacy.data ?? []}
        disabled={!canEdit || !canReadLegacy || operation.blocked || !legacy.isSuccess || legacy.isFetching} onSave={importLegacy}
        onClose={() => setImporting(current => current ? { ...current, open: false } : current)} onExited={() => setImporting(current => current?.open ? current : undefined)} onError={report} />
    </>}
  </>;
}
