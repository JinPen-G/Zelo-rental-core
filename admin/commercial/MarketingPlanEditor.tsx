/** 规则草稿使用原Form/UIArc适配。只收集已支持的条件，不在页面计算租金；
 * 保存和发布分开，原修订及完整规则集合由服务端复验。 */
import { Alert, Button, DatePicker, Drawer, Form, FormSection, Input, SaveButton, Select } from "@rental-os/platform-admin/ui";
import { UnsavedChangesGuard } from "@rental-os/platform-admin/core";
import { useLocale } from "@rental-os/platform-admin/locale";
import { Col, InputNumber, Row, type FormInstance } from "antd";
import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { RENTAL_MARKETING_DURATION_UNITS, RENTAL_PRICING_UNIT_LABELS,
  type RentalMarketingPlan, type SaveRentalMarketingPlanDraftRequest } from "@rental-os/rental-core";
import { useOrderEditor } from "../orders/useOrderEditor";

export type MarketingDraftValues = Omit<SaveRentalMarketingPlanDraftRequest, "operationId" | "expectedRevision" | "id">;
export type MarketingReferences = { items?: Array<{ value: string; label: string }>; pricing?: Array<{ value: string; label: string }> };
export const marketingActionLabels = { percentage: "比例优惠", fixed_amount: "固定减免", threshold_amount: "满额减免", fixed_price: "完整租期固定租价" };
export const marketingStatusLabels = { draft: "草稿", enabled: "已发布", paused: "已暂停", ended: "已结束" };
export const marketingCustomerLabels = { all: "全部客户", personal: "个人客户", corporate: "企业客户", member: "会员" };
export const marketingDayLabels = { workday: "工作日", weekend: "周末", statutory_holiday: "法定节假日", makeup_workday: "调休工作日", tenant_special: "商户特殊日" };
const dateBinding = { getValueProps: (value?: string) => ({ value: value ? dayjs(value) : null }),
  getValueFromEvent: (value?: Dayjs | null) => value?.toISOString() };
export const newMarketingRule = (): MarketingDraftValues["rules"][number] => ({ id: `rule_${crypto.randomUUID()}`,
  name: "", status: "enabled", priority: 0, conditions: {}, action: { type: "percentage", value: 10 } });

export function marketingDraftValues(plan?: RentalMarketingPlan): MarketingDraftValues {
  const original = plan?.draft ?? plan?.published;
  return original ? { code: original.code, name: original.name, pricingPolicy: "single_rule_v1", appliesTo: "rental",
    minimumSpend: original.minimumSpend, customerScope: original.customerScope, applicableItemGroupIds: [...original.applicableItemGroupIds],
    applicablePricingGroupIds: [...(original.applicablePricingGroupIds ?? [])], applicableDayTypes: [...original.applicableDayTypes],
    priority: original.priority, effectiveFrom: original.effectiveFrom, effectiveTo: original.effectiveTo,
    rules: original.rules.map(({ version: _version, ...rule }) => structuredClone(rule)), changeReason: "" }
    : { code: "", name: "", pricingPolicy: "single_rule_v1", appliesTo: "rental", minimumSpend: 0, customerScope: "all",
      applicableItemGroupIds: [], applicablePricingGroupIds: [], applicableDayTypes: [], priority: 0,
      effectiveFrom: new Date().toISOString(), rules: [newMarketingRule()], changeReason: "" };
}

/** 清空可选字段保持undefined，避免把清空的null当0或保留隐藏的旧动作参数。 */
export function normalizeMarketingDraft(values: MarketingDraftValues): MarketingDraftValues {
  const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value, (_key, item) => item === null ? undefined : item));
  const result = clean(values);
  result.pricingPolicy = "single_rule_v1"; result.appliesTo = "rental";
  result.rules = result.rules.map(rule => {
    const duration = rule.conditions.rentalDuration;
    if (duration && !duration.unit && duration.minimum === undefined && duration.maximum === undefined) delete rule.conditions.rentalDuration;
    if (rule.action.type !== "threshold_amount") delete rule.action.thresholdAmount;
    return rule;
  });
  return result;
}

