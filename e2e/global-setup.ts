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

  // Khối E / Lớp R (báo cáo học kỳ in A4): 60 em để báo cáo dài hơn một trang; trưởng khối E, GLV R riêng (khối riêng nên không đổi số đếm của các khối khác).
  // Em thứ i (1..60): buổi 2 vắng KP nếu i%5==0; buổi 3 vắng KP nếu i%10==0 (=> i%10==0 cảnh báo vắng KP), muộn nếu i%7==0.
  // Đi lễ 2 tuần: tuần 1 vắng KP nếu i%6==0; tuần 2 vắng KP nếu i%4==0 (=> i%12==0 cảnh báo vắng lễ). Mọi em có SĐT (báo cáo không được lộ).
  const [gradeE] = await db.insert(s.grades).values({ name: "Khối E2E E" }).returning();
  await db.insert(s.users).values({ email: "head-e@e2e.vn", name: "Trưởng khối E", passwordHash: hash, gradeId: gradeE.id, isGradeHead: true });
  const [glvR] = await db.insert(s.users).values({ email: "glv-r@e2e.vn", name: "GLV R", passwordHash: hash, gradeId: gradeE.id }).returning();
  const [classR] = await db.insert(s.classes).values({ gradeId: gradeE.id, name: "Lớp R" }).returning();
  await db.insert(s.classCatechists).values({ classId: classR.id, userId: glvR.id });
  const kidsR = await db.insert(s.students).values(Array.from({ length: 60 }, (_, i) => ({
    classId: classR.id, fullName: `Em R${String(i + 1).padStart(2, "0")}`, saintName: i % 2 === 0 ? "Giuse" : "Maria", parentPhone: `09123450${String(i + 1).padStart(2, "0")}`,
  }))).returning();
  const sessionsR = await db.insert(s.sessions).values([-21, -14, -7].map((d) => ({ classId: classR.id, termId: term.id, heldOn: dayOffset(d) }))).returning();
  const massR = await db.insert(s.sessions).values([-14, -7].map((d) => ({ classId: classR.id, termId: term.id, heldOn: massSundayFor(dayOffset(d)), kind: "mass" as const }))).returning();
  await db.insert(s.attendance).values(kidsR.flatMap((k, idx) => {
    const i = idx + 1;
    return [
      { sessionId: sessionsR[0].id, studentId: k.id, status: "present" as const },
      { sessionId: sessionsR[1].id, studentId: k.id, status: i % 5 === 0 ? "absent_unexcused" as const : "present" as const },
      { sessionId: sessionsR[2].id, studentId: k.id, status: i % 10 === 0 ? "absent_unexcused" as const : i % 7 === 0 ? "late" as const : "present" as const },
      { sessionId: massR[0].id, studentId: k.id, status: i % 6 === 0 ? "absent_unexcused" as const : "present" as const },
      { sessionId: massR[1].id, studentId: k.id, status: i % 4 === 0 ? "absent_unexcused" as const : "present" as const },
    ];
  }));

  // Lớp N (nhật ký): lớp riêng, GLV riêng; test tự gieo dòng nhật ký/lượt quét bằng SQL rồi dọn lại. Trưởng khối A đọc được (chỉ xem).
  const [classN] = await db.insert(s.classes).values({ gradeId: gradeA.id, name: "Lớp N" }).returning();
  const [glvN] = await db.insert(s.users).values({ email: "glv-n@e2e.vn", name: "GLV N", passwordHash: hash, gradeId: gradeA.id }).returning();
  await db.insert(s.classCatechists).values({ classId: classN.id, userId: glvN.id });
  await db.insert(s.students).values([{ classId: classN.id, fullName: "Nhật Ký Một" }, { classId: classN.id, fullName: "Nhật Ký Hai" }]);

  // Khối D (năm học mới + lên lớp): khối riêng với trưởng khối riêng; Lớp D1 có 3 em (một em có chỗ ngồi), Lớp D2 trống.
  const [gradeD] = await db.insert(s.grades).values({ name: "Khối E2E D" }).returning();
  await db.insert(s.users).values({ email: "head-d@e2e.vn", name: "Trưởng khối D", passwordHash: hash, gradeId: gradeD.id, isGradeHead: true });
  const [classD1] = await db.insert(s.classes).values({ gradeId: gradeD.id, name: "Lớp D1" }).returning();
  const [classD2] = await db.insert(s.classes).values({ gradeId: gradeD.id, name: "Lớp D2" }).returning();
  const [glvD1, glvD2] = await db.insert(s.users).values(["glv-d1@e2e.vn", "glv-d2@e2e.vn"].map((email, i) => ({ email, name: `GLV D${i + 1}`, passwordHash: hash, gradeId: gradeD.id }))).returning();
  await db.insert(s.classCatechists).values([{ classId: classD1.id, userId: glvD1.id }, { classId: classD2.id, userId: glvD2.id }]);
  const kidsD = await db.insert(s.students).values(["Lên Lớp Một", "Lên Lớp Hai", "Ở Lại Ba"].map((fullName) => ({ classId: classD1.id, fullName }))).returning();
  const [planD] = await db.insert(s.seatingPlans).values({
    classId: classD1.id, name: "Sơ đồ D1", isActive: true, layout: [{ id: "r1", items: [{ type: "bench", id: "b1", seats: 2 }] }],
  }).returning();
  await db.insert(s.seatAssignments).values({ planId: planD.id, benchId: "b1", seatIndex: 0, studentId: kidsD[0].id });

  // Khối L / Lớp L (lịch học) + GLV thông báo đẩy (mỗi project một người, để đăng ký của hai project không lẫn nhau).
  // Khối riêng để số lớp/thống kê của các khối khác không đổi; trưởng khối L sửa được lịch học.
  const [gradeL] = await db.insert(s.grades).values({ name: "Khối E2E L" }).returning();
  await db.insert(s.users).values({ email: "head-l@e2e.vn", name: "Trưởng khối L", passwordHash: hash, gradeId: gradeL.id, isGradeHead: true });
  const [classL] = await db.insert(s.classes).values({ gradeId: gradeL.id, name: "Lớp L" }).returning();
  const lUsers = await db.insert(s.users).values(["glv-l@e2e.vn", "glv-push-phone-375@e2e.vn", "glv-push-tablet-768@e2e.vn"]
    .map((email, i) => ({ email, name: `GLV L${i + 1}`, passwordHash: hash, gradeId: gradeL.id }))).returning();
  await db.insert(s.classCatechists).values(lUsers.map((u) => ({ classId: classL.id, userId: u.id })));

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

  writeFileSync("e2e/.state.json", JSON.stringify({ classA: classA.id, classB: classB.id, classC: classC.id, classQ: classQ.id, classT: classT.id, classP: classP.id, classN: classN.id, glvN: glvN.id, kidWithPhone: kidWithPhone.id, kidNoPhone: kidNoPhone.id,
    gradeC: gradeC.id, classM: classM.id, kidMassWarn: kidMassWarn.id, kidMassOne: kidMassOne.id,
    gradeE: gradeE.id, classR: classR.id,
    gradeD: gradeD.id, classD1: classD1.id, classD2: classD2.id, planD: planD.id, classL: classL.id }));
  await sql.end();
}
