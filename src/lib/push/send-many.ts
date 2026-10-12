import { sendPush, type PushOutcome, type PushTarget, type SendPushOptions, type SendResult } from "./send";
import type { PushMessage } from "./payload";

/**
 * Gửi tới nhiều đăng ký (cho tác vụ định kỳ, Task 39): tối đa 5 lượt cùng lúc và mỗi lượt có hạn chót tổng 15 giây
 * (ngoài `timeout` socket của web-push), để một dịch vụ push treo không giữ cả tác vụ. Quá hạn = `retry`; sender ném lỗi
 * = `error`. Kết quả giữ đúng thứ tự đầu vào.
 */
export const SEND_CONCURRENCY = 5;
export const SEND_DEADLINE_MS = 15_000;

export type PushSender = (target: PushTarget, message: PushMessage, opts: SendPushOptions) => Promise<SendResult>;
export interface SendManyOptions extends SendPushOptions {
  send?: PushSender;
  concurrency?: number;
  deadlineMs?: number;
}
export interface SendManyResult<T extends PushTarget> { target: T; outcome: PushOutcome; status: number | null }

async function withDeadline(work: Promise<SendResult>, ms: number): Promise<SendResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<SendResult>((resolve) => { timer = setTimeout(() => resolve({ outcome: "retry", status: null }), ms); });
  try {
    return await Promise.race([work.catch((): SendResult => ({ outcome: "error", status: null })), late]);
  } finally {
    clearTimeout(timer);
  }
}

export async function sendMany<T extends PushTarget>(targets: readonly T[], message: PushMessage, opts: SendManyOptions): Promise<SendManyResult<T>[]> {
  const { send = sendPush, concurrency = SEND_CONCURRENCY, deadlineMs = SEND_DEADLINE_MS, ...sendOpts } = opts;
  const results: SendManyResult<T>[] = new Array(targets.length);
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const i = next++;
      const target = targets[i];
      const r = await withDeadline(Promise.resolve().then(() => send(target, message, sendOpts)), deadlineMs);
      results[i] = { target, outcome: r.outcome, status: r.status };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return results;
}
