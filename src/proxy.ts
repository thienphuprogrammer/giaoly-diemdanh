import { NextResponse, type NextRequest } from "next/server";
import { NEXT_PATH_HEADER, loginHref } from "@/lib/auth/next-path";
import { encryptSession, readSession } from "@/lib/auth/session";
import { SESSION_COOKIE, authSecret, sessionCookieOptions, sessionRefreshDecision } from "@/lib/auth/session-policy";

/** Đường dẫn + query của request trang (bỏ tham số nội bộ `_rsc` của Next). */
function currentPath(request: NextRequest): string {
  const params = new URLSearchParams(request.nextUrl.search);
  params.delete("_rsc");
  const query = params.toString();
  return query ? `${request.nextUrl.pathname}?${query}` : request.nextUrl.pathname;
}

/**
 * Proxy (Next 16):
 * - Không có phiên hợp lệ → chuyển sang /login, mang `next` khi là request GET (trang). Request khác GET có cookie
 *   (dù hỏng) vẫn đi tiếp như trước: requireUser() trong server action quyết định (giao thức redirect của action).
 * - Phiên hợp lệ còn < 3 ngày → cấp lại cookie 30 ngày trên response (Server Component không đặt được cookie).
 * Proxy chỉ kiểm chữ ký/hạn; user vẫn được đọc lại từ DB ở mỗi request (DAL), nên tài khoản bị xóa vẫn bị chặn.
 */
export async function proxy(request: NextRequest) {
  const isGet = request.method === "GET" || request.method === "HEAD";
  const headers = new Headers(request.headers);
  headers.delete(NEXT_PATH_HEADER);
  if (request.nextUrl.pathname === "/login") return NextResponse.next({ request: { headers } });

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const secret = authSecret();
  const session = token ? await readSession(token, secret) : null;
  const decision = session ? sessionRefreshDecision(session.exp, Math.floor(Date.now() / 1000)) : "invalid";

  if (decision === "invalid" && (isGet || token === undefined)) {
    const target = isGet ? loginHref(currentPath(request)) : "/login";
    const res = NextResponse.redirect(new URL(target, request.url));
    if (token !== undefined) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  if (isGet) headers.set(NEXT_PATH_HEADER, currentPath(request));
  const res = NextResponse.next({ request: { headers } });
  if (decision === "refresh" && session) {
    res.cookies.set(SESSION_COOKIE, await encryptSession({ userId: session.userId }, secret), sessionCookieOptions());
  }
  return res;
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon-.*|apple-icon.*).*)"],
};