function ScopeFields({ prefix, references, common = false, parent = [] }: { prefix: Array<string | number>; references: MarketingReferences; common?: boolean; parent?: string[] }) {
  const { t } = useLocale(), name = (field: string) => [...prefix, field];
  return <Row gutter={16}>
    <Col xs={24} md={12}><Form.Item name={name("customerScope")} label={t("适用客户")}><Select allowClear={!common}
      options={Object.entries(marketingCustomerLabels).map(([value, label]) => ({ value, label: t(label) }))} /></Form.Item></Col>
    <Col xs={24} md={12}><Form.Item name={name("minimumSpend")} label={t("基础租金门槛")} rules={common ? [{ required: true }] : []}>
      <InputNumber min={0} precision={2} /></Form.Item></Col>
    <Col xs={24} md={12}><Form.Item name={name("applicableItemGroupIds")} label={t("适用商品")}>
      <Select mode="multiple" showSearch={false} disabled={!references.items} options={references.items}
        placeholder={t(references.items ? "留空表示全部" : "关联资料不可用，保留原范围")} /></Form.Item></Col>
    <Col xs={24} md={12}><Form.Item name={name("applicablePricingGroupIds")} label={t("适用定价分组")}>
      <Select mode="multiple" showSearch={false} disabled={!references.pricing} options={references.pricing}
        placeholder={t(references.pricing ? "留空表示全部" : "关联资料不可用，保留原范围")} /></Form.Item></Col>
    <Col xs={24}><Form.Item name={name("applicableDayTypes")} label={t("适用日类型")}><Select mode="multiple" showSearch={false}
      placeholder={t("留空表示全部")} options={Object.entries(marketingDayLabels).map(([value, label]) => ({ value, label: t(label) }))} /></Form.Item></Col>
    <Col xs={24} md={12}><Form.Item name={name("effectiveFrom")} label={t("用租开始时点下限")} {...dateBinding}
      rules={common ? [{ required: true }] : []}><DatePicker showTime /></Form.Item></Col>
    <Col xs={24} md={12}><Form.Item name={name("effectiveTo")} label={t("用租开始时点上限")} {...dateBinding}
      dependencies={[[...parent, ...name("effectiveFrom")]]}
      rules={[({ getFieldValue }) => ({ validator: async (_, value: string | undefined) => {
        const start = getFieldValue([...parent, ...name("effectiveFrom")]);
        if (value && start && Date.parse(value) <= Date.parse(start)) throw new Error(t("结束时点必须晚于开始时点"));
      } })]}><DatePicker showTime /></Form.Item></Col>
  </Row>;
}

function RuleFields({ index, form, references, remove, removable }: { index: number; form: FormInstance<MarketingDraftValues>;
  references: MarketingReferences; remove: () => void; removable: boolean }) {
  // Form.List已提供rules前缀；控件名用相对路径，跨字段读取使用完整路径。
  const { t } = useLocale(), name = (field: string) => [index, field], valueName = (field: string) => ["rules", ...name(field)];
  const type = Form.useWatch(["rules", index, "action", "type"], form);
  return <FormSection title={t("规则 {index}", { index: index + 1 })}>
    <Form.Item name={name("id")} hidden><Input /></Form.Item>
    <Row gutter={16}>
      <Col xs={24} md={12}><Form.Item name={name("name")} label={t("规则名称")} rules={[{ required: true, whitespace: true, max: 191 }]}><Input /></Form.Item></Col>
      <Col xs={12} md={6}><Form.Item name={name("status")} label={t("规则状态")} rules={[{ required: true }]}><Select
        options={[{ value: "enabled", label: t("启用") }, { value: "disabled", label: t("停用") }]} /></Form.Item></Col>
      <Col xs={12} md={6}><Form.Item name={name("priority")} label={t("同价优先级")} rules={[{ required: true }]}><InputNumber min={0} precision={0} /></Form.Item></Col>
    </Row>
    <ScopeFields prefix={[index, "conditions"]} parent={["rules"]} references={references} />
    <Row gutter={16}>
      <Col xs={24} md={8}><Form.Item name={[...name("conditions"), "rentalDuration", "unit"]} label={t("租期计价单位")}
        rules={[{ required: type === "fixed_price" }]}><Select allowClear options={RENTAL_MARKETING_DURATION_UNITS.map(value => ({ value, label: t(RENTAL_PRICING_UNIT_LABELS[value]) }))} /></Form.Item></Col>
      <Col xs={12} md={8}><Form.Item name={[...name("conditions"), "rentalDuration", "minimum"]} label={t("最短计费数量")}><InputNumber min={0.01} /></Form.Item></Col>
      <Col xs={12} md={8}><Form.Item name={[...name("conditions"), "rentalDuration", "maximum"]} label={t("最长计费数量")}
        dependencies={[[...valueName("conditions"), "rentalDuration", "minimum"], [...valueName("conditions"), "rentalDuration", "unit"], [...valueName("action"), "type"]]}
        rules={[({ getFieldValue }) => ({ validator: async (_, maximum?: number) => {
          const duration = getFieldValue([...valueName("conditions"), "rentalDuration"]), action = getFieldValue([...valueName("action"), "type"]);
          if (!duration?.unit && (duration?.minimum != null || maximum != null))
            throw new Error(t("填写时长界限时必须选择租期计价单位"));
          if ((duration?.unit || action === "fixed_price") && duration?.minimum == null && maximum == null)
            throw new Error(t("租期条件至少填写一个时长界限"));
          if (maximum != null && duration?.minimum != null && maximum < duration.minimum)
            throw new Error(t("最长计费数量不能小于最短计费数量"));
        } })]}><InputNumber min={0.01} /></Form.Item></Col>
      <Col xs={24} md={12}><Form.Item name={[...name("action"), "type"]} label={t("优惠方式")} rules={[{ required: true }]}><Select
        options={Object.entries(marketingActionLabels).map(([value, label]) => ({ value, label: t(label) }))} /></Form.Item></Col>
      <Col xs={24} md={12}><Form.Item name={[...name("action"), "value"]} label={t(type === "percentage" ? "减免比例（%）" : type === "fixed_price" ? "每件完整租期金额" : "减免金额")}
        rules={[{ required: true }]}><InputNumber min={type === "fixed_price" ? 0 : 0.01} max={type === "percentage" ? 100 : undefined} precision={2} /></Form.Item></Col>
      {type === "threshold_amount" && <Col xs={24} md={12}><Form.Item name={[...name("action"), "thresholdAmount"]} label={t("满额门槛")} rules={[{ required: true }]}><InputNumber min={0.01} precision={2} /></Form.Item></Col>}
      <Col xs={24} md={12}><Form.Item name={[...name("action"), "maximumDiscount"]} label={t("最大减免金额")}><InputNumber min={0.01} precision={2} /></Form.Item></Col>
    </Row>
    {type === "fixed_price" && <Alert type="info" title={t("固定租价按每件完整租期计算，只乘标的数量一次。使用量及事后费用仍按原规则处理。")} />}
    <Button type="text" danger disabled={!removable} onClick={remove}>{t("移除规则")}</Button>
  </FormSection>;
}

