/** Rental 原库存资源时间轴。读取与回调复验当前范围和来源权限，UIArc 承载筛选、详情和导航；不在图上直接写订单日期。 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import { useQuery } from "@tanstack/react-query";
import { corePageKey, resolveCorePageLocation, type CorePageLocation } from "@rental-os/core-contracts";
import { CorePage, QueryState, useCorePageHost } from "@rental-os/platform-admin/core";
import { useLocale } from "@rental-os/platform-admin/locale";
import { ActionButton, Alert, Button, CalendarOutlined, ContentTransition, DataTableStatus, DataTableText, DatePicker, Drawer, Empty, FileTextOutlined, LeftOutlined, RightOutlined,
  ListFilterBar, ListFilterItem, ListSection, Pagination, RecordFacts, SearchField, Segmented, Select, Table } from "@rental-os/platform-admin/ui";
import { RentalAssetStatus, type RentalAssetSchedule, type RentalAssetScheduleEntry, type RentalAssetScheduleQuery, type RentalAssetScheduleRow, type RentalWorkOrderType } from "@rental-os/rental-core";
import { businessDateKey } from "@rental-os/rental-core/business-day";
import { rentalOrderLocation } from "../orders/pages";
import { orderQuickActions, orderStatusLabels, type OrderQuickAction } from "../orders/orderQuickActions";
import { RentalOrderRowActions } from "../orders/RentalOrderRowActions";
import { retainOrderExtensionPreparation } from "../orders/orderExtensionPreparation";
import { rentalWorkOrderLocation } from "../work-orders/pages";
import type { RentalCatalogPageContext } from "./page-context";
import { rentalAssetLocation, RENTAL_CATALOG_PAGES } from "./pages";
import { scheduleLanes, scheduleWindow, shiftScheduleDate, type ScheduleZoom } from "./asset-schedule-view";
import { ScheduleExtensionHandle } from "./ScheduleExtensionHandle";
import { ScheduleExtensionPreparation } from "./ScheduleExtensionPreparation";
import styles from "./AssetSchedulePage.module.css";

const kindLabels: Record<RentalAssetScheduleEntry["kind"], string> = { reservation: "已分配预约", rental: "租用中", preparation: "交付准备",
  turnaround: "归还周转", work_order: "养护工单", asset_hold: "当前库存限制", manual_control: "人工管控" };
const workOrderLabels: Record<RentalWorkOrderType, string> = { cleaning: "清洁工单", restock: "补货/缺件工单", calibration: "校准工单", repair: "维修工单" };
const statusLabels: Record<string, string> = { available: "可用", reserved: "已预占", rented: "租赁中", inspection: "检查中", maintenance: "维护中", disabled: "停用" };

export function AssetSchedulePage(context: RentalCatalogPageContext) {
  const [searchParams, setSearchParams] = useSearchParams();
  const assetId = searchParams.get("assetId") ?? undefined;
  return <AssetScheduleBody key={JSON.stringify([context.scopeKey, assetId])} {...context} assetId={assetId}
    clearAsset={() => setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete("assetId"); return next; }, { replace: true })} />;
}
function AssetScheduleBody({ api, scopeKey, currentScopeKey, assetId, clearAsset }: RentalCatalogPageContext & { assetId?: string; clearAsset: () => void }) {
  const { t, locale } = useLocale(), host = useCorePageHost();
  const [zoom, setZoom] = useState<ScheduleZoom>("week"), [date, setDate] = useState<string>(), [timeZone, setTimeZone] = useState<string>();
  const [view, setView] = useState("gantt"), [page, setPage] = useState(1);
  const [locationId, setLocationId] = useState<string>(), [itemGroupId, setItemGroupId] = useState<string>();
  const [status, setStatus] = useState<RentalAssetStatus>(), [search, setSearch] = useState(""), [keyword, setKeyword] = useState("");
  const [initial] = useState(() => ({ startAt: new Date().toISOString(), endAt: new Date(Date.now() + 7 * 86400000).toISOString() }));
  const range = date && timeZone ? scheduleWindow(date, zoom, timeZone) : { ...initial, ticks: [] };
  const params: RentalAssetScheduleQuery = { startAt: range.startAt, endAt: range.endAt, page,
    ...(assetId !== undefined ? { assetId } : {}),
    ...(locationId ? { locationId } : {}), ...(itemGroupId ? { itemGroupId } : {}), ...(status ? { status } : {}), ...(keyword ? { keyword } : {}) };
  const active = useRef(false), currentHost = useRef(host);
  currentHost.current = host;
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const canRead = () => Boolean(scopeKey) && currentScopeKey() === scopeKey && (
    currentHost.current.canAccess("rental", [{ resource: "asset", action: "view" }])
    || currentHost.current.canAccess("rental", [{ resource: "asset", action: "manage" }]));
  const readSourceAccess = () => JSON.stringify([
    currentHost.current.canAccess("rental", [{ resource: "order", action: "view" }]),
    currentHost.current.canAccess("rental", [{ resource: "maintenance", action: "view" }])
  ]);
  // 同一资产读取权下，订单/工单权限决定响应中的编号、状态和负责人，不能沿用另一投影的缓存。
  const sourceAccess = readSourceAccess();
  const assertRead = () => {
    if (!active.current || !canRead() || readSourceAccess() !== sourceAccess)
      throw new DOMException(t("当前排班页面已失效，请重新读取"), "AbortError");
  };
  const query = useQuery({ queryKey: ["rental-core", "asset-schedule", scopeKey, params, sourceAccess], enabled: canRead(),
    queryFn: async ({ signal }) => { assertRead(); const result = await api.assetSchedule(params, { signal }); assertRead(); return result; }, retry: false });
  const data = canRead() && !query.isError ? query.data : undefined;
  const live = useRef({ data, host, fetching: query.isFetching });
  live.current = { data, host, fetching: query.isFetching };
  const isCurrentSnapshot = (snapshot = data) => Boolean(active.current && snapshot && live.current.data === snapshot
    && canRead() && readSourceAccess() === sourceAccess);
  const refresh = async () => { assertRead(); await query.refetch({ throwOnError: true }); assertRead(); };
  useEffect(() => {
    if (data && (timeZone !== data.timeZone || !date)) {
      setTimeZone(data.timeZone); setDate(current => current ?? businessDateKey(data.observedAt, data.timeZone));
    }
  }, [data, date, timeZone]);
  const [selection, setSelection] = useState<{ snapshot: RentalAssetSchedule; entry?: RentalAssetScheduleEntry; asset?: RentalAssetScheduleRow }>();
  const selected = selection?.snapshot === data ? selection : undefined;
  const [preparation, setPreparation] = useState<{ snapshot: RentalAssetSchedule; entry: RentalAssetScheduleEntry; asset?: RentalAssetScheduleRow; newEndAt?: string }>();
  useEffect(() => {
    if (query.isFetching || preparation && preparation.snapshot !== data) setPreparation(undefined);
  }, [data, query.isFetching, preparation]);
  const label = (entry: RentalAssetScheduleEntry) => `${t(entry.kind === "work_order" && entry.workOrderType ? workOrderLabels[entry.workOrderType]
    : ["reservation", "rental"].includes(entry.kind) && entry.order ? orderStatusLabels[entry.order.status] : kindLabels[entry.kind])}${entry.sourceNo ? ` · ${entry.sourceNo}` : ""}${entry.overdue ? ` · ${t(entry.kind === "manual_control" ? "逾期未解除" : "逾期未还")}` : ""}`;
  const overlapLabel = (asset: RentalAssetScheduleRow) => t("{count} 段预占重叠", { count: asset.overlaps.length });
  const format = (value: string | null | undefined) => value && timeZone
    ? new Intl.DateTimeFormat(locale, { timeZone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)) : t("时间未定");
  const canOpen = (location: CorePageLocation) => {
    if (!canRead()) return false;
    const page = live.current.host.pages.get(corePageKey(location.coreId, location.pageId));
    return Boolean(page && live.current.host.canAccess(location.coreId, page.definition.permissions));
  };
  const navigate = (location: CorePageLocation, permission: { resource: string; action: string }, selectedAssetId?: string, action?: OrderQuickAction) => {
    if (!isCurrentSnapshot() || !live.current.host.canAccess("rental", [permission]) || !canOpen(location)) return;
    const path = resolveCorePageLocation(live.current.host.pages, location);
    const search = new URLSearchParams();
    if (selectedAssetId) search.set("assetId", selectedAssetId);
    if (action) search.set("action", action);
    live.current.host.navigate(search.size ? `${path}?${search}` : path);
  };
  const openSource = (entry: RentalAssetScheduleEntry) => {
    if (!entry.sourceId) return;
    if (entry.source === "order") navigate(rentalOrderLocation(entry.sourceId), { resource: "order", action: "view" });
    if (entry.source === "work_order") navigate(rentalWorkOrderLocation(entry.sourceId), { resource: "maintenance", action: "view" });
    if (entry.source === "asset_control" && isCurrentSnapshot() && canOpen({ coreId: "rental", pageId: "asset-controls" })) {
      const path = resolveCorePageLocation(live.current.host.pages, { coreId: "rental", pageId: "asset-controls" });
      live.current.host.navigate(`${path}?${new URLSearchParams({ controlId: entry.sourceId })}`);
    }
  };
  const selectableSource = (entry: RentalAssetScheduleEntry) => Boolean(canRead() && entry.sourceId && ((entry.source === "order" && live.current.host.canAccess("rental", [{ resource: "order", action: "view" }]))
    || (entry.source === "work_order" && live.current.host.canAccess("rental", [{ resource: "maintenance", action: "view" }]))
    || (entry.source === "asset_control" && canOpen({ coreId: "rental", pageId: "asset-controls" }))));
  const orderPermissions = () => ({
    operate: live.current.host.canAccess("rental", [{ resource: "order", action: "operate" }]),
    pickup: live.current.host.canAccess("rental", [{ resource: "order", action: "pickup" }]),
    return: live.current.host.canAccess("rental", [{ resource: "order", action: "return" }]),
    extend: live.current.host.canAccess("rental", [{ resource: "order", action: "extend" }]),
    settle: false, cancel: false
  });
  const canPrepare = (entry: RentalAssetScheduleEntry, snapshot = data) => Boolean(isCurrentSnapshot(snapshot)
    && !live.current.fetching && entry.source === "order" && entry.sourceId
    && ["reservation", "rental"].includes(entry.kind) && entry.order?.effectiveEndAt && Number.isFinite(Date.parse(entry.order.effectiveEndAt))
    && live.current.host.canAccess("rental", [{ resource: "order", action: "view" }]) && canOpen(rentalOrderLocation(entry.sourceId))
    && orderQuickActions(entry.order, orderPermissions()).actions.includes("extend"));
  const prepareExtension = (entry: RentalAssetScheduleEntry, asset?: RentalAssetScheduleRow, newEndAt?: string) => {
    if (canPrepare(entry)) setPreparation({ snapshot: data!, entry, asset, newEndAt });
  };
  const prepared = preparation && preparation.snapshot === data && canPrepare(preparation.entry, preparation.snapshot) ? preparation : undefined;
  const renderOrderActions = (entry: RentalAssetScheduleEntry, asset?: RentalAssetScheduleRow) => {
    if (entry.source !== "order" || !entry.sourceId || !selectableSource(entry) || !canOpen(rentalOrderLocation(entry.sourceId))) return null;
    if (!entry.order) return <Button onClick={() => openSource(entry)}>{t("进入订单处理")}</Button>;
    return <div className={styles.controls}><RentalOrderRowActions order={{ id: entry.sourceId, orderNo: entry.sourceNo ?? entry.sourceId, ...entry.order }}
      permissions={orderPermissions()} t={t} openOrder={(_id, action) => {
        if (!selectableSource(entry) || action && !orderQuickActions(entry.order!, orderPermissions()).actions.includes(action)) return;
        // 复用原动作判定和UIArc行操作，仅定位；改期的试算、付款及库存生效仍在原订单执行。
        navigate(rentalOrderLocation(entry.sourceId), { resource: "order", action: "view" }, undefined, action);
      }} />{canPrepare(entry) && <Button onClick={() => prepareExtension(entry, asset)}>{t("准备续租时间")}</Button>}</div>;
  };
  const resetPage = (change: () => void) => { setPage(1); setSelection(undefined); change(); };
  return <CorePage title={t("资产排班")} summary={data ? `${t("共 {count} 辆/件资产", { count: data.total })} · ${data.timeZone} · ${t("读取于")} ${format(data.observedAt)}` : undefined}
    actions={canOpen({ coreId: "rental", pageId: "asset-controls" }) ? [{ id: "controls", kind: "navigate",
      label: { default: t("人工管控中心") }, to: { coreId: "rental", pageId: "asset-controls" }, permissions: RENTAL_CATALOG_PAGES.controls.permissions }] : []}>
    {!canRead() ? <Alert type="warning" showIcon title={t("排班读取受限")} /> : <div className={styles.workspace}>
      {assetId !== undefined && <Alert type="info" showIcon title={t("当前仅查看所选资产")}
        action={<Button onClick={clearAsset}>{t("查看全部资产")}</Button>} />}
      <ListFilterBar>
        <ListFilterItem width="search"><SearchField label={t("车辆或资产编号")} placeholder={t("车辆或资产编号")} value={search}
          onValueChange={setSearch} onSearch={value => resetPage(() => setKeyword(value.trim()))} onClear={() => resetPage(() => { setSearch(""); setKeyword(""); })} /></ListFilterItem>
        <ListFilterItem><Select aria-label={t("地点")} placeholder={t("全部地点")} allowClear value={locationId}
          options={data?.locations.map(row => ({ value: row.id, label: row.name }))} onChange={value => resetPage(() => setLocationId(value))} /></ListFilterItem>
        <ListFilterItem><Select aria-label={t("型号")} placeholder={t("全部型号")} allowClear value={itemGroupId}
          options={data?.itemGroups.map(row => ({ value: row.id, label: row.name }))} onChange={value => resetPage(() => setItemGroupId(value))} /></ListFilterItem>
        <ListFilterItem><Select aria-label={t("资产状态")} placeholder={t("全部状态")} allowClear value={status}
          options={Object.values(RentalAssetStatus).map(value => ({ value, label: t(statusLabels[value]) }))} onChange={value => resetPage(() => setStatus(value))} /></ListFilterItem>
      </ListFilterBar>
      <div className={styles.controls}>
        <div className={styles.range}>
          <Button disabled={!date} aria-label={t("上一时段")} icon={<LeftOutlined />} onClick={() => date && resetPage(() => setDate(shiftScheduleDate(date, zoom, -1)))} />
          <DatePicker aria-label={t("排班日期")} allowClear={false} disabled={!timeZone} value={date ? dayjs(date) : null}
            onChange={value => value && resetPage(() => setDate(value.format("YYYY-MM-DD")))} />
          <Button disabled={!date} aria-label={t("下一时段")} icon={<RightOutlined />} onClick={() => date && resetPage(() => setDate(shiftScheduleDate(date, zoom, 1)))} />
          <Button disabled={!timeZone} onClick={() => timeZone && resetPage(() => setDate(businessDateKey(new Date().toISOString(), timeZone)))}>{t("今天")}</Button>
        </div>
        <Segmented value={zoom} options={[{ value: "day", label: t("日") }, { value: "week", label: t("周") }, { value: "month", label: t("月") }]}
          onChange={value => resetPage(() => setZoom(value as ScheduleZoom))} />
        <ActionButton label={t("刷新")} pending={query.isFetching} onAction={refresh} />
        <Segmented className={styles.viewSwitch} value={view} options={[
          { value: "gantt", label: <span title={t("甘特")} aria-label={t("甘特")}><CalendarOutlined /></span> },
          { value: "list", label: <span title={t("列表")} aria-label={t("列表")}><FileTextOutlined /></span> }
        ]} onChange={value => setView(String(value))} />
      </div>
      <QueryState loading={query.isLoading || !query.error && (!date || !timeZone)} error={query.error} onRetry={refresh} transitionKey={JSON.stringify(params)}>
        {data && <>
          <p className={styles.help}>{t("显示当前有效库存事实；可拖动订单末端准备续租，也可在条带详情填写时间，再进入原订单试算确认。")}</p>
          <ContentTransition value={view}>
            {view === "gantt" ? <div className={styles.scroll} data-schedule-scroll role="region" aria-label={t("资产排班时间轴")} tabIndex={0}>
              <table className={styles.timeline} style={{ minWidth: 200 + (zoom === "month" ? range.ticks.length * 52 : 720) }}>
                <thead><tr><th scope="col">{t("车辆或资产编号")}</th><th scope="col"><div className={styles.axis}>
                  {range.ticks.map(tick => <span key={tick} style={{ left: `${(Date.parse(tick) - Date.parse(range.startAt)) / (Date.parse(range.endAt) - Date.parse(range.startAt)) * 100}%` }}>
                    {new Intl.DateTimeFormat(locale, { timeZone, ...(zoom === "day" ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : { month: "2-digit", day: "2-digit" }) }).format(new Date(tick))}
                  </span>)}
                </div></th></tr></thead>
                <tbody>{data.rows.map(asset => {
                  const bars = scheduleLanes(asset.entries, data.startAt, data.endAt);
                  return <tr key={asset.id}><th scope="row"><Button type="text" onClick={() => setSelection({ snapshot: data, asset })}>{asset.assetNo}</Button>
                    <span className={styles.metadata}>{asset.itemGroupName} · {asset.locationName}</span><span className={styles.metadata}>{t(statusLabels[asset.status])}</span>
                    {asset.overlaps.length > 0 && <span className={styles.metadata}><DataTableStatus tone="warning">{overlapLabel(asset)}</DataTableStatus></span>}</th>
                    <td><div className={styles.track} data-schedule-track style={{ minHeight: `${Math.max(1, ...bars.map(row => row.lane + 1)) * 40 + 16}px` }}>
                      {bars.length ? bars.map(({ entry, lane, left, width }) => <span key={`${data.observedAt}:${entry.id}`}><button type="button" className={styles.bar}
                        data-kind={entry.kind} data-open={!entry.endAt} style={{ left: `${left}%`, width: `${width}%`, top: `${lane * 40 + 8}px` }}
                        aria-label={`${asset.assetNo} · ${label(entry)} · ${format(entry.startAt)} — ${format(entry.endAt)}`}
                        title={`${label(entry)} · ${format(entry.startAt)} — ${format(entry.endAt)}`} onClick={() => setSelection({ snapshot: data, asset, entry })}>
                        {label(entry)}{!entry.endAt ? ` · ${t("结束未定")}` : ""}
                      </button>{canPrepare(entry) && entry.endAt === entry.order?.effectiveEndAt
                        && Date.parse(entry.endAt) > Date.parse(data.startAt) && Date.parse(entry.endAt) < Date.parse(data.endAt) && <ScheduleExtensionHandle
                          originalEndAt={entry.endAt} startAt={data.startAt} endAt={data.endAt} lane={lane}
                          label={t("延长订单 {orderNo}：拖动末端或打开时间表单", { orderNo: entry.sourceNo ?? entry.sourceId! })}
                          format={value => `${t("建议归还")} · ${format(value)} · ${data.timeZone}`}
                          canPrepare={() => canPrepare(entry, data)} onPrepare={value => prepareExtension(entry, asset, value)} />}</span>) : <span className={styles.noEvents}>{t("区间内无已登记条带")}</span>}
                    </div></td></tr>;
                })}</tbody>
              </table>
              {!data.rows.length && <Empty description={t("没有匹配的资产")} />}
            </div> : <Table<RentalAssetScheduleRow> rowKey="id" dataSource={data.rows} pagination={false} columns={[
              { title: t("车辆或资产编号"), dataIndex: "assetNo", render: (_: unknown, asset) => <DataTableText primary={asset.assetNo} secondary={`${asset.itemGroupName} · ${asset.locationName}`} /> },
              { title: t("资产状态"), dataIndex: "status", render: (value: string) => t(statusLabels[value]) },
              { title: t("排班记录"), render: (_: unknown, asset) => asset.entries.length },
              { title: t("预占重叠"), render: (_: unknown, asset) => asset.overlaps.length > 0 ? <DataTableStatus tone="warning">{overlapLabel(asset)}</DataTableStatus> : "—" },
              { title: t("操作"), render: (_: unknown, asset) => <Button onClick={() => setSelection({ snapshot: data, asset })}>{t("查看")}</Button> }
            ]} />}
          </ContentTransition>
          <Pagination current={data.page} pageSize={data.pageSize} total={data.total} showSizeChanger={false} onChange={value => { setSelection(undefined); setPage(value); }} />
          <ListSection title={t("区间容量")}><p className={styles.help}>{t("容量覆盖当前地点与型号的完整可见库存，不随资产编号、状态或分页缩小。")}</p><Table rowKey={row => `${row.locationId}:${row.itemGroupId}`} dataSource={data.capacity} pagination={{ pageSize: 10 }} columns={[
            { title: t("型号 / 地点"), render: (_: unknown, row) => <DataTableText primary={row.itemGroupName} secondary={row.locationName} /> },
            { title: t("可运营数量"), dataIndex: "operableQuantity" }, { title: t("预占峰值"), dataIndex: "reservedPeak" },
            { title: t("管控峰值"), dataIndex: "controlPeak" },
            { title: t("待分配峰值"), dataIndex: "unassignedPeak" }, { title: t("剩余容量"), dataIndex: "availableQuantity" },
            { title: t("冲突"), render: (_: unknown, row) => row.shortage > 0 ? t("缺少 {count}", { count: row.shortage }) : row.enabled ? "—" : t("型号已停用") }
          ]} /></ListSection>
          <ListSection title={t("待分配预约")}><Table rowKey="id" dataSource={data.unassigned} pagination={{ pageSize: 10 }} columns={[
            { title: t("型号 / 地点"), render: (_: unknown, row) => <DataTableText primary={data.itemGroups.find(group => group.id === row.itemGroupId)?.name ?? row.itemGroupId}
              secondary={data.locations.find(location => location.id === row.locationId)?.name ?? row.locationId} /> },
            { title: t("数量"), dataIndex: "quantity" }, { title: t("订单状态"), render: (_: unknown, row) => row.order ? t(orderStatusLabels[row.order.status]) : "—" },
            { title: t("占用区间（含缓冲）"), render: (_: unknown, row) => `${format(row.startAt)} — ${format(row.endAt)}` },
            { title: t("原订单"), render: (_: unknown, row) => selectableSource(row) ? <Button onClick={() => openSource(row)}>{row.sourceNo}</Button> : t("来源读取受限") },
            { title: t("操作"), render: (_: unknown, row) => renderOrderActions(row) ?? "—" }
          ]} /></ListSection>
        </>}
      </QueryState>
    </div>}
    <Drawer open={Boolean(selected)} title={selected?.asset?.assetNo ?? t("排班详情")} onClose={() => setSelection(undefined)} destroyOnHidden>
      {selected && <div className={styles.workspace}>
        {selected.asset && <RecordFacts items={[{ key: "model", label: t("型号"), value: selected.asset.itemGroupName }, { key: "location", label: t("地点"), value: selected.asset.locationName },
          { key: "status", label: t("资产状态"), value: t(statusLabels[selected.asset.status]) }]} />}
        {selected.asset && canOpen(rentalAssetLocation(selected.asset.id)) && <Button
          onClick={() => navigate(rentalAssetLocation(selected.asset!.id), { resource: "asset", action: "view" })}>{t("资产详情")}</Button>}
        {selected.asset && canOpen(rentalWorkOrderLocation()) && <Button
          onClick={() => navigate(rentalWorkOrderLocation(), { resource: "maintenance", action: "view" }, selected.asset!.id)}>
          {t("该资产的养护工单")}
        </Button>}
        {selected.asset && selected.asset.overlaps.length > 0 && <ListSection title={t("预占重叠")}>
          <Alert type="warning" showIcon title={t("同一资产存在同时生效的预占")}
            description={t("重叠区间包含原准备及周转缓冲，限当前查询时段。请进入原订单处理；本提示不会改配或释放库存。")}/>
          <Table rowKey="startAt" dataSource={selected.asset.overlaps} pagination={{ pageSize: 5 }} columns={[
            { title: t("开始"), dataIndex: "startAt", render: (value: string) => format(value) },
            { title: t("结束"), dataIndex: "endAt", render: (value: string) => format(value) },
            { title: t("同时预占数"), dataIndex: "reservationCount" }
          ]}/>
          {selected.entry && <Button onClick={() => setSelection({ snapshot: selected.snapshot, asset: selected.asset })}>{t("查看该资产全部排班记录")}</Button>}
        </ListSection>}
        {(selected.entry ? [selected.entry] : selected.asset?.entries ?? []).map(entry => <div key={entry.id} className={styles.detail}>
          <strong>{label(entry)}</strong>
          <RecordFacts items={[{ key: "start", label: t("开始"), value: format(entry.startAt) }, { key: "end", label: t("结束"), value: format(entry.endAt) },
            ...(entry.order ? [{ key: "orderStatus", label: t("订单状态"), value: t(orderStatusLabels[entry.order.status]) }] : []),
            ...(entry.plannedEndAt ? [{ key: "plannedEnd", label: t("计划结束"), value: format(entry.plannedEndAt) }] : []),
            ...(entry.assigneeName ? [{ key: "assignee", label: t("负责人"), value: entry.assigneeName }] : [])]} />
          {entry.kind === "asset_hold" && <Alert type="info" showIcon title={t("当前库存限制的起止区间未登记；计划结束不能证明已恢复可租。")}/>} 
          {entry.kind === "work_order" && <p className={styles.help}>{t("工单条带表示处理过程，实际库存限制须结合当前资产状态及原验收结果。")}</p>}
          {entry.bufferBasis === "legacy_missing" && <p className={styles.help}>{t("历史规则缺失，缓冲沿原库存兼容口径。")}</p>}
          {entry.source === "order" ? renderOrderActions(entry, selected.asset) : selectableSource(entry) && <Button onClick={() => openSource(entry)}>{t("查看工单")}</Button>}
          {entry.source === "restricted" && <p className={styles.help}>{t("来源读取受限")}</p>}
        </div>)}
      </div>}
    </Drawer>
    {prepared && <ScheduleExtensionPreparation key={`${prepared.entry.id}:${prepared.entry.order!.effectiveEndAt}`} orderNo={prepared.entry.sourceNo ?? prepared.entry.sourceId!}
      assetNo={prepared.asset?.assetNo} originalEndAt={prepared.entry.order!.effectiveEndAt!} newEndAt={prepared.newEndAt} timeZone={prepared.snapshot.timeZone}
      canPrepare={() => canPrepare(prepared.entry, prepared.snapshot)} onClose={() => setPreparation(undefined)} onContinue={newEndAt => {
        if (!canPrepare(prepared.entry, prepared.snapshot)) return;
        const entry = prepared.entry;
        const reference = retainOrderExtensionPreparation({ orderId: entry.sourceId!, status: entry.order!.status, fulfillmentMode: entry.order!.fulfillmentMode,
          originalEndAt: entry.order!.effectiveEndAt!, newEndAt, timeZone: prepared.snapshot.timeZone }, () => currentScopeKey() === scopeKey);
        const path = resolveCorePageLocation(live.current.host.pages, rentalOrderLocation(entry.sourceId!));
        live.current.host.navigate(`${path}?${new URLSearchParams({ action: "extend", extensionPreparation: reference })}`);
      }} />}
  </CorePage>;
}
