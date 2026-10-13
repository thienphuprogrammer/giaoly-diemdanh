import { and, count, eq, inArray } from "drizzle-orm";
import { findTermFor } from "@/db/queries/attendance";
import { listClassesForUser } from "@/db/queries/classes";
import { resolveTerm } from "@/db/queries/stats";
import { attendance, classes, sessions, students } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { scheduleLabel, toHhMm } from "@/lib/class-schedule";
import { todayInVietnam } from "@/lib/dates";
import { massAttentionList, type MassAttentionItem } from "./mass-stats";
import { attentionList, type AttentionItem } from "./stats";
import { listSchoolYearsForUser, resolveSchoolYearForUser, type SchoolYearSummary } from "./school-years";
import { compareByGivenName } from "@/lib/students/name";

export interface HomeClass {
  id: string;
  name: string;
  gradeId: string;
  schoolYearId: string;
  schoolYearName: string;
  studentCount: number;
  canWrite: boolean;
  meetsOn: number | null;
  meetsAt: string | null;
  scheduleLabel: string | null;
  session: { id: string; cancelled: boolean; marked: number } | null;
}

export interface HomeAttentionItem {
  studentId: string;
  fullName: string;
  classId: string;
  className: string;
  classAbsences: number | null;
  massMissed: number | null;
  warning: boolean;
}

export interface HomeOverview {
  today: string;
  schoolYear: { id: string; name: string } | null;
  years: SchoolYearSummary[];
  /** Contains today exactly; null during holidays or between terms. */
  activeTerm: { id: string; name: string } | null;
  /** Selected reporting term, which may be a past or future term. */
  term: { id: string; name: string; startsOn: string; endsOn: string } | null;
  classes: HomeClass[];
  attention: HomeAttentionItem[];
  summary: { classes: number; students: number; attention: number };
}

async function classProgress(
  db: Db, visible: Awaited<ReturnType<typeof listClassesForUser>>, today: string,
): Promise<HomeClass[]> {
  if (visible.length === 0) return [];
  // Count the roster and its marks together: old marks for children who left the class cannot inflate progress.
  const rows = await db.select({
    classId: classes.id, meetsOn: classes.meetsOn, meetsAt: classes.meetsAt,
    sessionId: sessions.id, cancelled: sessions.cancelled,
    studentCount: count(students.id), marked: count(attendance.studentId),
  })
    .from(classes)
    .leftJoin(sessions, and(eq(sessions.classId, classes.id), eq(sessions.heldOn, today), eq(sessions.kind, "class")))
    .leftJoin(students, and(eq(students.classId, classes.id), eq(students.active, true)))
    .leftJoin(attendance, and(eq(attendance.sessionId, sessions.id), eq(attendance.studentId, students.id)))
    .where(inArray(classes.id, visible.map((c) => c.id)))
    .groupBy(classes.id, sessions.id);
  const details = new Map(rows.map((r) => [r.classId, r]));
  return visible.flatMap((cls) => {
    const row = details.get(cls.id);
    if (!row) return [];
    const schedule = { meetsOn: row.meetsOn, meetsAt: toHhMm(row.meetsAt) };
    return [{
      ...cls, ...schedule, scheduleLabel: scheduleLabel(schedule),
      session: row.sessionId ? { id: row.sessionId, cancelled: row.cancelled ?? false, marked: row.marked } : null,
    }];
  });
}

function combinedAttention(absence: AttentionItem[], mass: MassAttentionItem[]): HomeAttentionItem[] {
  const combined = new Map<string, HomeAttentionItem>();
  for (const item of absence) {
    combined.set(item.studentId, {
      studentId: item.studentId, fullName: item.fullName, classId: item.classId, className: item.className,
      classAbsences: item.unexcused, massMissed: null, warning: item.level === "warning",
    });
  }
  for (const item of mass) {
    const existing = combined.get(item.studentId);
    combined.set(item.studentId, {
      studentId: item.studentId, fullName: item.fullName, classId: item.classId, className: item.className,
      classAbsences: existing?.classAbsences ?? null, massMissed: item.missed, warning: true,
    });
  }
  return [...combined.values()].sort((a, b) =>
    Number(b.warning) - Number(a.warning) ||
    compareByGivenName(a.fullName, b.fullName) ||
    a.className.localeCompare(b.className, "vi") || a.studentId.localeCompare(b.studentId));
}

/** Read-only homepage data, using the same visibility and warning rules as class and attention pages. */
export async function homeOverview(db: Db, user: AppUser, today: string = todayInVietnam(), schoolYearId?: string): Promise<HomeOverview> {
  const [year, years] = await Promise.all([
    resolveSchoolYearForUser(db, user, schoolYearId, today), listSchoolYearsForUser(db, user),
  ]);
  const [visible, activeTerm, selectedTerm] = await Promise.all([
    year ? listClassesForUser(db, user, year.id, today) : Promise.resolve([]),
    year ? findTermFor(db, today, year.id) : Promise.resolve(null),
    year ? resolveTerm(db, undefined, today, year.id) : Promise.resolve(null),
  ]);
  const [classList, absence, mass] = await Promise.all([
    classProgress(db, visible, today),
    selectedTerm && visible.length > 0 ? attentionList(db, user, selectedTerm.id, today) : Promise.resolve([]),
    selectedTerm && visible.length > 0 ? massAttentionList(db, user, selectedTerm.id, today) : Promise.resolve([]),
  ]);
  const attention = combinedAttention(absence, mass);
  return {
    today, activeTerm, schoolYear: year ? { id: year.id, name: year.name } : null, years,
    term: selectedTerm ? {
      id: selectedTerm.id, name: selectedTerm.name, startsOn: selectedTerm.startsOn, endsOn: selectedTerm.endsOn,
    } : null,
    classes: classList, attention,
    summary: {
      classes: classList.length,
      students: classList.reduce((total, cls) => total + cls.studentCount, 0),
      attention: attention.length,
    },
  };
}
