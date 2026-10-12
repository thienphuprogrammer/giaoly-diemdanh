"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { runBulk, runStatusSave } from "@/lib/attendance/board-save";
import { boardReducer, initBoardState, pendingCount, saveChip } from "@/lib/attendance/board-state";
import { createSequencer, initialMarks, type Mark } from "@/lib/attendance/marks";
import type { Board } from "@/server/services/attendance";
import { markRemainingAbsentAction } from "@/server/actions/attendance";
import { markAllPresentAction, setCancelledAction, setStatusAction, undoMarkAllPresentAction } from "./actions";

export const SAVE_TIMEOUT_MS = 10_000;
export const UNDO_MS = 8_000;
const PRESENT: Mark = { status: "present", reason: null };
const ABSENT: Mark = { status: "absent_unexcused", reason: null };

// Các lần render máy chủ mà trang này đã hiển thị trong phiên JS hiện tại. Gặp lại cùng `renderId`
// nghĩa là Next dùng lại bản RSC đã cache (Back/forward) => dữ liệu cũ, phải lấy mới.
const seenRenders = new Set<string>();

/**
 * Trạng thái và thao tác lưu của bảng điểm danh: chạm lạc quan có timeout (kết quả đến muộn vẫn được áp dụng),
 * đếm lượt đang lưu, lỗi từng em, "Tất cả có mặt" có hoàn tác, và đồng bộ lại từ máy chủ mà không ghi đè
 * lượt chưa lưu.
 */
export function useBoardSaves(board: Board, renderId: string) {
  const router = useRouter();
  const [state, dispatch] = useReducer(boardReducer, board.students, (s) => initBoardState(initialMarks(s)));
  const seq = useRef(createSequencer());
  // Số thao tác hàng loạt mà lần gửi THẬT chưa xong (kể cả đã quá hạn chờ).
  const [bulkPending, setBulkPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Lần "đánh vắng các em còn lại" gần nhất lỗi: giữ để hiện nút "Thử lại" (mở lại bảng xác nhận).
  const [absentFailed, setAbsentFailed] = useState(false);
  const [cancelled, setCancelled] = useState(board.cancelled);
  const [undo, setUndo] = useState<{ batchId: string; count: number } | null>(null);
  // Gắn lại từ bản RSC đã cache => dữ liệu cũ: khoá thao tác cho tới khi dữ liệu mới về.
  const [stale, setStale] = useState(() => seenRenders.has(renderId));

  // Props mới (router.refresh) => gộp vào state, giữ các em đang chờ lưu.
  const [syncedBoard, setSyncedBoard] = useState(board);
  if (syncedBoard !== board) {
    setSyncedBoard(board);
    setCancelled(board.cancelled);
    setStale(false);
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
  const save = useCallback((studentId: string, next: Mark) => runStatusSave({
    send: () => setStatusAction({ sessionId, studentId, status: next?.status ?? null, reason: next?.reason ?? null }),
    dispatch, studentId, next, turn: seq.current.begin(studentId), ms: SAVE_TIMEOUT_MS,
  }), [sessionId]);

  const retry = useCallback((studentId: string) => {
    const failure = state.failures.find((f) => f.studentId === studentId);
    if (failure) void save(studentId, failure.mark);
  }, [state.failures, save]);
  const dismiss = useCallback((studentId: string) => dispatch({ type: "dismiss", studentId }), []);

  const bulk = <T,>(send: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, done: (data: T) => void) =>
    runBulk(send, SAVE_TIMEOUT_MS, {
      start: () => { setBulkPending((n) => n + 1); setAbsentFailed(false); },
      end: () => setBulkPending((n) => n - 1),
      error: setError,
      done,
    });

  // Thành công đến muộn (sau khi đã báo quá hạn) vẫn mở lại snackbar hoàn tác với batchId thật.
  const markAll = () => bulk(() => markAllPresentAction({ sessionId }), (d) => {
    dispatch({ type: "bulkSet", studentIds: d.studentIds, mark: PRESENT });
    setUndo(d.studentIds.length > 0 ? { batchId: d.batchId, count: d.studentIds.length } : null);
    refresh(); // thiết bị khác có thể đã ghi các em còn lại
  });

  /** Kết thúc buổi: đánh vắng các em chưa có dấu. Đếm như một thao tác đang lưu (chip, chặn rời trang); lỗi thì báo kèm "Thử lại". */
  const markRemainingAbsent = () => runBulk(() => markRemainingAbsentAction({ sessionId }), SAVE_TIMEOUT_MS, {
    start: () => { setBulkPending((n) => n + 1); setAbsentFailed(false); },
    end: () => setBulkPending((n) => n - 1),
    error: (m) => { setError(m); setAbsentFailed(m !== null); },
    done: (d) => {
      setAbsentFailed(false);
      dispatch({ type: "bulkSet", studentIds: d.studentIds, mark: ABSENT });
      refresh(); // thiết bị khác có thể đã ghi một số em
    },
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

  const busy = bulkPending > 0;
  return {
    marks: state.marks,
    failures: state.failures,
    chip: saveChip(state, bulkPending),
    pending: pendingCount(state) + bulkPending,
    busy,
    stale,
    error,
    cancelled,
    undo,
    save,
    retry,
    dismiss,
    markAll,
    markRemainingAbsent,
    absentFailed,
    undoMarkAll,
    closeUndo,
    setCancelledOnServer,
  };
}
