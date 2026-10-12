import { SignJWT, jwtVerify } from "jose";
import { SESSION_MAX_AGE_S, sessionAuthTime, sessionRefreshDecision } from "./session-policy";

export interface SessionPayload { userId: string }
/** `sat` (session-auth time, giây): lúc đăng nhập; được giữ nguyên khi gia hạn để áp trần tuyệt đối 90 ngày. */
export interface VerifiedSession extends SessionPayload { exp: number; sat: number }

const nowS = () => Math.floor(Date.now() / 1000);

const ALG = "HS256";
const key = (secret: string) => new TextEncoder().encode(secret);

/**
 * `expiresAt` mặc định = bây giờ + 30 ngày, khớp `maxAge` của cookie.
 * `sat` mặc định = bây giờ (đăng nhập); khi gia hạn truyền `sat` cũ để giữ nguyên.
 */
export async function encryptSession(
  payload: SessionPayload & { sat?: number },
  secret: string,
  expiresAt: string | number = nowS() + SESSION_MAX_AGE_S,
): Promise<string> {
  return new SignJWT({ userId: payload.userId, sat: payload.sat ?? nowS() })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(key(secret));
}

/**
 * Kiểm chữ ký + hạn + cùng tiêu chí với proxy (thời hạn tối đa 30 ngày, trần 90 ngày từ `sat`).
 * Trả `exp`/`sat` để quyết định gia hạn. Token hỏng/hết hạn/quá trần → null.
 */
export async function readSession(token: string | undefined, secret: string): Promise<VerifiedSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: [ALG] });
    if (typeof payload.userId !== "string" || typeof payload.exp !== "number") return null;
    if (payload.sat !== undefined && typeof payload.sat !== "number") return null;
    const sat = sessionAuthTime({ exp: payload.exp, sat: payload.sat });
    if (sessionRefreshDecision(payload.exp, nowS(), sat) === "invalid") return null;
    return { userId: payload.userId, exp: payload.exp, sat };
  } catch {
    return null;
  }
}

export async function decryptSession(token: string | undefined, secret: string): Promise<SessionPayload | null> {
  const session = await readSession(token, secret);
  return session ? { userId: session.userId } : null;
}
