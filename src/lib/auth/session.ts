import { SignJWT, jwtVerify } from "jose";
import { SESSION_MAX_AGE_S } from "./session-policy";

export interface SessionPayload { userId: string }
export interface VerifiedSession extends SessionPayload { exp: number }

const ALG = "HS256";
const key = (secret: string) => new TextEncoder().encode(secret);

/** `expiresAt` mặc định = bây giờ + 30 ngày, khớp `maxAge` của cookie. */
export async function encryptSession(
  payload: SessionPayload,
  secret: string,
  expiresAt: string | number = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_S,
): Promise<string> {
  return new SignJWT({ userId: payload.userId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(key(secret));
}

/** Kiểm chữ ký + hạn; trả cả `exp` để quyết định gia hạn. Token hỏng/hết hạn → null. */
export async function readSession(token: string | undefined, secret: string): Promise<VerifiedSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: [ALG] });
    if (typeof payload.userId !== "string" || typeof payload.exp !== "number") return null;
    return { userId: payload.userId, exp: payload.exp };
  } catch {
    return null;
  }
}

export async function decryptSession(token: string | undefined, secret: string): Promise<SessionPayload | null> {
  const session = await readSession(token, secret);
  return session ? { userId: session.userId } : null;
}
