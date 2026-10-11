import type { ScanOutcome, UndoOutcome, ScanRosterEntry } from "@/server/services/scan";

export type Transport<T> =
  | { kind: "response"; status: number; body: { ok: true; data: T } | { ok: false; code: string; error: string } }
  | { kind: "network" };

/** Lỗi mạng, timeout, 5xx và 429 coi là "chưa rõ kết quả" (gửi lại cùng event_id). Mọi phản hồi khác là kết quả cuối. */
export async function postJson<T>(url: string, body: unknown, timeoutMs = 8000): Promise<Transport<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal, credentials: "same-origin" });
    if (res.status >= 500 || res.status === 429) return { kind: "network" };
    const json = await res.json().catch(() => null);
    return json ? { kind: "response", status: res.status, body: json } : { kind: "network" };
  } catch {
    return { kind: "network" };
  } finally {
    clearTimeout(timer);
  }
}

export const sendScan = (payload: unknown) => postJson<ScanOutcome>("/api/diem-danh/quet", payload);
export const sendUndo = (payload: unknown) => postJson<UndoOutcome>("/api/diem-danh/hoan-tac", payload);

export interface RosterResponse { sessionId: string; classId: string; heldOn: string; cancelled: boolean; students: ScanRosterEntry[] }

export async function fetchRoster(sessionId: string): Promise<RosterResponse | null> {
  try {
    const res = await fetch(`/api/diem-danh/bang-tra?sessionId=${encodeURIComponent(sessionId)}`, { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.ok ? (json.data as RosterResponse) : null;
  } catch {
    return null;
  }
}
