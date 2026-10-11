import { trackSend } from "@/lib/track-send";
import type { BoardAction } from "./board-state";
import type { Mark } from "./marks";

export const SAVE_ERROR = "Không lưu được, thử lại sau.";
export const TIMEOUT_ERROR = "Mạng chậm, chưa chắc đã lưu.";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Một lần lưu trạng thái của một em: dispatch `begin`, rồi `settle` (kịp hạn) hoặc `timeout` + `late`
 * (kết quả thật đến sau). Lần gửi chỉ được bắt đầu một lần; promise xong khi có kết quả thật.
 */
export function runStatusSave(args: {
  send: () => Promise<Result<unknown>>;
  dispatch: (a: BoardAction) => void;
  studentId: string;
  next: Mark;
  turn: number;
  ms: number;
}): Promise<void> {
  const { send, dispatch, studentId, next, turn, ms } = args;
  dispatch({ type: "begin", studentId, next, turn });
  return trackSend(send(), ms, {
    settle: (o) => {
      if (o.ok && o.value.ok) dispatch({ type: "settle", studentId, next, turn, ok: true });
      else dispatch({ type: "settle", studentId, next, turn, ok: false, message: o.ok && !o.value.ok ? o.value.error : SAVE_ERROR });
    },
    timeout: () => dispatch({ type: "timeout", studentId, next, turn, message: TIMEOUT_ERROR }),
    late: (o) => dispatch({ type: "late", studentId, next, turn, ok: o.ok && o.value.ok }),
  });
}

/**
 * Thao tác hàng loạt (tất cả có mặt, hoàn tác, nghỉ lễ): `start`/`end` bao trọn lần gửi THẬT (kể cả khi đã
 * quá hạn), `error` báo/xoá lỗi, `done` nhận dữ liệu khi thành công — kể cả khi thành công đến muộn.
 */
export function runBulk<T>(send: () => Promise<Result<T>>, ms: number, on: {
  start: () => void;
  end: () => void;
  error: (message: string | null) => void;
  done: (data: T) => void;
}): Promise<void> {
  on.start();
  on.error(null);
  return trackSend(send(), ms, {
    settle: (o) => {
      if (o.ok && o.value.ok) on.done(o.value.data);
      else on.error(o.ok && !o.value.ok ? o.value.error : SAVE_ERROR);
      on.end();
    },
    timeout: () => on.error(TIMEOUT_ERROR),
    late: (o) => {
      if (o.ok && o.value.ok) { on.error(null); on.done(o.value.data); }
      on.end();
    },
  });
}
