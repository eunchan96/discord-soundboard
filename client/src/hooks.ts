import { useCallback, useEffect, useRef, useState } from "react";

export interface Toast {
  kind: "ok" | "error";
  text: string;
}

export function useToast(durationMs = 3000) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback(
    (kind: Toast["kind"], text: string) => {
      window.clearTimeout(timer.current);
      setToast({ kind, text });
      timer.current = window.setTimeout(() => setToast(null), durationMs);
    },
    [durationMs],
  );
  return { toast, ok: (t: string) => show("ok", t), error: (t: string) => show("error", t) };
}

/** 화면이 보일 때만 주기적으로 실행 (WebSocket 도입 전 재생 상태 동기화용) */
export function usePolling(fn: () => void, intervalMs: number, enabled: boolean) {
  const saved = useRef(fn);
  saved.current = fn;

  useEffect(() => {
    if (!enabled) return;
    saved.current();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") saved.current();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, enabled]);
}

export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** 하단 고정 패널 높이를 CSS 변수로 노출해서 목록과 토스트가 가려지지 않게 합니다. */
export function usePanelHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty("--panel-h", `${Math.ceil(entry.target.getBoundingClientRect().height)}px`);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.setProperty("--panel-h", "0px");
    };
  }, []);
  return ref;
}

/**
 * 작은 화면(음성 채널 타일·PIP)인지. Discord 레이아웃 모드 이벤트를 우선 쓰고,
 * 이벤트가 오지 않는 환경에서도 창이 아주 작으면 축소 화면으로 보여줍니다.
 */
export function useCompact(subscribe: (cb: (mode: number) => void) => () => void): boolean {
  const [mode, setMode] = useState<number | null>(null);
  const [small, setSmall] = useState(() => window.innerHeight < 320 || window.innerWidth < 360);

  useEffect(() => subscribe(setMode), [subscribe]);
  useEffect(() => {
    const onResize = () => setSmall(window.innerHeight < 320 || window.innerWidth < 360);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (mode === 1 || mode === 2) return true; // PIP, GRID
  if (mode === 0) return false; // FOCUSED
  return small;
}

export function formatSeconds(s: number) {
  return s < 10 ? `${s.toFixed(1)}초` : `${Math.round(s)}초`;
}
