/** 只有用户显式采用建议才打开原续租表单；导航和读取建议不触发试算、锁定或业务写入。 */
import { useLayoutEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, Button } from "@rental-os/platform-admin/ui";
import { useLocale } from "@rental-os/platform-admin/locale";
import type { RentalOrder } from "@rental-os/rental-core";
import { discardOrderExtensionPreparation, readOrderExtensionPreparation, type OrderExtensionPreparation } from "./orderExtensionPreparation";

export function OrderExtensionPreparationNotice({ order, ready, canPrepare, onPrepare }: {
  order: RentalOrder; ready: boolean; canPrepare: boolean;
  onPrepare: (value: Readonly<OrderExtensionPreparation>) => boolean;
}) {
  const [search, setSearch] = useSearchParams(), { t, locale } = useLocale();
  const reference = search.get("extensionPreparation");
  const active = useRef(true), live = useRef({ order, ready, canPrepare, onPrepare, reference });
  live.current = { order, ready, canPrepare, onPrepare, reference };
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const proposal = reference && ready ? readOrderExtensionPreparation(reference, order) : undefined;
  if (!reference || !ready) return null;
  const dismiss = () => {
    if (!active.current || live.current.reference !== reference) return;
    discardOrderExtensionPreparation(reference);
    setSearch(previous => { const next = new URLSearchParams(previous); next.delete("extensionPreparation"); return next; }, { replace: true });
  };
  const format = (value: string) => new Intl.DateTimeFormat(locale, { timeZone: proposal!.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
  return <Alert showIcon type={proposal ? "info" : "warning"} title={t(proposal ? "排班续租建议" : "排班续租建议已失效")}
    description={proposal ? <>{format(proposal.originalEndAt)} → {format(proposal.newEndAt)} · {proposal.timeZone}<br />{t("采用后进入原续租表单，仍需试算及确认。")}</>
      : t("订单、范围或页面已变化，请重新准备时间，或使用原续租入口。")}
    action={<>{proposal && <Button disabled={!canPrepare} onClick={() => {
      const current = live.current;
      if (!active.current || current.reference !== reference || !current.ready || !current.canPrepare) return;
      const value = readOrderExtensionPreparation(reference, current.order);
      if (value && current.onPrepare(value)) dismiss();
    }}>{t("采用时间并打开续租")}</Button>}<Button onClick={dismiss}>{t("放弃建议")}</Button></>} />;
}
