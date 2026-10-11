export interface AttentionCount {
  count: number;
  hasWarning: boolean;
}

/** Một lượt duyệt: số em cần chú ý theo lớp và lớp đó có em ở mức cảnh báo hay không. */
export function attentionByClass(items: readonly { classId: string; level: "watch" | "warning" }[]): Map<string, AttentionCount> {
  const out = new Map<string, AttentionCount>();
  for (const i of items) {
    const prev = out.get(i.classId) ?? { count: 0, hasWarning: false };
    out.set(i.classId, { count: prev.count + 1, hasWarning: prev.hasWarning || i.level === "warning" });
  }
  return out;
}
