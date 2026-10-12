"use client";
import { useCallback, useReducer, useRef } from "react";
import { runStatusSave } from "@/lib/attendance/board-save";
import { boardReducer, initBoardState } from "@/lib/attendance/board-state";
import { createSequencer, type Mark, type Marks } from "@/lib/attendance/marks";

type Result = { ok: true; data: unknown } | { ok: false; error: string };

/**
 * Một hàng đợi "chạm từng em" của bảng: chạm lạc quan, timeout (kết quả đến muộn vẫn áp dụng), lỗi từng em kèm
 * "Thử lại"/bỏ qua, và gộp dữ liệu mới từ máy chủ mà không ghi đè lượt chưa lưu (`dispatch` "fresh"/"syncRequested").
 * Bảng điểm danh dùng hai hàng đợi: buổi học và đi lễ. `send` phải ổn định (useCallback).
 */
export function useMarkQueue(initial: Marks, send: (studentId: string, next: Mark) => Promise<Result>, ms: number) {
  const [state, dispatch] = useReducer(boardReducer, initial, initBoardState);
  const seq = useRef(createSequencer());
  const save = useCallback((studentId: string, next: Mark) => runStatusSave({
    send: () => send(studentId, next), dispatch, studentId, next, turn: seq.current.begin(studentId), ms,
  }), [send, ms]);
  const retry = useCallback((studentId: string) => {
    const failure = state.failures.find((f) => f.studentId === studentId);
    if (failure) void save(studentId, failure.mark);
  }, [state.failures, save]);
  const dismiss = useCallback((studentId: string) => dispatch({ type: "dismiss", studentId }), []);
  return { state, dispatch, save, retry, dismiss };
}
