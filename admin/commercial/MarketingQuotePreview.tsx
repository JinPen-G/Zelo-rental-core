/** 金额试算只调用服务端原报价计算；表单不计算候选价，不生成可下单凭据。 */
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Col, InputNumber, Row } from "antd";
import type { Dayjs } from "dayjs";
import { ActionButton, Alert, App, Button, DatePicker, DataTableText, Form, FormSection, Input, RecordFacts, Select, Table } from "@rental-os/platform-admin/ui";
import { QueryState } from "@rental-os/platform-admin/core";
import { useLocale } from "@rental-os/platform-admin/locale";
import { RENTAL_PRICING_UNIT_LABELS, formatRentalMoney, type RentalQuoteRequest,
  type RentalMarketingQuotePreview, type RentalMarketingPlan } from "@rental-os/rental-core";
import { rentalPagePermissions } from "@rental-os/rental-core/permissions";
import { useRentalCommercialWorkspaceAccess } from "./page-context";
import { detailFulfillmentLabels } from "../orders/orderDetailPresentation";
import { marketingDateBinding, marketingInstantValid } from "./marketing-date";

type PreviewValues = Omit<RentalQuoteRequest, "bookingIdentity" | "startAt" | "endAt"> & { rentalRange: [string, string]; corporateCustomerId?: string };
const quotePermissions = [{ resource: "order", action: "create" }, { resource: "order", action: "operate" }];
const itemPermissions = [{ resource: "catalog", action: "view" }, { resource: "catalog", action: "manage" }, { resource: "order", action: "view" }, { resource: "order", action: "create" }];
const settingsPermissions = [{ resource: "rules", action: "manage" }, { resource: "price", action: "manage" }, { resource: "order", action: "view" }, { resource: "order", action: "create" }];
const priceReadPermissions = [{ resource: "price", action: "manage" }, { resource: "order", action: "view" }, { resource: "order", action: "create" }];

