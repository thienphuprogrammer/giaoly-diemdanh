"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { filterRoster } from "@/lib/attendance/roster-search";
import { MAX_SEND_ATTEMPTS, backoffMs, canEnqueue, initialQueue, nextWakeAt, pendingCount, queueReducer, recentEvents, sendable, summarizeQueue, unsavedSummary, type QueuedEvent } from "@/lib/attendance/scan-queue";
import { decideScan, type CurrentMark, type ScanMode } from "@/lib/attendance/scan-rules";
import type { AttendanceStatus } from "@/lib/attendance/warning";
import { parseQrPayload } from "@/lib/qr/payload";
import type { ScanRosterEntry } from "@/server/services/scan";
import { fetchRoster, sendScan, sendUndo, type RosterResponse } from "./api";
import { playScanFeedback } from "./feedback";

export const INVALID_CARD = "Thẻ không dùng được cho lớp này";
const ROSTER_COOLDOWN_MS = 10_000;
/** Trễ thêm khi đánh thức hàng gửi, để mốc chờ chắc chắn đã qua. */
const WAKE_SLACK_MS = 25;

export interface Banner { tone: "applied" | "noop" | "error" | "info"; fullName?: string; saintName?: string | null; status?: AttendanceStatus | null; text: string }
export interface PendingConfirm {
  entry: ScanRosterEntry;
  current: "absent_excused" | "absent_unexcused";
  defaultStatus: "present" | "late";
  kind: "scan" | "manual";
  /** Lượt máy chủ trả "cần chọn"; được bỏ khỏi danh sách cần xử lý khi người dùng đã quyết định. */
  eventId?: string;
}

const isAbsence = (s: AttendanceStatus | null | undefined): s is "absent_excused" | "absent_unexcused" =>
  s === "absent_excused" || s === "absent_unexcused";

type Marks = ReadonlyMap<string, CurrentMark | null>;
const toMark = (status: AttendanceStatus | null, reason: string | null = null): CurrentMark | null => (status ? { status, reason } : null);

