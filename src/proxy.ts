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
 * - GET không có phiên hợp lệ → chuyển sang /login?next=<trang hiện tại>.
 * - Request khác GET (server action gửi tới URL trang) luôn đi tiếp, kể cả khi thiếu cookie: proxy trả 307 sẽ phá giao
 *   thức redirect của action. requireUser() (mọi server action đều gọi) chặn và chuyển về /login?next= theo header do
 *   proxy đặt. Proxy chỉ là lớp lạc quan; ranh giới quyền thật nằm ở DAL.
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
  const decision = session ? sessionRefreshDecision(session.exp, Math.floor(Date.now() / 1000), session.sat) : "invalid";
  // Đường dẫn trang hiện tại (với server action là URL của trang gửi action); /api không qua proxy, safeNextPath cũng loại.
  const path = currentPath(request);

  if (decision === "invalid" && isGet) {
    const res = NextResponse.redirect(new URL(loginHref(path), request.url));
    if (token !== undefined) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  headers.set(NEXT_PATH_HEADER, path);
  const res = NextResponse.next({ request: { headers } });
  if (decision === "refresh" && session) {
    // Giữ nguyên `sat` (lúc đăng nhập) để trần 90 ngày không bị đẩy lùi.
    res.cookies.set(SESSION_COOKIE, await encryptSession({ userId: session.userId, sat: session.sat }, secret), sessionCookieOptions());
  }
  return res;
}

export const config = {
  // Bỏ qua tài nguyên tĩnh công khai. iOS tải apple-touch-icon và ảnh khởi động (splash/*.png) không kèm cookie: chỉ đúng
  // các tệp .png đó, đường dẫn khác cùng tiền tố vẫn qua proxy.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon-.*|apple-icon.*|apple-touch-icon(?:-precomposed)?\\.png$|splash/[\\w-]+\\.png$).*)"],
};
