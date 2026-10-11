export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Quá ${Math.round(ms / 1000)} giây không có phản hồi`);
    this.name = "TimeoutError";
  }
}

/**
 * Chờ `promise` tối đa `ms`; quá hạn thì từ chối bằng TimeoutError.
 * Không huỷ được công việc gốc (Server Action vẫn có thể hoàn tất sau đó) — người gọi phải coi
 * kết quả là "chưa chắc đã lưu" và cho gửi lại một thao tác idempotent.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
