"use client";
import { useCallback, useSyncExternalStore } from "react";
import { parseScanMode, scanModeKey } from "@/lib/attendance/scan-mode-memory";
import type { ScanMode } from "@/lib/attendance/scan-rules";

const listeners = new Set<() => void>();
/** Dự phòng trong bộ nhớ khi sessionStorage bị chặn (chế độ riêng tư, chính sách trình duyệt…). */
const fallback = new Map<string, ScanMode>();

function read(sessionId: string): ScanMode {
  const kept = fallback.get(sessionId);
  if (kept) return kept;
  try {
    return parseScanMode(window.sessionStorage.getItem(scanModeKey(sessionId)));
  } catch {
    return "present";
  }
}

function write(sessionId: string, mode: ScanMode) {
  try {
    window.sessionStorage.setItem(scanModeKey(sessionId), mode);
    fallback.delete(sessionId);
  } catch {
    fallback.set(sessionId, mode);
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}

/** Chế độ quét (Có mặt / Đi muộn) nhớ trong buổi: tải lại trang hay quay lại màn quét vẫn giữ. */
export function useRememberedScanMode(sessionId: string): [ScanMode, (mode: ScanMode) => void] {
  const mode = useSyncExternalStore(subscribe, () => read(sessionId), () => "present" as const);
  const set = useCallback((next: ScanMode) => write(sessionId, next), [sessionId]);
  return [mode, set];
}
