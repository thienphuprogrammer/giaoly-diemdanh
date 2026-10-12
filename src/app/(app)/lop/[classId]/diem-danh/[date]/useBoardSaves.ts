"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { runBulk } from "@/lib/attendance/board-save";
import { pendingCount, saveChipOf } from "@/lib/attendance/board-state";
import { massMarksFor } from "@/lib/attendance/mass-marks";
import { initialMarks, type Mark } from "@/lib/attendance/marks";
import type { Board } from "@/server/services/attendance";
import type { MassBoard } from "@/server/services/mass";
import { markRemainingAbsentAction } from "@/server/actions/attendance";
import { markClassAtMassAction, setMassStatusAction, undoClassAtMassAction } from "@/server/actions/mass";
import { markAllPresentAction, setCancelledAction, setStatusAction, undoMarkAllPresentAction } from "./actions";
import { useMarkQueue } from "./useMarkQueue";

export const SAVE_TIMEOUT_MS = 10_000;
export const UNDO_MS = 8_000;
const PRESENT: Mark = { status: "present", reason: null };
const ABSENT: Mark = { status: "absent_unexcused", reason: null };

// Các lần render máy chủ mà trang này đã hiển thị trong phiên JS hiện tại. Gặp lại cùng `renderId`
// nghĩa là Next dùng lại bản RSC đã cache (Back/forward) => dữ liệu cũ, phải lấy mới.
const seenRenders = new Set<string>();

/** Snackbar hoàn tác: của "Tất cả có mặt" (buổi học) hoặc "Cả lớp đi lễ". */
export interface UndoBatch { scope: "class" | "mass"; batchId: string; count: number }

const massMarksOf = (board: Board, mass: MassBoard) => massMarksFor(board.students.map((s) => s.id), mass.marks);

/**
 * Trạng thái và thao tác lưu của bảng điểm danh: chạm lạc quan có timeout (kết quả đến muộn vẫn được áp dụng),
 * đếm lượt đang lưu, lỗi từng em, "Tất cả có mặt" có hoàn tác, và đồng bộ lại từ máy chủ mà không ghi đè
 * lượt chưa lưu. Phần đi lễ (thánh lễ Chúa nhật của tuần) dùng một hàng đợi thứ hai cùng cơ chế: chung chip
 * "Đang lưu", chặn rời trang, lỗi + "Thử lại", và cùng được làm mới khi Back/hiện tab lại.
 */
export function useBoardSaves(board: Board, mass: MassBoard, renderId: string) {
  const router = useRouter();
  const { sessionId, classId, heldOn } = board;
  const sendClass = useCallback((studentId: string, next: Mark) =>
    setStatusAction({ sessionId, studentId, status: next?.status ?? null, reason: next?.reason ?? null }), [sessionId]);
  const sendMass = useCallback((studentId: string, next: Mark) =>
    setMassStatusAction({ classId, heldOn, studentId, status: next?.status ?? null }), [classId, heldOn]);
  const cls = useMarkQueue(initialMarks(board.students), sendClass, SAVE_TIMEOUT_MS);
  const massQ = useMarkQueue(massMarksOf(board, mass), sendMass, SAVE_TIMEOUT_MS);
  const { dispatch } = cls;
  const massDispatch = massQ.dispatch;
  // Số thao tác hàng loạt mà lần gửi THẬT chưa xong (kể cả đã quá hạn chờ).
  const [bulkPending, setBulkPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Lần "đánh vắng các em còn lại" gần nhất lỗi: giữ để hiện nút "Thử lại" (mở lại bảng xác nhận).
  const [absentFailed, setAbsentFailed] = useState(false);
  const [cancelled, setCancelled] = useState(board.cancelled);
  const [undo, setUndo] = useState<UndoBatch | null>(null);
  // Gắn lại từ bản RSC đã cache => dữ liệu cũ: khoá thao tác cho tới khi dữ liệu mới về.
  const [stale, setStale] = useState(() => seenRenders.has(renderId));

  // Props mới (router.refresh) => gộp vào state, giữ các em đang chờ lưu.
  const [synced, setSynced] = useState({ board, mass });
  if (synced.board !== board || synced.mass !== mass) {
    setSynced({ board, mass });
    setCancelled(board.cancelled);
    setStale(false);
    dispatch({ type: "fresh", server: initialMarks(board.students) });
    massDispatch({ type: "fresh", server: massMarksOf(board, mass) });
  }

  const refresh = useCallback(() => {
    dispatch({ type: "syncRequested" });
    massDispatch({ type: "syncRequested" });
    router.refresh();
  }, [router, dispatch, massDispatch]);

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
    setUndo(d.studentIds.length > 0 ? { scope: "class", batchId: d.batchId, count: d.studentIds.length } : null);
    refresh(); // thiết bị khác có thể đã ghi các em còn lại
  });

  /** "Cả lớp đi lễ": như "Tất cả có mặt" nhưng cho thánh lễ của tuần (chỉ em chưa hỏi), có hoàn tác 8 giây. */
  const markAllMass = () => bulk(() => markClassAtMassAction({ classId, heldOn }), (d) => {
    massDispatch({ type: "bulkSet", studentIds: d.studentIds, mark: PRESENT });
    setUndo(d.studentIds.length > 0 ? { scope: "mass", batchId: d.batchId, count: d.studentIds.length } : null);
    refresh();
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
    const { scope, batchId } = undo;
    setUndo(null);
    const send = scope === "mass"
      ? () => undoClassAtMassAction({ classId, heldOn, batchId })
      : () => undoMarkAllPresentAction({ sessionId, batchId });
    const target = scope === "mass" ? massDispatch : dispatch;
    return bulk(send, (d) => {
      target({ type: "bulkSet", studentIds: d.studentIds, mark: null });
      refresh(); // như markAll: thiết bị khác có thể đã ghi trong lúc đó
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
    if (value) setUndo((u) => (u?.scope === "class" ? null : u));
  });

  const busy = bulkPending > 0;
  return {
    marks: cls.state.marks,
    failures: cls.state.failures,
    chip: saveChipOf([cls.state, massQ.state], bulkPending),
    pending: pendingCount(cls.state) + pendingCount(massQ.state) + bulkPending,
    busy,
    stale,
    error,
    cancelled,
    undo,
    save: cls.save,
    retry: cls.retry,
    dismiss: cls.dismiss,
    massMarks: massQ.state.marks,
    massFailures: massQ.state.failures,
    saveMass: massQ.save,
    retryMass: massQ.retry,
    dismissMass: massQ.dismiss,
    markAllMass,
    markAll,
    markRemainingAbsent,
    absentFailed,
    undoMarkAll,
    closeUndo,
    setCancelledOnServer,
  };
}
