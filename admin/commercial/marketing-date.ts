/** 日期适配只做营业挂钟与ISO传输的转换，不计算活动资格。DST歧义保持输入并交表单明确拒绝。 */
import dayjs, { type Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import { businessInstantsFromLocal, businessLocalDateTime } from "@rental-os/rental-core/business-day";
dayjs.extend(utc);

export function marketingDateBinding(timeZone?: string, original?: string) {
  // UTC模式仅承载不带偏移的挂钟字段，防止浏览器自己的DST先改掉输入；使用公共日期控件的needConfirm兼容分支。
  return { getValueProps: (value?: string) => ({ value: value ? dayjs.utc(timeZone && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    ? businessLocalDateTime(value, timeZone) : value) : null }),
  getValueFromEvent: (value?: Dayjs | null) => {
    if (!value) return undefined;
    const local = value.format("YYYY-MM-DDTHH:mm:ss");
    if (!timeZone) return original ?? local;
    if (original && /(?:Z|[+-]\d{2}:\d{2})$/i.test(original) && businessLocalDateTime(original, timeZone) === local) return original;
    const candidates = businessInstantsFromLocal(local, timeZone);
    return candidates.length === 1 ? candidates[0] : local;
  } };
}
export const marketingInstantValid = (value?: string) => value === undefined || /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