export function MarketingPlanEditor({ open, plan, references, disabled, onSave, onClose, onExited, onError }: {
  open: boolean; onExited: () => void;
  plan?: RentalMarketingPlan; references: MarketingReferences; disabled: boolean;
  onSave: (value: MarketingDraftValues) => Promise<unknown>; onClose: () => void; onError: (error: unknown) => void;
}) {
  const { t } = useLocale(), [form] = Form.useForm<MarketingDraftValues>();
  const [initial] = useState(() => marketingDraftValues(plan));
  const editor = useOrderEditor({ form, identity: plan ? `${plan.id}:${plan.revision}` : "new-marketing-plan", disabled,
    onSave: value => onSave(normalizeMarketingDraft(value)), onError });
  return <Drawer open={open} size="large" title={t(plan ? "编辑营销草稿" : "新建营销方案")}
    afterOpenChange={visible => { if (!visible) onExited(); }}
    maskClosable={!editor.busy} keyboard={!editor.busy} onClose={() => editor.dismiss(onClose)}
    extra={<SaveButton label={t("保存草稿")} form={form} disabled={disabled} pending={editor.busy} onSave={editor.submit} />}>
    <UnsavedChangesGuard dirty={editor.dirty} />
    <Form form={form} name="rental-marketing-draft" layout="vertical" initialValues={initial} disabled={disabled || editor.busy} {...editor.formProps}>
      <FormSection title={t("方案公共条件")} description={t("规则在公共范围内细分；只选择营销后整单租金最低的一条。")}> 
        <Form.Item name="pricingPolicy" hidden><Input /></Form.Item><Form.Item name="appliesTo" hidden><Input /></Form.Item>
        <Row gutter={16}>
          <Col xs={24} md={12}><Form.Item name="code" label={t("方案编码")} rules={[{ required: true, whitespace: true, max: 191 }]}><Input disabled={Boolean(plan) || disabled || editor.busy} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="name" label={t("方案名称")} rules={[{ required: true, whitespace: true, max: 191 }]}><Input /></Form.Item></Col>
          <Col xs={24}><Form.Item name="priority" label={t("同价优先级")} rules={[{ required: true }]}><InputNumber min={0} precision={0} /></Form.Item></Col>
        </Row>
        <ScopeFields prefix={[]} references={references} common />
      </FormSection>
      {(!references.items || !references.pricing) && <Alert type="info" title={t("关联资料不可用，保留原范围")} />}
      <Form.List name="rules" rules={[{ validator: async (_, rows?: MarketingDraftValues["rules"]) => {
        if (!rows?.length || rows.length > 100) throw new Error(t("方案须包含1至100条规则"));
      } }]}>{(fields, { add, remove }, { errors }) => <>
        {fields.map(field => <RuleFields key={field.key} index={field.name} form={form} references={references}
          removable={fields.length > 1} remove={() => remove(field.name)} />)}
        <Button disabled={fields.length >= 100} onClick={() => add(newMarketingRule())}>{t("添加规则")}</Button>
        <Form.ErrorList errors={errors} />
      </>}</Form.List>
      <Form.Item name="changeReason" label={t("变更原因")} rules={[{ required: true, whitespace: true, max: 500 }]}><Input.TextArea maxLength={500} /></Form.Item>
    </Form>
  </Drawer>;
}
