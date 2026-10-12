import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import type { ActionResult } from "../result";
import { openSessionOfKind } from "./attendance";

/**
 * Mở (hoặc lấy lại) buổi đi lễ của lớp ngày `heldOn`: thường là Chúa nhật (xem `massSundayFor`), nhưng người có quyền ghi
 * được chọn ngày bất kỳ (lễ trọng). Idempotent; không bao giờ trả về buổi học cùng ngày.
 */
export function openMassSession(db: Db, user: AppUser, input: unknown, now: Date = new Date()): Promise<ActionResult<{ id: string }>> {
  return openSessionOfKind(db, user, input, "mass", now);
}
