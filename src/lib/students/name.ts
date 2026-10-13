export interface SplitName { family: string; given: string }

const collator = new Intl.Collator("vi");

/**
 * Tách họ tên Việt Nam: từ cuối là tên, phần còn lại là họ và tên đệm ("Nguyễn Huỳnh Khả Ái" -> "Nguyễn Huỳnh Khả" + "Ái").
 * Chuẩn hoá NFC và gộp khoảng trắng để dữ liệu nhập tay (hoặc Unicode tổ hợp) không làm lệch thứ tự.
 */
export function splitName(fullName: string): SplitName {
  const parts = fullName.normalize("NFC").trim().split(/\s+/).filter(Boolean);
  const given = parts.pop() ?? "";
  return { family: parts.join(" "), given };
}

/** Sắp theo tên trước, rồi theo họ và tên đệm (thứ tự bảng chữ cái tiếng Việt). */
export function compareByGivenName(a: string, b: string): number {
  const x = splitName(a);
  const y = splitName(b);
  return collator.compare(x.given, y.given) || collator.compare(x.family, y.family);
}

export const sortByGivenName = <T extends { fullName: string }>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => compareByGivenName(a.fullName, b.fullName));
