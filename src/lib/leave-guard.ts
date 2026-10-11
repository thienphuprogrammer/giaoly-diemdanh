/** Những gì cần biết về một cú bấm vào thẻ <a> để quyết định có chặn điều hướng hay không. */
export interface LinkClick {
  href: string;
  target: string;
  download: boolean;
  button: number;
  modifier: boolean;
  defaultPrevented: boolean;
}

/**
 * Trả về đường dẫn nội bộ (pathname + query) nếu cú bấm là điều hướng trong app cần chặn để hỏi lại;
 * null nếu trình duyệt tự xử lý (tab mới, tải về, phím bổ trợ, khác nguồn, chỉ đổi #hash).
 */
export function guardedNavigation(click: LinkClick, currentHref: string): string | null {
  if (click.defaultPrevented || click.button !== 0 || click.modifier || click.download) return null;
  if (click.target && click.target !== "_self") return null;
  let to: URL;
  let here: URL;
  try {
    to = new URL(click.href, currentHref);
    here = new URL(currentHref);
  } catch {
    return null;
  }
  if (to.origin !== here.origin || (to.protocol !== "http:" && to.protocol !== "https:")) return null;
  if (to.pathname === here.pathname && to.search === here.search && to.hash) return null;
  return `${to.pathname}${to.search}`;
}
