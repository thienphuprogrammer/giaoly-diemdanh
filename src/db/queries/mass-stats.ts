import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { tallyMass, type MassWeek } from "@/lib/attendance/mass-tally";
import { membershipOf } from "@/lib/promotion";
import { attendance, classMemberships, classes, grades, sessions, students } from "../schema";
import type { Db } from "../types";
import { neverMarkedInTerm, notMarkedElsewhereIn } from "./stats";

type Reader = Pick<Db, "select" | "selectDistinct">;

/** Đi lễ không có "đi muộn"; một dòng `late` cũ (nếu có) vẫn là đã đi lễ. */
const ATTENDED = new Set(["present", "late"]);

export interface MassGridStudent {
  id: string;
  classId: string;
  fullName: string;
  saintName: string | null;
  /** Chỉ dùng ở server (nút gọi phụ huynh); không đưa xuống props client của trang danh sách. */
  parentPhone: string | null;
  /** Ngày của dòng điểm danh đầu tiên của em ở lớp hiện tại (buổi học hoặc đi lễ, mọi trạng thái, mọi học kỳ). */
  firstSeen: string | null;
  /** `grades.mass_threshold` của khối chứa lớp. */
  threshold: number;
  /** Các buổi đi lễ đã ghi nhận mà em có đi (present/late). */
  attended: ReadonlySet<string>;
  /** Nhãn theo `membershipOf` (src/lib/promotion.ts): đã lên lớp khác / đã nghỉ (chỉ gặp với `includeFormer`). */
  former: boolean;
  inactive: boolean;
}

export interface MassGrid {
  /** Tuần đi lễ đã ghi nhận của từng lớp, cũ trước. Lớp chưa có tuần nào thì không có khoá. */
  weeks: Map<string, MassWeek[]>;
  students: MassGridStudent[];
}

interface GridInput {
  classIds: string[];
  termId: string;
  /** Bỏ một buổi khỏi phép đếm (buổi đang quét: "trước đó"). */
  excludeSessionId?: string;
  /** Chỉ một em (kể cả em đã ẩn: trang hồ sơ); mặc định mọi em đang hoạt động của các lớp. */
  studentId?: string;
  /**
   * Học kỳ đã qua (quy tắc của `termRoster`): thêm các em có dòng điểm danh (học hoặc đi lễ) ở buổi của lớp trong học
   * kỳ nhưng nay đã ở lớp khác (lên lớp), tính theo lớp của buổi; bỏ em đang học ở lớp mà đã có dòng ở buổi của lớp
   * khác trong học kỳ (em được chuyển vào sau). Không dùng cho học kỳ hiện tại.
   */
  includeFormer?: boolean;
}

/**
 * Dữ liệu đi lễ của các lớp trong học kỳ (spec §1b), hai truy vấn chạy song song:
 * 1. mọi dòng điểm danh của buổi `mass` chưa huỷ của các lớp trong học kỳ. Một tuần "đã ghi nhận" chính là một buổi
 *    xuất hiện ở đây (có ít nhất một dòng, của bất kỳ em nào, kể cả em đã ẩn/chuyển lớp); tuần chưa mở, mở mà rỗng
 *    hoặc "không có lễ" tự nhiên không có mặt;
 * 2. danh sách em kèm ngày xuất hiện đầu tiên ở lớp (heuristic em vào lớp giữa kỳ, xem `tallyMass`) và ngưỡng của khối.
 * Không thêm truy vấn nào vào đường quét (`applyScan`); chỉ bảng tra lúc mở máy quét đi lễ và các trang thống kê dùng.
 */