export function useScanSession({ sessionId }: { sessionId: string }) {
  const [roster, setRoster] = useState<ScanRosterEntry[] | null>(null);
  const [rosterError, setRosterError] = useState(false);
  const [mode, setModeState] = useState<ScanMode>("present");
  const [queue, dispatch] = useReducer(queueReducer, initialQueue);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [tick, setTick] = useState(0); // đánh thức hàm gửi khi hết thời gian chờ thử lại (xem effect bên dưới)
  // Trạng thái từng em (lạc quan): ref cho quyết định đồng bộ giữa các lần quét liên tiếp, state để hiển thị.
  const marks = useRef<Marks>(new Map());
  const [marksView, setMarksView] = useState<Marks>(() => new Map());
  const byToken = useRef(new Map<string, ScanRosterEntry>());
  const byId = useRef(new Map<string, ScanRosterEntry>());
  const lastReload = useRef(0);
  const rosterLoaded = useRef(false);
  const inFlight = useRef(new Set<string>()); // chặn gửi trùng một lượt khi effect chạy lại trước khi "started" kịp áp dụng
  const undoIds = useRef(new Map<string, string>()); // lượt quét -> mã lượt hoàn tác, để gửi lại hoàn tác là idempotent
  const modeRef = useRef(mode);
  const queueRef = useRef(queue);
  useLayoutEffect(() => { queueRef.current = queue; }, [queue]);

  const setMode = useCallback((m: ScanMode) => { modeRef.current = m; setModeState(m); }, []);

  const writeMarks = useCallback((changes: Iterable<[string, CurrentMark | null]>) => {
    const next = new Map(marks.current);
    for (const [id, mark] of changes) next.set(id, mark);
    marks.current = next;
    setMarksView(next);
  }, []);
  const setMark = useCallback((id: string, mark: CurrentMark | null) => writeMarks([[id, mark]]), [writeMarks]);

  const applyRoster = useCallback((data: RosterResponse | null): boolean => {
    if (!data) { setRosterError(true); return false; }
    setRosterError(false);
    rosterLoaded.current = true;
    byToken.current = new Map(data.students.filter((s) => s.token).map((s) => [s.token, s]));
    byId.current = new Map(data.students.map((s) => [s.studentId, s]));
    // Giữ trạng thái lạc quan của em còn lượt đang gửi; còn lại theo máy chủ.
    const sending = new Set(queueRef.current.events.filter((e) => e.state === "sending").map((e) => e.studentId));
    writeMarks(data.students.filter((s) => !sending.has(s.studentId)).map((s) => [s.studentId, toMark(s.status, s.reason)] as const));
    setRoster(data.students);
    return true;
  }, [writeMarks]);

  const loadRoster = useCallback(async () => {
    lastReload.current = Date.now();
    return applyRoster(await fetchRoster(sessionId));
  }, [sessionId, applyRoster]);

  useEffect(() => {
    let alive = true;
    lastReload.current = Date.now();
    void fetchRoster(sessionId).then((data) => { if (alive) applyRoster(data); });
    return () => { alive = false; };
  }, [sessionId, applyRoster]);

  const enqueueApply = useCallback((entry: ScanRosterEntry, kind: "scan" | "manual", status: "present" | "late", confirmStatus?: "present" | "late"): boolean => {
    if (!canEnqueue(queueRef.current)) {
      setBanner({ tone: "error", text: "Đang gửi quá nhiều lượt, đợi một chút rồi quét tiếp." });
      playScanFeedback("error");
      return false;
    }
    const prev = marks.current.get(entry.studentId) ?? null;
    setMark(entry.studentId, { status, reason: null });
    dispatch({
      type: "enqueue",
      event: {
        eventId: crypto.randomUUID(), kind, studentId: entry.studentId, fullName: entry.fullName, saintName: entry.saintName,
        mode: modeRef.current, token: kind === "scan" ? entry.token : undefined, confirmStatus, optimisticStatus: status,
        prev, capturedAt: new Date().toISOString(), undoBusy: false,
      },
    });
    setBanner({ tone: "applied", fullName: entry.fullName, saintName: entry.saintName, status, text: status === "late" ? "Đã ghi Đi muộn" : "Đã ghi Có mặt" });
    playScanFeedback("ok");
    return true;
  }, [setMark]);

  const handleEntry = useCallback((entry: ScanRosterEntry, kind: "scan" | "manual") => {
    const decision = decideScan(marks.current.get(entry.studentId) ?? null, modeRef.current);
    if (decision.kind === "apply") { enqueueApply(entry, kind, decision.status); return; }
    if (decision.kind === "noop") {
      return setBanner({ tone: "noop", fullName: entry.fullName, saintName: entry.saintName, status: marks.current.get(entry.studentId)?.status ?? null, text: decision.reason === "already_late" ? "Đã ghi đi muộn" : "Đã điểm danh" });
    }
    setConfirm({ entry, current: decision.current, defaultStatus: decision.defaultStatus, kind });
  }, [enqueueApply]);

  const handleCode = useCallback(async (text: string) => {
    const token = parseQrPayload(text);
    if (token && byToken.current.size === 0 && !rosterLoaded.current) {
      return setBanner({ tone: "info", text: "Đang tải danh sách lớp, quét lại sau giây lát." });
    }
    let entry = token ? byToken.current.get(token) : undefined;
    if (token && !entry && Date.now() - lastReload.current > ROSTER_COOLDOWN_MS) {
      await loadRoster(); // vừa thêm em hoặc cấp lại thẻ: tải lại bảng tra một lần
      entry = byToken.current.get(token);
    }
    if (!entry) {
      playScanFeedback("error");
      return setBanner({ tone: "error", text: INVALID_CARD });
    }
    handleEntry(entry, "scan");
  }, [handleEntry, loadRoster]);

  const chooseStudent = useCallback((studentId: string) => {
    const entry = byId.current.get(studentId);
    if (entry) handleEntry(entry, "manual");
  }, [handleEntry]);

  const confirmChoice = useCallback((status: "present" | "late") => {
    if (!confirm) return;
    if (!enqueueApply(confirm.entry, confirm.kind, status, status)) return; // hàng đầy: giữ bảng chọn và lượt "cần chọn"
    if (confirm.eventId) dispatch({ type: "dismiss", eventId: confirm.eventId });
    setConfirm(null);
  }, [confirm, enqueueApply]);

  /** "Giữ nguyên": không đổi gì, lượt "cần chọn" (nếu có) không còn cần xử lý. */
  const keepAsIs = useCallback(() => {
    if (confirm?.eventId) dispatch({ type: "dismiss", eventId: confirm.eventId });
    setConfirm(null);
  }, [confirm]);

  /** Mở lại bảng chọn cho một lượt máy chủ trả "cần chọn" mà người dùng đã đóng. */
  const reopenConfirm = useCallback((ev: QueuedEvent) => {
    const entry = byId.current.get(ev.studentId);
    if (!entry || !isAbsence(ev.serverStatus)) return;
    setConfirm({ entry, current: ev.serverStatus, defaultStatus: ev.mode, kind: ev.kind, eventId: ev.eventId });
  }, []);

  const dismiss = useCallback((eventId: string) => dispatch({ type: "dismiss", eventId }), []);

  /** Lượt đã thử hết lần mà chưa gửi được: trả em về trạng thái trước (nếu chưa có gì khác ghi đè) để quét lại gửi lượt mới. */
  const restoreAfterFailure = useCallback((ev: QueuedEvent) => {
    const now = marks.current.get(ev.studentId);
    if (now?.status === ev.optimisticStatus) setMark(ev.studentId, ev.prev);
  }, [setMark]);

  // Gửi nền: mỗi em một lượt tại một thời điểm, các em khác song song.
  useEffect(() => {
    for (const ev of sendable(queue, Date.now())) {
      if (inFlight.current.has(ev.eventId)) continue;
      inFlight.current.add(ev.eventId);
      dispatch({ type: "started", eventId: ev.eventId });
      void deliver(ev).finally(() => inFlight.current.delete(ev.eventId));
    }
    async function deliver(ev: QueuedEvent) {
      const res = await sendScan({
        eventId: ev.eventId, sessionId, kind: ev.kind, mode: ev.mode, confirmStatus: ev.confirmStatus, capturedAt: ev.capturedAt,
        ...(ev.kind === "scan" ? { token: ev.token } : { studentId: ev.studentId }),
      });
      if (res.kind === "network") {
        const attempt = ev.attempts + 1;
        const wait = attempt >= MAX_SEND_ATTEMPTS ? null : backoffMs(attempt);
        dispatch({ type: "network_error", eventId: ev.eventId, maxAttempts: MAX_SEND_ATTEMPTS, now: Date.now(), waitMs: wait });
        if (wait === null) restoreAfterFailure(ev);
        return;
      }
      const body = res.body;
      if (!body.ok) {
        setMark(ev.studentId, ev.prev);
        dispatch({ type: "rejected", eventId: ev.eventId, message: body.code === "invalid_card" ? INVALID_CARD : body.error });
        return;
      }
      const out = body.data;
      if (out.result === "needs_confirm") {
        setMark(ev.studentId, toMark(out.status));
        dispatch({ type: "needs_confirm", eventId: ev.eventId, status: out.status });
        const entry = byId.current.get(ev.studentId);
        const { current, defaultStatus } = out;
        // Không thay bảng chọn đang mở; lượt vẫn hiện "Cần chọn" để mở lại sau.
        if (entry && current && defaultStatus) setConfirm((open) => open ?? { entry, current, defaultStatus, kind: ev.kind, eventId: ev.eventId });
        return;
      }
      setMark(ev.studentId, toMark(out.status));
      dispatch({ type: "resolved", eventId: ev.eventId, result: out.result, status: out.status });
    }
  }, [queue, sessionId, tick, setMark, restoreAfterFailure]);

  // Đánh thức hàng gửi đúng lúc lượt chờ thử lại sớm nhất đến hạn; tính từ state, tự hủy khi state đổi hoặc rời trang.
  useEffect(() => {
    const now = Date.now();
    const at = nextWakeAt(queue, now);
    if (at === null) return;
    const timer = window.setTimeout(() => setTick((n) => n + 1), at - now + WAKE_SLACK_MS);
    return () => window.clearTimeout(timer);
  }, [queue, tick]);

  const undo = useCallback(async (ev: QueuedEvent) => {
    dispatch({ type: "undo_started", eventId: ev.eventId });
    const undoId = undoIds.current.get(ev.eventId) ?? crypto.randomUUID();
    undoIds.current.set(ev.eventId, undoId);
    const res = await sendUndo({ eventId: undoId, sessionId, targetEventId: ev.eventId });
    if (res.kind === "network") return dispatch({ type: "undo_failed", eventId: ev.eventId, message: "Chưa hoàn tác được, thử lại." });
    undoIds.current.delete(ev.eventId); // đã có kết quả cuối: lần hoàn tác sau (nếu có) là thao tác mới
    if (!res.body.ok) {
      dispatch({ type: "undo_failed", eventId: ev.eventId, message: res.body.error });
      if (res.body.code === "conflict") void loadRoster();
      return;
    }
    setMark(ev.studentId, toMark(res.body.data.status, ev.prev?.reason ?? null));
    dispatch({ type: "undone", eventId: ev.eventId });
  }, [sessionId, loadRoster, setMark]);

  /** "Thử lại": đặt lại dấu lạc quan rồi đưa lượt về hàng gửi. */
  const retry = useCallback((eventId: string) => {
    const ev = queueRef.current.events.find((e) => e.eventId === eventId);
    if (!ev || ev.state !== "failed") return;
    setMark(ev.studentId, { status: ev.optimisticStatus, reason: null });
    dispatch({ type: "retry", eventId });
  }, [setMark]);
  const retryAllFailed = useCallback(() => {
    for (const ev of queueRef.current.events) if (ev.state === "failed") retry(ev.eventId);
  }, [retry]);

  const pending = pendingCount(queue);
  useEffect(() => {
    if (pending === 0) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  // Cầu nối chỉ bật khi build E2E (NEXT_PUBLIC_E2E_SCAN_BRIDGE=1): cho kiểm thử đưa mã đã giải vào mà không cần camera.
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_E2E_SCAN_BRIDGE !== "1") return;
    const w = window as unknown as { __scanFeed?: (t: string) => Promise<void> };
    w.__scanFeed = handleCode;
    return () => { if (w.__scanFeed === handleCode) delete w.__scanFeed; };
  }, [handleCode]);

  const unmarked = useMemo(() => (roster ?? []).filter((s) => !marksView.get(s.studentId)), [roster, marksView]);
  const search = useCallback((q: string) => filterRoster(roster ?? [], q), [roster]);

  return { roster, rosterError, loadRoster, mode, setMode, queue, summary: summarizeQueue(queue), pending, unsaved: unsavedSummary(queue), retryAllFailed, recent: recentEvents(queue, 8), banner, setBanner, confirm, setConfirm, keepAsIs, reopenConfirm, dismiss, handleCode, chooseStudent, confirmChoice, undo, retry, unmarked, search };
}
