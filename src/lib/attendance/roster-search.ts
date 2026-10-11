const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase().trim();

/** Tìm theo họ tên hoặc tên thánh, không phân biệt dấu/hoa thường, các từ theo thứ tự bất kỳ. */
export function filterRoster<T extends { fullName: string; saintName: string | null }>(roster: T[], query: string, limit = 8): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return roster.filter((r) => {
    const hay = fold(`${r.saintName ?? ""} ${r.fullName}`);
    return words.every((w) => hay.includes(w));
  }).slice(0, limit);
}
