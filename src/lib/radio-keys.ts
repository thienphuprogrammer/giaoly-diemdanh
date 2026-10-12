/**
 * Phím mũi tên trong radiogroup (roving tabindex, theo WAI-ARIA): trả về chỉ số mục được chọn/focus tiếp theo,
 * hoặc null nếu phím không thuộc nhóm điều hướng.
 */
export function nextRadioIndex(current: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
