import { SignJWT, jwtVerify } from "jose";

export interface SessionPayload { userId: string }

const ALG = "HS256";
const key = (secret: string) => new TextEncoder().encode(secret);

export async function encryptSession(
  payload: SessionPayload,
  secret: string,
  expiresAt: string | number = "7d",
): Promise<string> {
  return new SignJWT({ userId: payload.userId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(key(secret));
}

export async function decryptSession(
  token: string | undefined,
  secret: string,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: [ALG] });
    return typeof payload.userId === "string" ? { userId: payload.userId } : null;
  } catch {
    return null;
  }
}
