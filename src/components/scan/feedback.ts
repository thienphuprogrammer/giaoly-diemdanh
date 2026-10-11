"use client";
import { useCallback, useSyncExternalStore } from "react";
import { FEEDBACK_STORAGE_KEY, parseFeedbackSetting, serializeFeedbackSetting } from "@/lib/attendance/scan-feedback";

const listeners = new Set<() => void>();
/** Giá trị trong phiên khi localStorage không ghi được (chế độ riêng tư, bị chặn…). */
let sessionOverride: boolean | null = null;
let audio: AudioContext | null = null;

function readSetting(): boolean {
  if (sessionOverride !== null) return sessionOverride;
  try {
    return parseFeedbackSetting(window.localStorage.getItem(FEEDBACK_STORAGE_KEY));
  } catch {
    return true;
  }
}

function writeSetting(on: boolean) {
  try {
    window.localStorage.setItem(FEEDBACK_STORAGE_KEY, serializeFeedbackSetting(on));
    sessionOverride = null;
  } catch {
    sessionOverride = on;
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  window.addEventListener("storage", notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
}

/** Công tắc rung/tiếng bíp; mặc định bật, nhớ theo máy. */
export function useScanFeedbackSetting(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, readSetting, () => true);
  const set = useCallback((next: boolean) => {
    writeSetting(next);
    if (next) unlockAudio(); // bấm công tắc là cử chỉ người dùng: mở khóa âm thanh cho các lần bíp sau
  }, []);
  return [on, set];
}

function unlockAudio() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audio ??= new Ctor();
    void audio.resume().catch(() => undefined);
  } catch { /* không có âm thanh: bỏ qua */ }
}

function beep(frequency: number, durationMs: number) {
  unlockAudio();
  if (!audio || audio.state !== "running") return;
  try {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = frequency;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + durationMs / 1000);
  } catch { /* bỏ qua */ }
}

/** Rung + bíp ngắn sau mỗi lượt quét, chỉ khi người dùng để bật. */
export function playScanFeedback(kind: "ok" | "error") {
  if (!readSetting()) return;
  try { navigator.vibrate?.(kind === "ok" ? 30 : [60, 40, 60]); } catch { /* không hỗ trợ */ }
  if (kind === "ok") beep(880, 80);
  else beep(220, 160);
}
