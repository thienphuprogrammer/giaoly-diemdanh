export type SendOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

export interface SendHandlers<T> {
  /** Kết quả đến trước hạn. */
  settle: (outcome: SendOutcome<T>) => void;
  /** Quá hạn mà chưa có kết quả: giao diện báo "chưa chắc đã lưu", nhưng lần gửi vẫn đang chạy. */
  timeout: () => void;
  /** Kết quả thật đến SAU khi đã báo quá hạn (Server Action không huỷ được, có thể vẫn ghi xong). */
  late: (outcome: SendOutcome<T>) => void;
}

/**
 * Theo dõi MỘT lần gửi với hạn chờ `ms`: gọi đúng một trong `settle`, hoặc `timeout` rồi `late`.
 * Promise trả về xong khi lần gửi thật đã có kết quả.
 */
export function trackSend<T>(send: Promise<T>, ms: number, on: SendHandlers<T>): Promise<void> {
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; on.timeout(); }, ms);
  return send
    .then((value): SendOutcome<T> => ({ ok: true, value }), (error: unknown): SendOutcome<T> => ({ ok: false, error }))
    .then((outcome) => {
      clearTimeout(timer);
      if (timedOut) on.late(outcome);
      else on.settle(outcome);
    });
}
