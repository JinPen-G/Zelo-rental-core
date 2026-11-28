/** 管控中心组合原资产范围、冻结管控和工单导航。服务端裁定冲突/验收；
 * 原操作持久引用隔离未知结果，营业时区输入不使用浏览器时区作为业务依据。 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Dayjs } from "dayjs";
import { corePageKey, resolveCorePageLocation, type CorePageLocation } from "@rental-os/core-contracts";
import { CorePage, QueryState, useCorePageHost, type CoreAdminPageAction } from "@rental-os/platform-admin/core";
import { useLocale } from "@rental-os/platform-admin/locale";
import { ActionButton, Alert, App, Button, Checkbox, DataTableStatus, DataTableText, DatePicker, Drawer, Form, Input,
  ListFilterBar, ListFilterItem, ListSection, RecordFacts, SaveButton, Select, Table, Tabs } from "@rental-os/platform-admin/ui";
import type { RentalAssetControl, RentalAssetControlType, RentalWorkOrderType } from "@rental-os/rental-core";
import { businessDateKey, businessInstantAt, businessTimeOfDay } from "@rental-os/rental-core/business-day";
import { rentalWorkOrderLocation } from "../work-orders/pages";
import { rentalOrderLocation } from "../orders/pages";
import { useOrderEditor } from "../orders/useOrderEditor";
import { RENTAL_CATALOG_PAGES, rentalAssetLocation } from "./pages";
import type { RentalCatalogPageContext } from "./page-context";
import { createAssetControlRecovery, type AssetControlAction } from "./asset-control-operation";
import styles from "./AssetSchedulePage.module.css";

interface Values { assetId: string; typeCode: string; startAt?: Dayjs; plannedEndAt?: Dayjs; assigneeId?: string; reason: string; confirmed?: boolean;
  code: string; name: string; enabled: boolean; blocksRental: boolean; requiresWorkOrder: boolean; releaseRequiresAcceptance: boolean; workOrderType?: RentalWorkOrderType }
type Editor = { key: number; action: AssetControlAction; control?: RentalAssetControl; type?: RentalAssetControlType };
const names = { create: "新建管控", emergency: "紧急停租", extend: "延期管控", cancel: "取消未来管控", release: "解除管控", save_type: "配置管控类型" };
const statuses = { active: "未解除", cancelled: "已取消", released: "已解除" };
function instant(value: Dayjs | undefined, zone: string) {
  if (!value) return undefined;
  const date = value.format("YYYY-MM-DD"), clock = value.format("HH:mm");
  const at = new Date(businessInstantAt(date, value.hour(), zone) + value.minute() * 60000).toISOString();
  if (businessDateKey(at, zone) !== date || businessTimeOfDay(at, zone) !== clock) throw new Error("所选营业时间不存在，请重新选择");
  return at;
}
export function AssetControlsPage(context: RentalCatalogPageContext) {
  return <ControlsBody key={context.scopeKey} {...context} />;
}
function ControlsBody(context: RentalCatalogPageContext) {
  const { api, scopeKey, currentScopeKey } = context, host = useCorePageHost(), { t, locale } = useLocale(), { message } = App.useApp();
  const client = useQueryClient(), [search, setSearch] = useSearchParams(), assetFilter = search.get("assetId") ?? undefined;
  const [tab, setTab] = useState("controls"), [status, setStatus] = useState<string>("active"), [editor, setEditor] = useState<Editor>(), [detailId, setDetailId] = useState(search.get("controlId") ?? undefined);
  const [form] = Form.useForm<Values>(), sequence = useRef(0), active = useRef(false), live = useRef({ host, scopeKey });
  const [writeConflicts, setWriteConflicts] = useState<{ available: boolean; orders: Array<{ id: string; orderNo: string; status: string }> }>();
  live.current = { host, scopeKey };
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const canRead = () => Boolean(scopeKey && currentScopeKey() === scopeKey && live.current.scopeKey === scopeKey
    && live.current.host.canAccess("rental", RENTAL_CATALOG_PAGES.controls.permissions));
  const assertRead = () => { if (!active.current || !canRead()) throw new DOMException(t("当前管控页面已失效"), "AbortError"); };
  const canWrite = (action: AssetControlAction) => canRead() && live.current.host.canAccess("rental", [{ resource: "asset.control",
    action: action === "save_type" ? "configure" : action === "emergency" ? "emergency" : "manage" }]);
  const assertWrite = (action: AssetControlAction) => { assertRead(); if (!canWrite(action)) throw new Error(t("当前操作不可用")); };
  const [, redraw] = useState(0);
  const currentRead = useRef(assertRead); currentRead.current = assertRead;
  const recovery = useMemo(() => {
    let storage: Storage | undefined, locks: LockManager | undefined;
    try { storage = window.localStorage; locks = navigator.locks; } catch { /* 不可靠的浏览器状态不能派发命令。 */ }
    return createAssetControlRecovery({ scopeKey: context.operationScopeKey, storage, locks, api, assertCurrent: () => currentRead.current(),
      changed: () => { if (active.current && currentScopeKey() === scopeKey) redraw(n => n + 1); } });
  }, [api, context.operationScopeKey, currentScopeKey, scopeKey]);
  useEffect(() => { const listener = (event: StorageEvent) => { if (event.key === recovery.key || event.key === null) redraw(n => n + 1); };
    window.addEventListener("storage", listener); return () => window.removeEventListener("storage", listener); }, [recovery]);
  const operation = recovery.read(), blocked = Boolean(operation.blocked || operation.unavailable || operation.pending);
  const query = useQuery({ queryKey: ["rental-core", "asset-controls", scopeKey, assetFilter], enabled: canRead(), retry: false,
    queryFn: async ({ signal }) => { assertRead(); const [controls, types, options] = await Promise.all([
      api.assetControls(assetFilter, { signal }), api.assetControlTypes({ signal }), api.assetControlOptions({ signal })]);
      assertRead(); return { controls, types, options }; } });
  const data = canRead() && !query.isError ? query.data : undefined, selected = data?.controls.find(row => row.id === detailId);
  const zone = data?.options.timeZone;
  const format = (value?: string) => value && zone ? new Intl.DateTimeFormat(locale, { timeZone: zone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : t("时间未定");
  const history = useQuery({ queryKey: ["rental-core", "asset-control-history", scopeKey, selected?.id, selected?.revision], enabled: Boolean(selected) && canRead(), retry: false,
    queryFn: async ({ signal }) => { assertRead(); const rows = await api.assetControlHistory(selected!.id, { signal }); assertRead(); return rows; } });
  const orderAccess = host.canAccess("rental", [{ resource: "order", action: "view" }]);
  const conflicts = useQuery({ queryKey: ["rental-core", "asset-control-conflicts", scopeKey, selected?.id, selected?.revision, orderAccess], enabled: Boolean(selected?.conflictsPending) && canRead(), retry: false,
    queryFn: async ({ signal }) => { assertRead(); const rows = await api.assetControlConflicts(selected!.id, { signal }); assertRead(); return rows; } });
  const chosenAsset = Form.useWatch("assetId", form), chosenType = Form.useWatch("typeCode", form), requiresWork = Form.useWatch("requiresWorkOrder", form);
  const create = editor && ["create", "emergency"].includes(editor.action), asset = data?.options.assets.find(row => row.id === chosenAsset);
  const type = data?.types.find(row => row.code === chosenType);
  const assignees = useQuery({ queryKey: ["rental-core", "asset-control-assignees", scopeKey, asset?.locationId], enabled: Boolean(create && asset && type?.requiresWorkOrder) && canRead(), retry: false,
    queryFn: async ({ signal }) => { assertRead(); const rows = await api.assetControlAssignees(asset!.locationId, { signal }); assertRead(); return rows; } });
  const refresh = async () => {
    assertRead(); await query.refetch({ throwOnError: true }); assertRead();
    await Promise.all(["asset-schedule", "asset-detail", "asset-work-orders", "work-orders", "asset-control-history", "asset-control-conflicts"].map(key =>
      client.invalidateQueries({ predicate: query => query.queryKey.includes(key) && query.queryKey.includes(scopeKey) })));
    assertRead();
  };
  const navigate = (target: CorePageLocation, params?: Record<string, string>) => {
    assertRead(); const page = live.current.host.pages.get(corePageKey(target.coreId, target.pageId));
    if (!page || !live.current.host.canAccess(target.coreId, page.definition.permissions)) throw new Error(t("当前页面不可用"));
    const path = resolveCorePageLocation(live.current.host.pages, target); live.current.host.navigate(params ? `${path}?${new URLSearchParams(params)}` : path);
  };
  const open = (action: AssetControlAction, control?: RentalAssetControl, type?: RentalAssetControlType) => {
    assertWrite(action); if (blocked || !data) return;
    setWriteConflicts(undefined); form.resetFields(); form.setFieldsValue({ assetId: assetFilter, typeCode: data.types.find(row => row.enabled)?.code,
      ...(type ? { ...type } : { enabled: true, blocksRental: true, requiresWorkOrder: true, releaseRequiresAcceptance: true, workOrderType: "repair" as const }) });
    setEditor({ key: ++sequence.current, action, control, type });
  };
  const error = (error: unknown) => { if (active.current && canRead()) message.error(error instanceof Error ? t(error.message) : t("操作失败")); };
  const edit = useOrderEditor({ form, identity: editor ? `${scopeKey}:${editor.key}` : undefined,
    disabled: !editor || !canWrite(editor.action) || blocked || !data, onError: error,
    onSave: async values => {
      const original = editor; if (!original || !zone || !data) throw new Error(t("当前操作不可用")); assertWrite(original.action);
      const action = original.action, target = action === "save_type" ? values.code : original.control?.id ?? values.assetId;
      const expectedRevision = original.control?.revision ?? original.type?.revision ?? 0;
      // 时间转换、配置与确认校验先于保存派发引用，失败不会留下未发送操作。
      const plannedEndAt = instant(values.plannedEndAt, zone), startAt = instant(values.startAt, zone);
      if (action === "emergency" && values.confirmed !== true) throw new Error(t("请确认紧急停租及冲突处理责任"));
      if (action === "save_type" && values.releaseRequiresAcceptance && !values.requiresWorkOrder) throw new Error(t("需要验收必须关联原工单"));
      const result = await recovery.execute(action, target, expectedRevision, () => assertWrite(action), operationId => {
        const command = { operationId, expectedRevision, reason: values.reason };
        if (action === "save_type") return api.saveAssetControlType({ ...command, type: { code: values.code, name: values.name, enabled: values.enabled,
          blocksRental: values.blocksRental, requiresWorkOrder: values.requiresWorkOrder, releaseRequiresAcceptance: values.releaseRequiresAcceptance,
          ...(values.requiresWorkOrder ? { workOrderType: values.workOrderType } : {}) } });
        if (action === "create" || action === "emergency") {
          const input = { ...command, assetId: values.assetId, typeCode: values.typeCode, plannedEndAt,
            ...(action === "create" ? { startAt } : {}), ...(type?.requiresWorkOrder ? { assigneeId: values.assigneeId } : {}) };
          return action === "emergency" ? api.emergencyAssetControl({ ...input, confirmed: true }) : api.createAssetControl(input);
        }
        return api.changeAssetControl(target, action, action === "extend" ? { ...command, plannedEndAt: plannedEndAt! } : command);
      }).catch(error => {
        assertRead();
        const response = (error as { response?: { data?: { code?: string; conflicts?: typeof writeConflicts } } })?.response?.data;
        if (response?.code === "rental_asset_control_write_rejected" && response.conflicts) setWriteConflicts(response.conflicts);
        throw error;
      });
      assertRead(); setEditor(undefined); if (result.status === "committed" && action !== "save_type") setDetailId(result.objectId);
      await refresh(); message.success(t("已保存"));
    } });
  const boundForm = useMemo(() => ({ ...form, validateFields: edit.validate }), [form, edit.key]);
  const actions: CoreAdminPageAction<unknown>[] = [{ id: "refresh", kind: "command", intent: "refresh", slot: "tools", label: { default: t("刷新") },
    permissions: RENTAL_CATALOG_PAGES.controls.permissions, execute: refresh, pending: query.isFetching }];
  for (const action of ["create", "emergency"] as const) if (canWrite(action)) actions.push({ id: action, kind: "open", label: { default: t(names[action]) },
    permissions: [{ resource: "asset.control", action: action === "emergency" ? "emergency" : "manage" }], disabled: blocked || !data, open: () => open(action) });
  const controls = data?.controls.filter(row => (!status || row.status === status)) ?? [];
  const rowActions = (row: RentalAssetControl) => <div className={styles.controls}><Button onClick={() => setDetailId(row.id)}>{t("详情")}</Button>
    {row.status === "active" && canWrite("extend") && <>
      {row.plannedEndAt && <Button disabled={blocked} onClick={() => open("extend", row)}>{t("延期")}</Button>}
      <Button disabled={blocked} onClick={() => open(Date.parse(row.startAt) > Date.now() ? "cancel" : "release", row)}>{t(Date.parse(row.startAt) > Date.now() ? "取消未来管控" : "解除管控")}</Button>
    </>}</div>;
  return <CorePage title={t("人工管控中心")} summary={zone} actions={actions}>
    {!canRead() ? <Alert type="warning" showIcon title={t("管控读取受限")} /> : <div className={styles.workspace}>
      {(operation.blocked || operation.unavailable) && <Alert type="error" showIcon title={t("当前浏览器无法可靠保存管控原操作")} />}
      {operation.pending && <Alert type="warning" showIcon title={t("请先核对原管控操作")} description={t("未知结果不会自动重发。关闭或刷新页面后仍须核对原操作。")}
        action={<ActionButton label={t("核对原操作")} onAction={async () => { const result = await recovery.recover();
          if (result.status === "rejected") message.warning(t(result.message)); else setEditor(undefined); await refresh(); }} />} />}
      <Tabs activeKey={tab} onChange={setTab} items={[{ key: "controls", label: t("管控记录") }, { key: "types", label: t("管控类型") }]} />
      <QueryState loading={query.isLoading} error={query.error} onRetry={refresh} transitionKey={`${scopeKey}:${tab}`}>
        {data && (tab === "controls" ? <ListSection title={t("管控记录")}><ListFilterBar>
          <ListFilterItem><Select aria-label={t("车辆或资产")} placeholder={t("全部资产")} allowClear value={assetFilter}
            options={data.options.assets.map(row => ({ value: row.id, label: `${row.assetNo} · ${row.itemGroupName}` }))}
            onChange={id => setSearch(id ? { assetId: id } : {})} /></ListFilterItem>
          <ListFilterItem><Select aria-label={t("状态")} allowClear value={status} options={Object.entries(statuses).map(([value, label]) => ({ value, label: t(label) }))} onChange={setStatus} /></ListFilterItem>
        </ListFilterBar><Table rowKey="id" dataSource={controls} pagination={{ pageSize: 20 }} columns={[
          { title: t("车辆或资产"), render: (_value, row) => { const asset = data.options.assets.find(asset => asset.id === row.assetId); return <DataTableText primary={asset?.assetNo ?? row.assetId} secondary={asset?.itemGroupName} />; } },
          { title: t("管控类型"), render: (_value, row) => <DataTableText primary={t(row.policy.name)} secondary={row.reason} /> },
          { title: t("状态"), render: (_value, row) => <DataTableStatus tone={row.status === "active" ? "warning" : "neutral"}>{t(row.status === "active" && Date.parse(row.startAt) > Date.now() ? "待生效" : statuses[row.status])}</DataTableStatus> },
          { title: t("开始时间"), render: (_value, row) => format(row.startAt) }, { title: t("计划结束"), render: (_value, row) => format(row.plannedEndAt) },
          { title: t("订单冲突"), render: (_value, row) => row.conflictsPending ? t("待原订单处理") : "—" }, { title: t("操作"), render: (_value, row) => rowActions(row) }
        ]} /></ListSection> : <ListSection title={t("管控类型")} extra={canWrite("save_type") && <Button disabled={blocked} onClick={() => open("save_type")}>{t("新增类型")}</Button>}>
          <Table rowKey="code" dataSource={data.types} pagination={{ pageSize: 20 }} columns={[
            { title: t("名称"), render: (_value, row) => <DataTableText primary={t(row.name)} secondary={row.code} /> },
            ...(["enabled", "blocksRental", "requiresWorkOrder", "releaseRequiresAcceptance"] as const).map((key, i) => ({ title: t(["启用", "阻止出租", "需要工单", "解除须验收"][i]), render: (_value: unknown, row: RentalAssetControlType) => t(row[key] ? "是" : "否") })),
            { title: t("修订"), dataIndex: "revision" }, { title: t("操作"), render: (_value, row) => canWrite("save_type") && <Button disabled={blocked} onClick={() => open("save_type", undefined, row)}>{t("编辑")}</Button> }
          ]} /></ListSection>)}
      </QueryState>
      <Drawer open={Boolean(selected)} onClose={() => setDetailId(undefined)} title={t("管控详情")}>
        {selected && <div className={styles.workspace}><RecordFacts items={[
          { key: "type", label: t("管控类型"), value: t(selected.policy.name) }, { key: "reason", label: t("原因"), value: selected.reason },
          { key: "start", label: t("开始时间"), value: format(selected.startAt) }, { key: "plan", label: t("计划结束"), value: format(selected.plannedEndAt) },
          { key: "end", label: t("实际结束"), value: format(selected.endedAt) }, { key: "policy", label: t("解除须验收"), value: t(selected.policy.releaseRequiresAcceptance ? "是" : "否") }
        ]} /><Alert type="info" showIcon title={t("计划结束不会自动解除管控；工单验收后仍须按本条冻结条件解除。")} />
          {rowActions(selected)}<div className={styles.controls}>
            {host.canAccess("rental", RENTAL_CATALOG_PAGES.assetDetail.permissions) && <Button onClick={() => navigate(rentalAssetLocation(selected.assetId))}>{t("查看资产")}</Button>}
            {host.canAccess("rental", RENTAL_CATALOG_PAGES.schedule.permissions) && <Button onClick={() => navigate({ coreId: "rental", pageId: "asset-schedule" }, { assetId: selected.assetId })}>{t("查看排班")}</Button>}
            {selected.workOrderId && host.canAccess("rental", [{ resource: "maintenance", action: "view" }]) && <Button onClick={() => navigate(rentalWorkOrderLocation(selected.workOrderId))}>{t("查看工单")}</Button>}
          </div>
          {selected.conflictsPending && <QueryState loading={conflicts.isLoading} error={conflicts.error} onRetry={() => conflicts.refetch({ throwOnError: true })}>
            {conflicts.data?.available ? <Table rowKey="id" dataSource={conflicts.data.orders} pagination={false} columns={[
              { title: t("订单编号"), dataIndex: "orderNo" }, { title: t("操作"), render: (_value, row) => orderAccess && <Button onClick={() => navigate(rentalOrderLocation(row.id))}>{t("进入订单处理")}</Button> }
            ]} /> : <Alert type="warning" title={t("冲突订单读取受限")} />}</QueryState>}
          <ListSection title={t("操作履历")}><QueryState loading={history.isLoading} error={history.error} onRetry={() => history.refetch({ throwOnError: true })}>
            <Table rowKey="id" dataSource={!history.isError ? history.data ?? [] : []} pagination={{ pageSize: 10 }} columns={[
              { title: t("动作"), render: (_value, row) => t(names[row.action]) }, { title: t("原因"), dataIndex: "reason" },
              { title: t("修订"), dataIndex: "revision" }, { title: t("时间"), render: (_value, row) => format(row.createdAt) }
            ]} /></QueryState></ListSection>
        </div>}
      </Drawer>
      <Drawer open={Boolean(editor)} onClose={() => edit.dismiss(() => setEditor(undefined))} title={editor ? t(names[editor.action]) : ""}
        footer={<SaveButton label={t("确认提交")} form={boundForm} pending={edit.busy}
          disabled={!editor || blocked || !canWrite(editor.action)} onSave={edit.submit} />}>
        <Form form={form} layout="vertical" {...edit.formProps} disabled={edit.busy || blocked}>
          <p className={styles.help}>{t("所有时间按营业时区填写")} · {zone}</p>
          {writeConflicts && <><Alert type="warning" title={t("管控与原订单冲突，请先处理后重新读取")} />
            {writeConflicts.available && orderAccess ? <Table rowKey="id" dataSource={writeConflicts.orders} pagination={{ pageSize: 5 }} columns={[
              { title: t("订单编号"), dataIndex: "orderNo" }, { title: t("操作"), render: (_value, row) => <Button onClick={() => navigate(rentalOrderLocation(row.id))}>{t("进入订单处理")}</Button> }
            ]} /> : <p>{t("冲突订单读取受限")}</p>}</>}
          {editor?.action === "save_type" ? <>
            <Form.Item name="code" label={t("类型编码")} rules={[{ required: true, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u }]}><Input disabled={Boolean(editor.type)} /></Form.Item>
            <Form.Item name="name" label={t("名称")} rules={[{ required: true, whitespace: true, max: 191 }]}><Input /></Form.Item>
            {(["enabled", "blocksRental", "requiresWorkOrder", "releaseRequiresAcceptance"] as const).map((key, i) => <Form.Item key={key} name={key} valuePropName="checked"><Checkbox>{t(["启用", "阻止出租", "需要工单", "解除须验收"][i])}</Checkbox></Form.Item>)}
            {requiresWork && <Form.Item name="workOrderType" label={t("工单类型")} rules={[{ required: true }]}><Select options={Object.entries({ cleaning: "清洁", restock: "补货/缺件", calibration: "校准", repair: "维修" }).map(([value, label]) => ({ value, label: t(label) }))} /></Form.Item>}
            <p className={styles.help}>{t("类型修改不改变既有管控的冻结恢复条件。")}</p>
          </> : <>
            {create && <><Form.Item name="assetId" label={t("车辆或资产")} rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={data?.options.assets.map(row => ({ value: row.id, label: `${row.assetNo} · ${row.itemGroupName}` }))} onChange={() => form.setFieldValue("assigneeId", undefined)} /></Form.Item>
              <Form.Item name="typeCode" label={t("管控类型")} rules={[{ required: true }]}><Select options={data?.types.filter(row => row.enabled && (editor.action !== "emergency" || row.blocksRental)).map(row => ({ value: row.code, label: t(row.name) }))} onChange={() => form.setFieldValue("assigneeId", undefined)} /></Form.Item>
              {editor.action === "create" && <Form.Item name="startAt" label={t("未来开始时间")} extra={t("留空由服务端立即开始")}><DatePicker showTime={{ format: "HH:mm" }} format="YYYY-MM-DD HH:mm" showNow={false} /></Form.Item>}
              {type?.requiresWorkOrder && <Form.Item name="assigneeId" label={t("处理人")}><Select allowClear loading={assignees.isFetching} options={!assignees.isError ? assignees.data?.map(row => ({ value: row.id, label: row.displayName })) : []} /></Form.Item>}
              {assignees.isError && <Alert type="warning" title={t("处理人读取失败，可留空稍后沿工单派工")} />}
            </>}
            {(create || editor?.action === "extend") && <Form.Item name="plannedEndAt" label={t("计划结束")} rules={[{ required: editor?.action === "extend" }]} extra={t("预计结束不自动释放库存")}><DatePicker showTime={{ format: "HH:mm" }} format="YYYY-MM-DD HH:mm" showNow={false} /></Form.Item>}
            {editor?.action === "emergency" && <Form.Item name="confirmed" valuePropName="checked" rules={[{ validator: (_rule, value) => value === true ? Promise.resolve() : Promise.reject(new Error(t("请确认紧急停租及冲突处理责任"))) }]}><Checkbox>{t("确认车辆已不可用；原订单由后续业务动作处理，不自动取消、退款或调车。")}</Checkbox></Form.Item>}
            {editor?.action === "release" && <Alert type="info" title={t("仅解除本条管控，其他限制及订单占用继续有效。")} />}
          </>}
          <Form.Item name="reason" label={t("操作原因")} rules={[{ required: true, whitespace: true, max: 500 }]}><Input.TextArea rows={3} maxLength={500} /></Form.Item>
        </Form>
      </Drawer>
    </div>}
  </CorePage>;
}
