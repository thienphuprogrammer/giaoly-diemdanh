export interface RateLimiter { hit(key: string, now?: number): { allowed: boolean; retryAfterMs: number } }

/** Cửa sổ trượt trong bộ nhớ của từng instance (đủ để chặn lạm dụng đơn giản; không phải hạn mức toàn hệ thống). */
export function createRateLimiter(opts: { max: number; windowMs: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    hit(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => t > now - opts.windowMs);
      if (recent.length >= opts.max) {
        hits.set(key, recent);
        return { allowed: false, retryAfterMs: recent[0] + opts.windowMs - now };
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => t <= now - opts.windowMs)) hits.delete(k);
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}
