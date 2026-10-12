import type { sessions } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { isSunday, massSundayFor } from "@/lib/attendance/mass-week";
import { fail, ok, type ActionResult } from "../result";
import { checkOpenInput, openCheckedSession } from "./attendance";

export const SUNDAY_REQUIRED = "Buổi đi lễ phải vào Chúa nhật (hoặc chọn ngày lễ thủ công)";

/**
 * Mở (hoặc lấy lại) buổi đi lễ của lớp ngày `heldOn` chọn tường minh (màn quét tại nhà thờ): phải là Chúa nhật, trừ khi
 * người có quyền ghi chọn ngày lễ thủ công (`manual: true`, lễ trọng). Idempotent; không bao giờ trả về buổi học cùng ngày.
 */
export async function openMassSession(db: Db, user: AppUser, input: unknown, now: Date = new Date()): Promise<ActionResult<{ id: string }>> {
  const checked = await checkOpenInput(db, user, input, now);
  if (!checked.ok) return checked;
  const { classId, heldOn, manual } = checked.data;
  if (!manual && !isSunday(heldOn)) return fail(SUNDAY_REQUIRED);
  const opened = await openCheckedSession(db, classId, heldOn, "mass", [heldOn]);
  return opened.ok ? ok({ id: opened.data.id }) : opened;
}

/**
 * Lối vào của bảng điểm danh: nhận NGÀY HỌC và tự chọn thánh lễ của tuần đó (`massSundayFor`: Chúa nhật trên hoặc trước
 * ngày học). Tuần đầu học kỳ, Chúa nhật có thể rơi trước `terms.starts_on` (lớp học thứ Bảy đầu tiên): khi đó buổi đi lễ
 * thuộc học kỳ của ngày học, để tích đi lễ trên bảng không bao giờ bị từ chối chỉ vì ranh giới học kỳ.
 */
export async function openMassForClassDate(
  db: Db, user: AppUser, input: unknown, now: Date = new Date(),
): Promise<ActionResult<{ id: string; sunday: string }>> {
  const checked = await checkOpenInput(db, user, input, now);
  if (!checked.ok) return checked;
  const opened = await openMassOfWeek(db, checked.data.classId, checked.data.heldOn);
  return opened.ok ? ok({ id: opened.data.id, sunday: opened.data.heldOn }) : opened;
}

/** Phần mở của `openMassForClassDate` sau khi người gọi đã kiểm tra quyền/ngày (`checkOpenInput`). */
export function openMassOfWeek(db: Db, classId: string, classDate: string): Promise<ActionResult<typeof sessions.$inferSelect>> {
  const sunday = massSundayFor(classDate);
  return openCheckedSession(db, classId, sunday, "mass", [sunday, classDate]);
}