export async function massGrid(db: Reader, { classIds, termId, excludeSessionId, studentId, includeFormer }: GridInput): Promise<MassGrid> {
  if (classIds.length === 0) return { weeks: new Map(), students: [] };
  // Ngày xuất hiện đầu tiên của mỗi em ở từng lớp (đi từ buổi của các lớp, dùng chỉ mục buổi theo lớp và khoá chính
  // của `attendance`); ghép với em theo lớp HIỆN TẠI của em. Em vừa lên lớp (Task 36, đổi `class_id`) vì vậy "bắt đầu
  // lại" ở lớp mới: chưa có dòng nào ở lớp mới => chưa tuần nào bị tính vắng lễ; dòng ở lớp cũ không tính cho lớp mới.
  const first = db
    .select({
      studentId: attendance.studentId,
      classId: sessions.classId,
      firstSeen: sql<string>`min(${sessions.heldOn})::text`.as("first_seen"),
    })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
    .where(and(inArray(sessions.classId, classIds), studentId ? eq(attendance.studentId, studentId) : undefined))
    .groupBy(attendance.studentId, sessions.classId)
    .as("first");
  // Cặp (em, lớp của buổi) có dòng trong học kỳ: em đã lên lớp vẫn thuộc số liệu cũ của lớp này.
  const pairs = db
    .selectDistinct({ studentId: attendance.studentId, classId: sessions.classId })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
    .where(and(inArray(sessions.classId, classIds), eq(sessions.termId, termId)))
    .as("pairs");
  const formerQuery = includeFormer
    ? db.select({
      id: students.id, classId: pairs.classId, currentClassId: students.classId, active: students.active,
      fullName: students.fullName, saintName: students.saintName,
      parentPhone: students.parentPhone, firstSeen: first.firstSeen, threshold: grades.massThreshold,
    })
      .from(pairs)
      .innerJoin(students, eq(students.id, pairs.studentId))
      .leftJoin(first, and(eq(first.studentId, pairs.studentId), eq(first.classId, pairs.classId)))
      .innerJoin(classes, eq(classes.id, pairs.classId))
      .innerJoin(grades, eq(grades.id, classes.gradeId))
      .where(studentId ? eq(students.id, studentId) : undefined)
    : Promise.resolve([]);
  const unmarkedFormerQuery = includeFormer
    ? db.select({
      id: students.id, classId: classMemberships.classId, currentClassId: students.classId, active: students.active,
      fullName: students.fullName, saintName: students.saintName,
      parentPhone: students.parentPhone, firstSeen: first.firstSeen, threshold: grades.massThreshold,
    }).from(classMemberships)
      .innerJoin(students, eq(students.id, classMemberships.studentId))
      .leftJoin(first, and(eq(first.studentId, students.id), eq(first.classId, classMemberships.classId)))
      .innerJoin(classes, eq(classes.id, classMemberships.classId))
      .innerJoin(grades, eq(grades.id, classes.gradeId))
      .where(and(inArray(classMemberships.classId, classIds), ne(students.classId, classMemberships.classId), neverMarkedInTerm(termId), studentId ? eq(students.id, studentId) : undefined))
    : Promise.resolve([]);
  const [rows, roster, formerRows, unmarkedFormerRows] = await Promise.all([
    db.select({ classId: sessions.classId, sessionId: sessions.id, heldOn: sessions.heldOn, studentId: attendance.studentId, status: attendance.status })
      .from(attendance)
      .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
      .where(and(
        inArray(sessions.classId, classIds),
        eq(sessions.termId, termId),
        eq(sessions.kind, "mass"),
        eq(sessions.cancelled, false),
        excludeSessionId ? ne(sessions.id, excludeSessionId) : undefined,
      ))
      .orderBy(asc(sessions.heldOn)),
    db.select({
      id: students.id, classId: students.classId, currentClassId: students.classId, active: students.active,
      fullName: students.fullName, saintName: students.saintName,
      parentPhone: students.parentPhone, firstSeen: first.firstSeen, threshold: grades.massThreshold,
    })
      .from(students)
      .leftJoin(first, and(eq(first.studentId, students.id), eq(first.classId, students.classId)))
      .innerJoin(classes, eq(classes.id, students.classId))
      .innerJoin(grades, eq(grades.id, classes.gradeId))
      .where(and(
        inArray(students.classId, classIds),
        studentId ? eq(students.id, studentId) : eq(students.active, true),
        // Học kỳ đã qua: cùng quy tắc với `termRoster` (em được chuyển vào sau, đã có dòng ở lớp khác, không thuộc lớp).
        includeFormer ? notMarkedElsewhereIn(termId) : undefined,
      ))
      .orderBy(asc(students.fullName)),
    formerQuery,
    unmarkedFormerQuery,
  ]);

  const weeks = new Map<string, MassWeek[]>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.sessionId)) continue;
    seen.add(r.sessionId);
    weeks.set(r.classId, [...(weeks.get(r.classId) ?? []), { sessionId: r.sessionId, heldOn: r.heldOn }]);
  }
  const attendedBy = new Map<string, Set<string>>();
  for (const r of rows) {
    if (ATTENDED.has(r.status)) attendedBy.set(r.studentId, new Set([...(attendedBy.get(r.studentId) ?? []), r.sessionId]));
  }
  return {
    weeks,
    students: mergeRoster(mergeRoster(roster, formerRows), unmarkedFormerRows)
      .map(({ currentClassId, active, ...s }) => ({
        ...s, ...membershipOf({ currentClassId, active }, s.classId), attended: attendedBy.get(s.id) ?? new Set<string>(),
      })),
  };
}

/** Danh sách hiện tại + các cặp (em, lớp của buổi) chưa có trong đó (học kỳ đã qua); sắp theo tên khi có thêm em. */
function mergeRoster<T extends { id: string; classId: string; fullName: string }>(roster: T[], extra: T[]): T[] {
  const have = new Set(roster.map((s) => `${s.classId}:${s.id}`));
  const added = extra.filter((s) => !have.has(`${s.classId}:${s.id}`));
  return added.length === 0 ? roster : [...roster, ...added].sort((a, b) => a.fullName.localeCompare(b.fullName, "vi"));
}

/**
 * Số tuần KHÔNG ĐI LỄ của từng em trong học kỳ — định nghĩa duy nhất (spec §1b, `tallyMass`), dùng chung cho bảng
 * tra máy quét đi lễ và cảnh báo đi lễ:
 * - một tuần "đã ghi nhận" = buổi `mass` của lớp trong học kỳ, KHÔNG bị huỷ, và có ít nhất một dòng điểm danh;
 * - em "không đi lễ" một tuần đã ghi nhận khi em không có dòng `present` trong buổi đó (dòng vắng hoặc không có dòng);
 * - chỉ tính các tuần từ ngày em có dòng điểm danh đầu tiên ở lớp (em vào lớp giữa kỳ); em chưa từng có dòng => 0.
 * Trả về Map cho mọi em đang hoạt động của lớp.
 */
export async function missedMassWeeks(
  db: Reader, { classId, termId, excludeSessionId }: { classId: string; termId: string; excludeSessionId?: string },
): Promise<Map<string, number>> {
  const grid = await massGrid(db, { classIds: [classId], termId, excludeSessionId });
  const weeks = grid.weeks.get(classId) ?? [];
  return new Map(grid.students.map((s) => [s.id, tallyMass(weeks, s.firstSeen, s.attended).missed]));
}
