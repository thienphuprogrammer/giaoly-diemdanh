"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { boardReducer, initBoardState, pendingCount, saveChip } from "@/lib/attendance/board-state";
import { createSequencer, initialMarks, type Mark } from "@/lib/attendance/marks";
import { TimeoutError, withTimeout } from "@/lib/with-timeout";
import type { Board } from "@/server/services/attendance";
import { markAllPresentAction, setCancelledAction, setStatusAction, undoMarkAllPresentAction } from "./actions";

export const SAVE_TIMEOUT_MS = 10_000;
export const UNDO_MS = 8_000;
const SAVE_ERROR = "Không lưu được, thử lại sau.";
const TIMEOUT_ERROR = "Mạng chậm, chưa chắc đã lưu.";
const PRESENT: Mark = { status: "present", reason: null };

// Các lần render máy chủ mà trang này đã hiển thị trong phiên JS hiện tại. Gặp lại cùng `renderId`
// nghĩa là Next dùng lại bản RSC đã cache (Back/forward) => dữ liệu cũ, phải lấy mới.
const seenRenders = new Set<string>();

const errorText = (e: unknown) => (e instanceof TimeoutError ? TIMEOUT_ERROR : SAVE_ERROR);

/**
 * Trạng thái và thao tác lưu của bảng điểm danh: chạm lạc quan có timeout, đếm lượt đang lưu,
 * lỗi từng em, "Tất cả có mặt" có hoàn tác, và đồng bộ lại từ máy chủ mà không ghi đè lượt chưa lưu.
 */
export function useBoardSaves(board: Board, renderId: string) {
  const router = useRouter();
  const [state, dispatch] = useReducer(boardReducer, board.students, (s) => initBoardState(initialMarks(s)));
  const seq = useRef(createSequencer());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(board.cancelled);
  const [undo, setUndo] = useState<{ batchId: string; count: number } | null>(null);

  // Props mới (router.refresh) => gộp vào state, giữ các em đang chờ lưu.
  const [syncedBoard, setSyncedBoard] = useState(board);
  if (syncedBoard !== board) {
    setSyncedBoard(board);
    setCancelled(board.cancelled);
    dispatch({ type: "fresh", server: initialMarks(board.students) });
  }

  const refresh = useCallback(() => {
    dispatch({ type: "syncRequested" });
    router.refresh();
  }, [router]);

  const handledRender = useRef<string | null>(null);
  useEffect(() => {
    if (handledRender.current === renderId) return; // StrictMode chạy effect hai lần
    handledRender.current = renderId;
    if (seenRenders.has(renderId)) refresh();
    else seenRenders.add(renderId);
  }, [renderId, refresh]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", refresh);
    };
  }, [refresh]);

  const { sessionId } = board;
  const save = useCallback(async (studentId: string, next: Mark) => {
    const turn = seq.current.begin(studentId);
    dispatch({ type: "begin", studentId, next, turn });
    try {
      const r = await withTimeout(setStatusAction({ sessionId, studentId, status: next?.status ?? null, reason: next?.reason ?? null }), SAVE_TIMEOUT_MS);
      dispatch({ type: "settle", studentId, next, turn, ok: r.ok, message: r.ok ? undefined : r.error });
    } catch (e) {
      dispatch({ type: "settle", studentId, next, turn, ok: false, message: errorText(e) });
    }
  }, [sessionId]);

  const retry = useCallback((studentId: string) => {
    const failure = state.failures.find((f) => f.studentId === studentId);
    if (failure) void save(studentId, failure.mark);
  }, [state.failures, save]);
  const dismiss = useCallback((studentId: string) => dispatch({ type: "dismiss", studentId }), []);

  async function bulk<T>(run: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, done: (data: T) => void) {
    setBusy(true);
    setError(null);
    try {
      const r = await withTimeout(run(), SAVE_TIMEOUT_MS);
      if (r.ok) done(r.data); else setError(r.error);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const markAll = () => bulk(() => markAllPresentAction({ sessionId }), (d) => {
    dispatch({ type: "bulkSet", studentIds: d.studentIds, mark: PRESENT });
    setUndo(d.studentIds.length > 0 ? { batchId: d.batchId, count: d.studentIds.length } : null);
    refresh(); // thiết bị khác có thể đã ghi các em còn lại
  });

  const undoMarkAll = () => {
    if (!undo) return;
    const { batchId } = undo;
    setUndo(null);
    return bulk(() => undoMarkAllPresentAction({ sessionId, batchId }), (d) => {
      dispatch({ type: "bulkSet", studentIds: d.studentIds, mark: null });
    });
  };
  const closeUndo = useCallback(() => setUndo(null), []);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [undo]);

  const setCancelledOnServer = (value: boolean) => bulk(() => setCancelledAction({ sessionId, cancelled: value }), () => {
    setCancelled(value);
    if (value) setUndo(null);
  });

  const pending = pendingCount(state) + (busy ? 1 : 0);
  return {
    marks: state.marks,
    failures: state.failures,
    chip: saveChip(state, busy ? 1 : 0),
    pending,
    busy,
    error,
    cancelled,
    undo,
    save,
    retry,
    dismiss,
    markAll,
    undoMarkAll,
    closeUndo,
    setCancelledOnServer,
  };
}
