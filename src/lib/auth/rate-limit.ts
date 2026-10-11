export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60_000;

export function isLockedOut(
  attempts: readonly Date[],
  now: Date,
  max: number = MAX_ATTEMPTS,
  windowMs: number = WINDOW_MS,
): boolean {
  const since = now.getTime() - windowMs;
  return attempts.filter((a) => a.getTime() > since).length >= max;
}
