import { z } from "zod";
import { getAccessClass } from "@/db/queries/access";
import type { Db } from "@/db/types";
import { canAccess, type AccessAction, type AccessClass, type AppUser } from "@/lib/access/can-access";

export const NOT_FOUND = "Không tìm thấy lớp";

/** Trả null cả khi lớp không tồn tại lẫn khi không đủ quyền, để không lộ lớp nào có thật. */
export async function guardClass(
  db: Db,
  user: AppUser,
  classId: string,
  action: AccessAction,
): Promise<AccessClass | null> {
  if (!z.uuid().safeParse(classId).success) return null;
  const cls = await getAccessClass(db, classId);
  return cls && canAccess(user, cls, action) ? cls : null;
}

export async function classPermissions(
  db: Db,
  user: AppUser,
  classId: string,
): Promise<{ canRead: boolean; canWrite: boolean }> {
  if (!z.uuid().safeParse(classId).success) return { canRead: false, canWrite: false };
  const cls = await getAccessClass(db, classId);
  if (!cls) return { canRead: false, canWrite: false };
  return { canRead: canAccess(user, cls, "read"), canWrite: canAccess(user, cls, "write") };
}
