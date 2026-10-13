"use client";
import { useCallback, useEffect, useRef, type FocusEvent } from "react";

/** Trả focus về tìm kiếm nếu một thao tác làm dòng đang chọn biến mất khỏi bộ lọc. */
export function useFilteredListFocus(visibleRows: readonly unknown[], searchId: string) {
  const focused = useRef<HTMLElement | null>(null);
  const onFocusCapture = useCallback((event: FocusEvent<HTMLUListElement>) => {
    if (event.target instanceof HTMLElement) focused.current = event.target;
  }, []);
  useEffect(() => {
    if (focused.current && !focused.current.isConnected && document.activeElement === document.body) {
      document.getElementById(searchId)?.focus();
      focused.current = null;
    }
  }, [visibleRows, searchId]);
  return onFocusCapture;
}
