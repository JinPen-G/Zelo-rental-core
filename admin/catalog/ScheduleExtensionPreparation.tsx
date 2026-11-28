/** 拖动和键盘共用时间建议表单；仅定位原订单，库存冲突、费用及补款仍由原续租办理。 */
import { Alert, Button, Form, Modal, RecordFacts, SaveButton } from "@rental-os/platform-admin/ui";
import { InputNumber } from "antd";
import { useLocale } from "@rental-os/platform-admin/locale";
import { useOrderEditor } from "../orders/useOrderEditor";
import { extendedOrderEndAt } from "../orders/orderExtensionPreparation";

export function ScheduleExtensionPreparation({ orderNo, assetNo, originalEndAt, newEndAt, timeZone, canPrepare, onContinue, onClose }: {
  orderNo: string; assetNo?: string; originalEndAt: string; newEndAt?: string; timeZone: string;
  canPrepare: () => boolean; onContinue: (newEndAt: string) => void; onClose: () => void;
}) {
  const { t, locale } = useLocale();
  const [form] = Form.useForm<{ minutes: number }>();
  const minutes = Form.useWatch("minutes", form);
  const proposed = extendedOrderEndAt(originalEndAt, minutes);
  const format = (value: string) => new Intl.DateTimeFormat(locale, { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
  const editor = useOrderEditor({ form, identity: originalEndAt, disabled: !canPrepare(), onSave: async values => {
    const next = extendedOrderEndAt(originalEndAt, values.minutes);
    if (!next || !canPrepare()) throw new Error(t("排班或权限已变化，请刷新后重新准备"));
    onContinue(next);
  } });
  return <Modal open title={t("准备订单续租")} onCancel={() => editor.dismiss(onClose)} destroyOnHidden
    footer={<><Button disabled={editor.busy} onClick={() => editor.dismiss(onClose)}>{t("取消")}</Button>
      <SaveButton label={t("进入原订单核对")} form={form} disabled={editor.busy} onSave={editor.submit} /></>}>
    <Form form={form} layout="vertical" {...editor.formProps} initialValues={{ minutes: newEndAt ? Math.round((Date.parse(newEndAt) - Date.parse(originalEndAt)) / 60000) : 60 }}>
      <Alert type="info" showIcon title={t("续租作用于整张订单")}
        description={t("进入订单后核对建议时间，再试算后续库存与费用。需补款时沿原流程付款后生效。")}/>
      <RecordFacts items={[{ key: "order", label: t("原订单"), value: orderNo },
        ...(assetNo ? [{ key: "asset", label: t("当前资产"), value: assetNo }] : []),
        { key: "zone", label: t("营业时区"), value: timeZone }, { key: "original", label: t("当前归还时间"), value: format(originalEndAt) }]} />
      <Form.Item name="minutes" label={t("延长时长（分钟）")} rules={[{ required: true, type: "integer", min: 1, message: t("请输入大于零的整数分钟") }]}>
        <InputNumber min={1} precision={0} />
      </Form.Item>
      <p role="status">{t("建议归还时间")}：{proposed ? `${format(proposed)} · ${timeZone}` : t("请填写延长时长")}</p>
      {Boolean(editor.error) && <Alert type="error" showIcon title={editor.error instanceof Error ? editor.error.message : t("无法准备续租")}/>}</Form>
  </Modal>;
}
