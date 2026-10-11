export interface AppUser {
  id: string;
  email: string;
  name: string;
  isGradeHead: boolean;
  gradeId: string | null;
}

export interface AccessClass {
  id: string;
  gradeId: string;
  catechistIds: readonly string[];
}

export type AccessAction = "read" | "write";
type Actor = Pick<AppUser, "id" | "isGradeHead" | "gradeId">;

export function canAccess(user: Actor, cls: AccessClass, action: AccessAction): boolean {
  const assigned = cls.catechistIds.includes(user.id);
  if (action === "write") return assigned;
  return assigned || (user.isGradeHead && user.gradeId === cls.gradeId);
}

export function canManageGrade(user: Pick<AppUser, "isGradeHead" | "gradeId">, gradeId: string): boolean {
  return user.isGradeHead && user.gradeId === gradeId;
}
