import { writeFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";
import { massSundayFor } from "../src/lib/attendance/mass-week";
import { todayInVietnam } from "../src/lib/dates";

const EDIT_NAME = "Trần Sửa";
const E2E_PW = "e2e-password-1";
const dayOffset = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return todayInVietnam(d);
};

export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("Thiếu E2E_DATABASE_URL");
  if (!/e2e/i.test(new URL(url).pathname)) throw new Error("Tên database E2E phải chứa 'e2e' (tránh xóa nhầm DB thật)");

  const sql = postgres(url, { max: 1 });
  await sql`drop schema if exists public cascade`;
  await sql`drop schema if exists drizzle cascade`;
  await sql`create schema public`;
  const db = drizzle(sql, { schema: s });
  await migrate(db, { migrationsFolder: "./drizzle" });

  const hash = await hashPassword(E2E_PW);
  const [gradeA] = await db.insert(s.grades).values({ name: "Khối E2E A" }).returning();
  const [gradeB] = await db.insert(s.grades).values({ name: "Khối E2E B" }).returning();
  const [year] = await db.insert(s.schoolYears).values({ name: "E2E" }).returning();
  const [term] = await db.insert(s.terms).values({ schoolYearId: year.id, name: "Học kỳ E2E", startsOn: dayOffset(-60), endsOn: dayOffset(120) }).returning();
  const [glvA] = await db.insert(s.users).values({ email: "glv-a@e2e.vn", name: "GLV A", passwordHash: hash, gradeId: gradeA.id }).returning();
  const [glvB] = await db.insert(s.users).values({ email: "glv-b@e2e.vn", name: "GLV B", passwordHash: hash, gradeId: gradeB.id }).returning();
  const [headA] = await db.insert(s.users).values({ email: "head-a@e2e.vn", name: "Trưởng khối A", passwordHash: hash, gradeId: gradeA.id, isGradeHead: true }).returning();
  await db.insert(s.users).values({ email: "head-b@e2e.vn", name: "Trưởng khối B", passwordHash: hash, gradeId: gradeB.id, isGradeHead: true });
  const [glvReset] = await db.insert(s.users).values({ email: "glv-reset@e2e.vn", name: "GLV Reset", passwordHash: hash, gradeId: gradeA.id }).returning();
  const [classA] = await db.insert(s.classes).values({ gradeId: gradeA.id, name: "Lớp A" }).returning();
  const [classB] = await db.insert(s.classes).values({ gradeId: gradeB.id, name: "Lớp B" }).returning();
  const [classC] = await db.insert(s.classes).values({ gradeId: gradeA.id, name: "Lớp C" }).returning();
  const [classT] = await db.insert(s.classes).values({ gradeId: gradeA.id, name: "Lớp T" }).returning();
  const [classQ] = await db.insert(s.classes).values({ gradeId: gradeA.id, name: "Lớp Q" }).returning();
  // GLV thứ hai của lớp A/Q cho project tablet: bảng tra quét giới hạn 30 lần/phút mỗi người, hai project chạy liền nhau với cùng một người sẽ chạm giới hạn.
  const [glvA2] = await db.insert(s.users).values({ email: "glv-a2@e2e.vn", name: "GLV A2", passwordHash: hash, gradeId: gradeA.id }).returning();
  await db.insert(s.classCatechists).values([{ classId: classQ.id, userId: glvA.id }, { classId: classQ.id, userId: glvA2.id }, { classId: classA.id, userId: glvA2.id }]);
  // Thêm hai GLV lớp A cho các test hàng quét bền (tải lại trang, đăng nhập lại): mỗi lần mở màn quét tải bảng tra một lần.
  const extra = await db.insert(s.users).values(["glv-a3@e2e.vn", "glv-a4@e2e.vn"].map((email, i) => ({ email, name: `GLV A${i + 3}`, passwordHash: hash, gradeId: gradeA.id }))).returning();
  await db.insert(s.classCatechists).values(extra.map((u) => ({ classId: classA.id, userId: u.id })));
  // GLV chỉ phụ trách lớp A (mỗi project một người) cho các test bảng <-> máy quét: trang chủ chỉ có một thẻ lớp.
  const boardUsers = await db.insert(s.users).values(["glv-a5@e2e.vn", "glv-a6@e2e.vn"].map((email, i) => ({ email, name: `GLV A${i + 5}`, passwordHash: hash, gradeId: gradeA.id }))).returning();
  await db.insert(s.classCatechists).values(boardUsers.map((u) => ({ classId: classA.id, userId: u.id })));
  await db.insert(s.students).values(Array.from({ length: 30 }, (_, i) => ({ classId: classQ.id, fullName: `Em Q${String(i + 1).padStart(2, "0")}` })));
  // GLV lớp A cho test quét đi lễ tại nhà thờ (mỗi project một người): bảng tra giới hạn 30 lần/phút mỗi người.
  const massUsers = await db.insert(s.users).values(["glv-m1@e2e.vn", "glv-m2@e2e.vn"].map((email, i) => ({ email, name: `GLV M${i + 1}`, passwordHash: hash, gradeId: gradeA.id }))).returning();
  await db.insert(s.classCatechists).values(massUsers.map((u) => ({ classId: classA.id, userId: u.id })));
  await db.insert(s.classCatechists).values([
    { classId: classA.id, userId: glvA.id }, { classId: classB.id, userId: glvB.id },
    { classId: classC.id, userId: glvReset.id }, { classId: classC.id, userId: headA.id },
  ]);
  await db.insert(s.students).values({ classId: classC.id, fullName: EDIT_NAME });
  // Lớp T (30 em) và GLV riêng: test mẫu sơ đồ tạo/xóa sơ đồ của lớp này mà không đụng các lớp khác.
  const [glvT] = await db.insert(s.users).values({ email: "glv-t@e2e.vn", name: "GLV T", passwordHash: hash, gradeId: gradeA.id }).returning();
  await db.insert(s.classCatechists).values({ classId: classT.id, userId: glvT.id });
  await db.insert(s.students).values(Array.from({ length: 30 }, (_, i) => ({ classId: classT.id, fullName: `Em T${String(i + 1).padStart(2, "0")}` })));

  // Lớp P (hồ sơ em): một em có SĐT + ghi chú, một em chưa có SĐT; cả hai vắng không phép để hiện ở "Cần chú ý". GLV riêng để lọc đúng.
  const [classP] = await db.insert(s.classes).values({ gradeId: gradeA.id, name: "Lớp P" }).returning();
  const [glvP] = await db.insert(s.users).values({ email: "glv-p@e2e.vn", name: "GLV P", passwordHash: hash, gradeId: gradeA.id }).returning();
  await db.insert(s.classCatechists).values({ classId: classP.id, userId: glvP.id });
  const [kidWithPhone, kidNoPhone] = await db.insert(s.students).values([
    { classId: classP.id, fullName: "Lê Hồ Sơ", saintName: "Giuse", birthDate: "2015-03-04", parentPhone: "0901234567", note: "Hay quên sách" },
    { classId: classP.id, fullName: "Phạm Chưa Số" },
  ]).returning();
  const profileSessions = await db.insert(s.sessions).values([dayOffset(-14), dayOffset(-7)].map((heldOn) => ({ classId: classP.id, termId: term.id, heldOn }))).returning();
  await db.insert(s.attendance).values([
    { sessionId: profileSessions[0].id, studentId: kidWithPhone.id, status: "present" },
    { sessionId: profileSessions[1].id, studentId: kidWithPhone.id, status: "absent_unexcused", reason: "Về quê" },
    { sessionId: profileSessions[0].id, studentId: kidNoPhone.id, status: "absent_unexcused" },
    { sessionId: profileSessions[1].id, studentId: kidNoPhone.id, status: "absent_unexcused" },
  ]);

  // Khối C / Lớp M (thống kê đi lễ): khối riêng để trưởng khối C đổi ngưỡng mà không ảnh hưởng cảnh báo của khối A.
  // Cả ba em có dòng buổi học từ đầu kỳ; ba tuần đi lễ đã ghi: Đỗ đi cả ba, Võ vắng 2 tuần (= ngưỡng 2 => cảnh báo),
  // Hồ vắng 1 tuần (chỉ cảnh báo khi trưởng khối hạ ngưỡng xuống 1).
  const [gradeC] = await db.insert(s.grades).values({ name: "Khối E2E C" }).returning();
  await db.insert(s.users).values({ email: "head-c@e2e.vn", name: "Trưởng khối C", passwordHash: hash, gradeId: gradeC.id, isGradeHead: true });
  const [classM] = await db.insert(s.classes).values({ gradeId: gradeC.id, name: "Lớp M" }).returning();
  const [glvMc] = await db.insert(s.users).values({ email: "glv-mc@e2e.vn", name: "GLV MC", passwordHash: hash, gradeId: gradeC.id }).returning();
  await db.insert(s.classCatechists).values({ classId: classM.id, userId: glvMc.id });
  const [kidMassAll, kidMassWarn, kidMassOne] = await db.insert(s.students).values([
    { classId: classM.id, fullName: "Đỗ Lễ Đều" },
    { classId: classM.id, fullName: "Võ Vắng Lễ", parentPhone: "0907654321" },
    { classId: classM.id, fullName: "Hồ Vắng Một" },
  ]).returning();
  const [massEnrolled] = await db.insert(s.sessions).values({ classId: classM.id, termId: term.id, heldOn: dayOffset(-35) }).returning();
  await db.insert(s.attendance).values([kidMassAll, kidMassWarn, kidMassOne].map((k) => ({ sessionId: massEnrolled.id, studentId: k.id, status: "present" as const })));
  const massWeeks = await db.insert(s.sessions).values([-21, -14, -7].map((d) => ({ classId: classM.id, termId: term.id, heldOn: massSundayFor(dayOffset(d)), kind: "mass" as const }))).returning();
  await db.insert(s.attendance).values([
    ...massWeeks.map((w) => ({ sessionId: w.id, studentId: kidMassAll.id, status: "present" as const })),
    { sessionId: massWeeks[0].id, studentId: kidMassWarn.id, status: "present" as const },
    { sessionId: massWeeks[1].id, studentId: kidMassWarn.id, status: "absent_unexcused" as const }, // tuần 3: không có dòng => vẫn vắng lễ
    { sessionId: massWeeks[0].id, studentId: kidMassOne.id, status: "present" as const },
    { sessionId: massWeeks[1].id, studentId: kidMassOne.id, status: "present" as const },
    { sessionId: massWeeks[2].id, studentId: kidMassOne.id, status: "absent_excused" as const },
  ]);

  const kids = await db.insert(s.students).values(["An", "Bình", "Chi", "Dũng"].map((n) => ({ classId: classA.id, fullName: `Nguyễn ${n}` }))).returning();
  const [plan] = await db.insert(s.seatingPlans).values({
    classId: classA.id, name: "Sơ đồ E2E", isActive: true,
    layout: [{ id: "r1", items: [{ type: "bench", id: "b1", seats: 2 }, { type: "gap", id: "g1" }, { type: "bench", id: "b2", seats: 2 }] }],
  }).returning();
  await db.insert(s.seatAssignments).values([
    { planId: plan.id, benchId: "b1", seatIndex: 0, studentId: kids[0].id },
    { planId: plan.id, benchId: "b1", seatIndex: 1, studentId: kids[1].id },
    { planId: plan.id, benchId: "b2", seatIndex: 0, studentId: kids[2].id },
    { planId: plan.id, benchId: "b2", seatIndex: 1, studentId: kids[3].id },
  ]);
  const [past] = await db.insert(s.sessions).values({ classId: classA.id, termId: term.id, heldOn: dayOffset(-7) }).returning();
  await db.insert(s.attendance).values({ sessionId: past.id, studentId: kids[0].id, status: "absent_unexcused" });

  writeFileSync("e2e/.state.json", JSON.stringify({ classA: classA.id, classB: classB.id, classC: classC.id, classQ: classQ.id, classT: classT.id, classP: classP.id, kidWithPhone: kidWithPhone.id, kidNoPhone: kidNoPhone.id,
    gradeC: gradeC.id, classM: classM.id, kidMassWarn: kidMassWarn.id, kidMassOne: kidMassOne.id }));
  await sql.end();
}
