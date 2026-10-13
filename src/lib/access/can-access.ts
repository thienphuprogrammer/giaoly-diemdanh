export interface AppUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  /** Revocation epoch of the authenticated request, read on the server. */
  sessionVersion: number;
  isGradeHead: boolean;
  gradeId: string | null;
}

export interface AccessClass {
  id: string;
  gradeId: string;
  schoolYearId: string;
  catechistIds: readonly string[];
}

export type AccessAction = "read" | "write";
type Actor = Pick<AppUser, "id" | "isAdmin" | "isGradeHead" | "gradeId">;

export function canAccess(user: Actor, cls: AccessClass, action: AccessAction): boolean {
  if (user.isAdmin) return true;
  const assigned = cls.catechistIds.includes(user.id);
  if (action === "write") return assigned;
  return assigned || (user.isGradeHead && user.gradeId === cls.gradeId);
}

export function canManageGrade(user: Pick<AppUser, "isAdmin" | "isGradeHead" | "gradeId">, gradeId: string): boolean {
  return user.isAdmin || (user.isGradeHead && user.gradeId === gradeId);
}
