import { NextResponse, type NextRequest } from "next/server";

// Kiểm tra lạc quan: chỉ chuyển người chưa có cookie sang /login.
// Quyền thật nằm ở requireUser() trong DAL (không chuyển ngược khỏi /login để tránh vòng lặp khi cookie hết hạn).
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has("session");
  const isLogin = request.nextUrl.pathname === "/login";
  if (!hasSession && !isLogin) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon-.*|apple-icon.*).*)"],
};
