/** 有限营销条件表单；只提交原合同，地点选项取受权读口，资格和金额仍由Core裁定。 */
import { DatePicker, Form, Input, Select } from "@rental-os/platform-admin/ui";
import { Col, InputNumber, Row } from "antd";
import { useLocale } from "@rental-os/platform-admin/locale";
import { RENTAL_FULFILLMENT_MODES, type RentalMarketingQualification } from "@rental-os/rental-core";
import { detailFulfillmentLabels } from "../orders/orderDetailPresentation";
import { marketingDateBinding, marketingInstantValid } from "./marketing-date";

export const marketingWindowLabels = { activity: "活动有效期", booking: "下单时间窗", rental: "完整用租时间窗" };
export const marketingAudienceLabels = { operator: "运营端", staff: "员工端", client: "客户渠道" };
export function MarketingQualificationFields({ prefix, parent, timeZone, locations, original }: {
  prefix: Array<string | number>; parent: string[]; timeZone?: string;
  locations?: Array<{ value: string; label: string }>; original?: RentalMarketingQualification;
}) {
  const { t } = useLocale(), name = (...fields: string[]) => [...prefix, "qualification", ...fields];
  return <Row gutter={16}>
    {(["activityWindow", "bookingWindow", "rentalWindow"] as const).map((kind, index) => <Col xs={24} key={kind}><Row gutter={16}>
      {(["from", "to"] as const).map(edge => <Col xs={24} md={12} key={edge}><Form.Item name={name(kind, edge)}
        label={t(`${Object.values(marketingWindowLabels)[index]}${edge === "from" ? "起点" : "终点"}`)}
        {...marketingDateBinding(timeZone, original?.[kind]?.[edge])} dependencies={[[...parent, ...name(kind, "from")]]}
        rules={[({ getFieldValue }) => ({ validator: async (_, value?: string) => {
          if (!marketingInstantValid(value)) throw new Error(t("该营业时点不存在或有夏令时歧义，请调整时点"));
          const from = getFieldValue([...parent, ...name(kind, "from")]);
          if (edge === "to" && from && value && Date.parse(value) <= Date.parse(from)) throw new Error(t("结束时点必须晚于开始时点"));
        } })]}><DatePicker showTime needConfirm disabled={timeZone ? undefined : true} /></Form.Item></Col>)}
    </Row></Col>)}
    {(["bookingTime", "rentalStartTime"] as const).map(kind => <Col xs={24} key={kind}><Row gutter={16}>
      {(["start", "end"] as const).map(edge => <Col xs={12} key={edge}><Form.Item name={name(kind, edge)}
        label={t(`${kind === "bookingTime" ? "每日下单" : "每日起租"}${edge === "start" ? "开始" : "结束"}`)}
        dependencies={[[...parent, ...name(kind, edge === "start" ? "end" : "start")]]}
        rules={[({ getFieldValue }) => ({ validator: async (_, value?: string) => {
          const other = getFieldValue([...parent, ...name(kind, edge === "start" ? "end" : "start")]);
          if (!value && !other) return;
          if (!value || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) || value === other) throw new Error(t("时段须填写不同的HH:mm起止，结束较早表示跨午夜"));
        } })]}><Input placeholder="HH:mm" maxLength={5} disabled={timeZone ? undefined : true} /></Form.Item></Col>)}
    </Row></Col>)}
    <Col xs={12}><Form.Item name={name("advanceBookingHours", "minimum")} label={t("最少提前小时")}><InputNumber min={0} /></Form.Item></Col>
    <Col xs={12}><Form.Item name={name("advanceBookingHours", "maximum")} label={t("最多提前小时")}
      dependencies={[[...parent, ...name("advanceBookingHours", "minimum")]]} rules={[({ getFieldValue }) => ({ validator: async (_, value?: number) => {
        const min = getFieldValue([...parent, ...name("advanceBookingHours", "minimum")]);
        if (value != null && min != null && value < min) throw new Error(t("最大值不能小于最小值"));
      } })]}><InputNumber min={0} /></Form.Item></Col>
    {(["fulfillmentLocationIds", "returnLocationIds"] as const).map(kind => <Col xs={24} md={12} key={kind}>
      <Form.Item name={name(kind)} label={t(kind === "fulfillmentLocationIds" ? "适用领取地点" : "适用归还地点")}>
        <Select mode="multiple" showSearch={false} disabled={locations ? undefined : true} options={locations} placeholder={t(locations ? "留空表示全部" : "关联资料不可用，保留原范围")} /></Form.Item>
    </Col>)}
    <Col xs={24} md={12}><Form.Item name={name("fulfillmentModes")} label={t("适用履约方式")}><Select mode="multiple" showSearch={false}
      options={RENTAL_FULFILLMENT_MODES.map(value => ({ value, label: t(detailFulfillmentLabels[value] ?? value) }))} /></Form.Item></Col>
    <Col xs={24} md={12}><Form.Item name={name("audiences")} label={t("受信下单来源")}><Select mode="multiple" showSearch={false}
      options={Object.entries(marketingAudienceLabels).map(([value, label]) => ({ value, label: t(label) }))} /></Form.Item></Col>
  </Row>;
}
