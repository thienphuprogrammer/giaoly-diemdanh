/**
 * Chống phát hiện lặp: cùng một mã còn nằm trong khung (được thấy liên tục, cách nhau ≤ gapMs) chỉ tính một lần;
 * mã khác luôn được nhận ngay; cùng mã quay lại sau khi rời khung quá gapMs thì nhận lại.
 */
export function createFrameDeduper(gapMs = 600) {
  let last: { code: string; seenAt: number } | null = null;
  return {
    accept(code: string, nowMs: number): boolean {
      const fresh = !last || last.code !== code || nowMs - last.seenAt > gapMs;
      last = { code, seenAt: nowMs };
      return fresh;
    },
  };
}
