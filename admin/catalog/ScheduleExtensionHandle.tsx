/** 时间轴末端仅准备延长建议，原条带始终保持服务端事实。键盘/点击打开同一表单。 */
import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { extendedOrderEndAt } from "../orders/orderExtensionPreparation";
import styles from "./AssetSchedulePage.module.css";

export function ScheduleExtensionHandle({ originalEndAt, startAt, endAt, lane, label, format, canPrepare, onPrepare }: {
  originalEndAt: string; startAt: string; endAt: string; lane: number; label: string;
  format: (value: string) => string;
  canPrepare: () => boolean;
  onPrepare: (newEndAt?: string) => void;
}) {
  const drag = useRef<{ pointer: number; x: number; scroll: number; width: number; moved: boolean } | undefined>(undefined);
  const active = useRef(true);
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; drag.current = undefined; }; }, []);
  const suppressClick = useRef(false);
  const [candidate, setCandidate] = useState<string>();
  const from = Date.parse(startAt), to = Date.parse(endAt), original = Date.parse(originalEndAt);
  const position = (instant: number) => (instant - from) / (to - from) * 100;
  const proposal = (event: PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!active.current || !state || state.pointer !== event.pointerId || !canPrepare()) return undefined;
    const track = event.currentTarget.closest<HTMLElement>("[data-schedule-track]")!;
    if (track.getBoundingClientRect().width !== state.width) return undefined;
    const scroll = track.closest("[data-schedule-scroll]")?.scrollLeft ?? 0;
    const delta = event.clientX - state.x + scroll - state.scroll;
    if (Math.abs(delta) >= 4) state.moved = true;
    return state.moved ? extendedOrderEndAt(originalEndAt, Math.min(Math.floor((to - original) / 60000), Math.round(delta / state.width * (to - from) / 60000))) : undefined;
  };
  const cancel = (button: HTMLButtonElement) => {
    const pointer = drag.current?.pointer;
    drag.current = undefined; setCandidate(undefined);
    if (pointer !== undefined && button.hasPointerCapture(pointer)) button.releasePointerCapture(pointer);
  };
  return <>
    {candidate && <span className={styles.extensionPreview} style={{ left: `${position(original)}%`, width: `${position(Date.parse(candidate)) - position(original)}%`, top: `${lane * 40 + 8}px` }}>
      <span className={styles.extensionTime} role="status">{format(candidate)}</span>
    </span>}
    <button type="button" className={styles.extensionHandle} aria-label={label} title={label}
      style={{ left: `${position(original)}%`, top: `${lane * 40 + 8}px` }}
      onPointerDown={event => {
        if (!active.current || event.button !== 0 || !event.isPrimary || !canPrepare()) return;
        const track = event.currentTarget.closest<HTMLElement>("[data-schedule-track]")!, width = track.getBoundingClientRect().width;
        if (width <= 0) return;
        suppressClick.current = false;
        drag.current = { pointer: event.pointerId, x: event.clientX, scroll: track.closest("[data-schedule-scroll]")?.scrollLeft ?? 0, width, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => { if (drag.current?.pointer === event.pointerId) setCandidate(proposal(event)); }}
      onPointerUp={event => {
        if (drag.current?.pointer !== event.pointerId) return;
        const next = proposal(event), moved = drag.current.moved;
        suppressClick.current = moved;
        cancel(event.currentTarget);
        if (moved && next && canPrepare()) onPrepare(next);
      }}
      onPointerCancel={event => { suppressClick.current = true; cancel(event.currentTarget); }}
      onLostPointerCapture={event => { if (drag.current) { suppressClick.current = true; cancel(event.currentTarget); } }}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); suppressClick.current = true; cancel(event.currentTarget); } }}
      onClick={event => {
        if (event.detail && suppressClick.current) { suppressClick.current = false; return; }
        if (active.current && canPrepare()) onPrepare();
      }}>↔</button>
  </>;
}
