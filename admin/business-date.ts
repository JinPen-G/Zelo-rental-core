/** 表单只转换营业挂钟与ISO时点；不计算营销资格或库存。原时点原样保留，新DST歧义由表单拒绝。 */
import dayjs, { type Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import { businessInstantsFromLocal, businessLocalDateTime } from "@rental-os/rental-core/business-day";
dayjs.extend(utc);

export function businessDateBinding(timeZone?: string, original?: string) {
  // UTC模式只承载挂钟字段，防止浏览器自己的DST改掉输入；日期控件须使用needConfirm兼容分支。
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
export const businessInstantValid = (value?: string) => value === undefined || /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