export function MarketingQuotePreview({ plans, planId }: { plans: RentalMarketingPlan[]; planId?: string }) {
  const { t } = useLocale(), { message } = App.useApp(), [form] = Form.useForm<PreviewValues>();
  const access = useRentalCommercialWorkspaceAccess(rentalPagePermissions("discounts"));
  const { api, scope, host, assertManage, isCurrentScope } = access;
  const any = (permissions: typeof quotePermissions) => permissions.some(value => host.canAccess("rental", [value]));
  const canQuote = access.canManage && any(quotePermissions), canItems = any(itemPermissions), canSettings = any(settingsPermissions);
  const canLocations = any([{ resource: "station", action: "view" }]), canMembers = any([{ resource: "order", action: "create" }]);
  const canPrice = any(priceReadPermissions);
  const assert = () => { assertManage(); if (!any(quotePermissions)) throw new Error(t("营销试算需要当前空间原报价权限")); };
  const references = useQuery({ queryKey: [scope, "marketing-preview-references", canItems, canSettings, canLocations, canPrice],
    enabled: canQuote && canItems && canSettings && canLocations && canPrice,
    queryFn: async ({ signal }) => { assert(); const result = await Promise.all([api.itemGroups({ signal }), api.businessSettings({ signal }), api.locations({ signal }), api.pricingPlans({ signal }), api.pricingGroups({ signal })]);
      assert(); if (signal.aborted || !any(itemPermissions) || !any(settingsPermissions) || !any([{ resource: "station", action: "view" }]) || !any(priceReadPermissions))
        throw new DOMException("Aborted", "AbortError");
      return { items: result[0], settings: result[1], locations: result[2], prices: result[3], groups: result[4] }; } });
  const members = useQuery({ queryKey: [scope, "marketing-preview-members", canMembers], enabled: canQuote && canMembers,
    queryFn: async ({ signal }) => { assert(); const value = await api.bookingMembers({ signal }); assert();
      if (signal.aborted || !any([{ resource: "order", action: "create" }])) throw new DOMException("Aborted", "AbortError"); return value; } });
  const customerId = Form.useWatch("customerId", form), customerType = Form.useWatch("customerType", form);
  const companies = useQuery({ queryKey: [scope, "marketing-preview-companies", canMembers, customerId], enabled: canQuote && canMembers && Boolean(customerId) && customerType === "personal",
    queryFn: async ({ signal }) => { assert(); if (!customerId) throw new DOMException("Aborted", "AbortError");
      const value = await api.bookingOptions(customerId, { signal }); assert();
      if (signal.aborted || !any([{ resource: "order", action: "create" }])) throw new DOMException("Aborted", "AbortError"); return value; } });
  const [result, setResult] = useState<RentalMarketingQuotePreview>(), [busy, setBusy] = useState(false);
  const epoch = useRef(0), pending = useRef(false);
  const invalidate = () => { epoch.current++; setResult(undefined); };
  const refs = canQuote && !references.isError && canItems && canSettings && canLocations && canPrice ? references.data : undefined;
  const disabled = !canQuote || !refs || busy;
  const submit = async () => {
    if (pending.current || disabled) throw new Error(t("当前试算不可用"));
    const generation = ++epoch.current; pending.current = true; setBusy(true); setResult(undefined);
    try {
      assert(); const values = await form.validateFields(); assert();
      const { rentalRange, corporateCustomerId, ...rest } = values;
      if (rest.customerId && (!canMembers || members.isError || !members.data?.some(row => row.customerId === rest.customerId)))
        throw new Error(t("所选客户资料已不可用，请重新读取"));
      if (corporateCustomerId && (companies.isError || !companies.data?.some(row => row.corporateCustomerId === corporateCustomerId)))
        throw new Error(t("所选企业关系已不可用，请重新读取"));
      const input: RentalQuoteRequest = { ...rest, customerId: rest.customerId || undefined,
        bookingIdentity: rest.customerId && rest.customerType === "personal" ? { bookingIdentity: corporateCustomerId ? "enterprise_employee" : "personal", corporateCustomerId,
          enterpriseContractAndPayer: false } : undefined,
        startAt: rentalRange[0], endAt: rentalRange[1], services: [] };
      const value = await api.previewMarketingQuote(input); assert();
      if (generation === epoch.current) setResult(value);
    } catch (error) {
      if (isCurrentScope() && generation === epoch.current && !(error && typeof error === "object" && "errorFields" in error)) {
        const detail = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
        message.error(t(typeof detail === "string" ? detail : error instanceof Error ? error.message : "试算失败，请保留输入后重试"));
      }
      throw error;
    } finally { pending.current = false; if (isCurrentScope()) setBusy(false); }
  };
  if (!canQuote) return <Alert type="info" title={t("营销试算需要当前空间原报价权限")} />;
  if (!canItems || !canSettings || !canLocations || !canPrice) return <Alert type="warning" title={t("当前身份缺少试算所需的商品、定价或地点读取权限")} />;
  const money = (value?: number) => value === undefined || !result ? t("未提供") : formatRentalMoney(value, result.currency);
  return <QueryState loading={references.isPending} error={references.error} onRetry={references.refetch}>
    {refs && <>
      <Alert type="info" title={t("试算使用当前空间策略及已发布规则；不保存报价、不占库存或优惠券。")}
        description={t("能力准入和服务容量在正式报价时复核；不能凭试算结果下单。")} />
      <Form form={form} name="marketing-price-preview" layout="vertical" disabled={disabled}
        initialValues={{ customerType: "personal", discountPlanId: planId, lines: [{ quantity: 1 }] }} onValuesChange={invalidate}
        onSubmitCapture={event => { event.preventDefault(); event.stopPropagation(); void submit().catch(() => undefined); }}>
        <FormSection title={t("试算条件")}>
          <Row gutter={16}>
            <Col xs={24}><Alert type="info" title={t("营业时区：{zone}", { zone: refs.settings.calendar.timeZone ?? "Asia/Shanghai" })} /></Col>
            <Col xs={24} md={12}><Form.Item name="rentalRange" label={t("租赁时间")}
              getValueProps={(value?: [string, string]) => ({ value: value?.map(at => marketingDateBinding(refs.settings.calendar.timeZone ?? "Asia/Shanghai").getValueProps(at).value) })}
              getValueFromEvent={(value?: [Dayjs | null, Dayjs | null] | null) => value?.map(at => marketingDateBinding(refs.settings.calendar.timeZone ?? "Asia/Shanghai").getValueFromEvent(at))}
              rules={[{ required: true }, { validator: async (_, value?: [string, string]) => {
                if (!value?.[0] || !value[1]) throw new Error(t("请选择完整租期"));
                if (value.some(at => !marketingInstantValid(at))) throw new Error(t("该营业时点不存在或有夏令时歧义，请调整时点"));
                if (Date.parse(value[1]) <= Date.parse(value[0])) throw new Error(t("结束时点必须晚于开始时点"));
              } }]}><DatePicker.RangePicker showTime /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="fulfillmentMode" label={t("履约方式")} rules={[{ required: true }]}><Select
              options={refs.settings.fulfillment.enabledModes.map(value => ({ value, label: t(detailFulfillmentLabels[value] ?? value) }))} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="fulfillmentLocationId" label={t("领取地点")} rules={[{ required: true }]}><Select
              options={refs.locations.filter(row => row.status === "enabled").map(row => ({ value: row.id, label: row.name }))} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="returnLocationId" label={t("归还地点")}><Select allowClear placeholder={t("默认同领取地点")}
              options={refs.locations.filter(row => row.status === "enabled").map(row => ({ value: row.id, label: row.name }))} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="customerType" label={t("客户类型")} rules={[{ required: true }]}><Select
              onChange={() => { form.setFieldsValue({ customerId: undefined, corporateCustomerId: undefined, customerCouponId: undefined }); invalidate(); }}
              options={[{ value: "personal", label: t("个人客户") }, { value: "corporate", label: t("企业客户") }]} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="customerId" label={t("当前受权客户（可选）")}><Select allowClear
              disabled={customerType !== "personal" || !canMembers || members.isError || !members.data} loading={members.isFetching} placeholder={t("未选择客户")}
              onChange={() => { form.setFieldsValue({ corporateCustomerId: undefined, customerCouponId: undefined }); invalidate(); }}
              options={canMembers && !members.isError ? members.data?.map(row => ({ value: row.customerId, label: `${row.name} · ${row.phoneMasked}` })) : []} /></Form.Item></Col>
            {customerId && customerType === "personal" && <Col xs={24} md={12}><Form.Item name="corporateCustomerId" label={t("企业员工身份（可选）")}><Select allowClear
              disabled={!canMembers || companies.isError || !companies.data} loading={companies.isFetching} placeholder={t("默认个人身份")}
              options={canMembers && !companies.isError ? companies.data?.map(row => ({ value: row.corporateCustomerId, label: row.corporateCustomerName })) : []} /></Form.Item></Col>}
            <Col xs={24} md={12}><Form.Item name="discountPlanId" label={t("指定营销方案（可选）")}><Select allowClear placeholder={t("自动选择最低价")}
              options={plans.filter(row => row.published).map(row => ({ value: row.id, label: row.published!.name, disabled: row.status !== "enabled" }))} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="customerCouponId" label={t("客户优惠券编号（可选）")}><Input /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="deliveryAddressId" label={t("配送地址编号（配送时填写）")}><Input /></Form.Item></Col>
          </Row>
          <Form.List name="lines" rules={[{ validator: async (_, rows?: PreviewValues["lines"]) => { if (!rows?.length) throw new Error(t("至少选择一个商品")); } }]}>{(fields, { add, remove }, { errors }) => <>
            {fields.map(field => <Row key={field.key} gutter={16}>
              <Col xs={24} md={8}><Form.Item name={[field.name, "pricingGroupId"]} label={t("定价分组")}><Select allowClear
                options={refs.groups.filter(row => row.status === "enabled").map(row => ({ value: row.id, label: row.name }))} /></Form.Item></Col>
              <Col xs={24} md={8}><Form.Item name={[field.name, "itemGroupId"]} label={t("商品")} rules={[{ required: true }]}><Select
                options={refs.items.filter(row => row.status === "enabled").map(row => ({ value: row.id, label: row.name }))} /></Form.Item></Col>
              <Col xs={8} md={4}><Form.Item name={[field.name, "quantity"]} label={t("数量")} rules={[{ required: true }]}><InputNumber min={1} precision={0} /></Form.Item></Col>
              <Col xs={8} md={5}><Form.Item name={[field.name, "pricingUnit"]} label={t("计价单位")}><Select allowClear placeholder={t("自动")}
                options={[...new Set(refs.prices.flatMap(plan => plan.rates.map(rate => rate.unit)))].map(value => ({ value, label: t(RENTAL_PRICING_UNIT_LABELS[value]) }))} /></Form.Item></Col>
              <Col xs={8} md={4}><Form.Item name={[field.name, "usageQuantity"]} label={t("使用量")}><InputNumber min={0} /></Form.Item></Col>
              <Col xs={24} md={2}><Button type="text" danger disabled={fields.length === 1 || busy} onClick={() => { remove(field.name); invalidate(); }}>{t("移除")}</Button></Col>
            </Row>)}
            <Button disabled={busy || fields.length >= 100} onClick={() => { add({ quantity: 1 }); invalidate(); }}>{t("添加商品")}</Button><Form.ErrorList errors={errors} />
          </>}</Form.List>
        </FormSection>
        <ActionButton label={t("开始试算")} pending={busy} disabled={disabled} onAction={submit} />
      </Form>
      {result && <FormSection title={t("试算结果")}>
        <RecordFacts items={[{ key: "policy", label: "当前模式", value: t(result.pricingPolicy === "legacy" ? "旧优惠模式" : "单规则最低价") },
          { key: "base", label: "基础租金", value: money(result.rentalAmount) }, { key: "marketing", label: "营销后租金", value: money(result.marketing?.marketingRentalAmount) },
          { key: "coupon", label: "券减免", value: money(result.couponAmount) }, { key: "total", label: "最终应付", value: money(result.payableAmount) }]} />
        <Table rowKey={row => JSON.stringify([row.planId, "ruleId" in row ? row.ruleId : null])} dataSource={result.evaluations ?? []} pagination={false} columns={[
          { title: t("方案与规则"), key: "name", render: (_, row) => <DataTableText primary={row.planName} secondary={"ruleSnapshot" in row ? row.ruleSnapshot.name : row.planVersion} /> },
          { title: t("候选租金"), key: "candidate", render: (_, row) => "candidateRentalAmount" in row ? money(row.candidateRentalAmount) : t("旧策略独立减免") },
          { title: t("计算基数"), dataIndex: "base", render: value => money(value) }, { title: t("计算公式"), dataIndex: "formula" },
          { title: t("选择结果"), key: "reason", render: (_, row) => row.applied ? t("已选择") : row.skipDetail ?? row.skipReason ?? t("未选择") },
        ]} expandable={{ expandedRowRender: row => <RecordFacts items={row.eligibility.map((item, index) => ({ key: String(index), label: item.rule,
          value: `${t(item.passed ? "满足" : "不满足")}${item.detail ? ` · ${item.detail}` : ""}` }))} /> }} />
        <Table rowKey="code" dataSource={result.chargeLines} pagination={false} columns={[
          { title: t("费用项目"), dataIndex: "name" }, { title: t("金额"), dataIndex: "amount", render: value => money(value) }, { title: t("说明"), dataIndex: "detail" },
        ]} />
      </FormSection>}
    </>}
  </QueryState>;
}
