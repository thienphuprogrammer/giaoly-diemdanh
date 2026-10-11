import { sql } from "drizzle-orm";
import {
  boolean, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import type { Layout } from "../lib/seating/types";

export const attendanceStatus = pgEnum("attendance_status", [
  "present", "absent_excused", "absent_unexcused", "late",
]);

export const grades = pgTable("grades", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  gradeId: uuid("grade_id").references(() => grades.id, { onDelete: "set null" }),
  /** Trưởng khối xem được mọi lớp trong khối `gradeId`. */
  isGradeHead: boolean("is_grade_head").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const loginAttempts = pgTable("login_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  attemptedAt: timestamp("attempted_at").notNull().defaultNow(),
}, (t) => [index("login_attempts_email_attempted_at_idx").on(t.email, t.attemptedAt)]);

export const schoolYears = pgTable("school_years", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

export const terms = pgTable("terms", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolYearId: uuid("school_year_id").notNull().references(() => schoolYears.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
});

export const classes = pgTable(
  "classes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gradeId: uuid("grade_id").notNull().references(() => grades.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("classes_grade_name_uq").on(t.gradeId, t.name)],
);

export const classCatechists = pgTable(
  "class_catechists",
  {
    classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.classId, t.userId] })],
);

export const students = pgTable("students", {
  id: uuid("id").primaryKey().defaultRandom(),
  classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
  saintName: text("saint_name"),
  fullName: text("full_name").notNull(),
  birthDate: date("birth_date"),
  parentPhone: text("parent_phone"),
  note: text("note"),
  active: boolean("active").notNull().default(true),
  /** Mã trên thẻ QR: 32 hex do cơ sở dữ liệu sinh, không đoán được, duy nhất. */
  qrToken: text("qr_token").notNull().unique().default(sql`replace(gen_random_uuid()::text, '-', '')`),
});

export const seatingPlans = pgTable(
  "seating_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    layout: jsonb("layout").$type<Layout>().notNull().default(sql`'[]'::jsonb`),
    isActive: boolean("is_active").notNull().default(false),
  },
  (t) => [uniqueIndex("seating_plans_one_active").on(t.classId).where(sql`${t.isActive} = true`)],
);

export const seatAssignments = pgTable(
  "seat_assignments",
  {
    planId: uuid("plan_id").notNull().references(() => seatingPlans.id, { onDelete: "cascade" }),
    benchId: text("bench_id").notNull(),
    seatIndex: integer("seat_index").notNull(),
    studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.planId, t.benchId, t.seatIndex] }),
    uniqueIndex("seat_assignments_student_uq").on(t.planId, t.studentId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    termId: uuid("term_id").notNull().references(() => terms.id, { onDelete: "cascade" }),
    heldOn: date("held_on").notNull(),
    cancelled: boolean("cancelled").notNull().default(false),
    note: text("note"),
  },
  (t) => [uniqueIndex("sessions_class_date_uq").on(t.classId, t.heldOn)],
);

export const attendance = pgTable(
  "attendance",
  {
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    status: attendanceStatus("status").notNull(),
    reason: text("reason"),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    /** Lượt quét (hoặc lần "Tất cả có mặt") gần nhất đã ghi dòng này; NULL khi ghi tay (không hoàn tác được bằng lượt cũ). */
    lastEventId: uuid("last_event_id"),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.studentId] })],
);

export const scanKind = pgEnum("scan_kind", ["scan", "manual", "undo"]);
export const scanResult = pgEnum("scan_result", ["applied", "noop"]);

/** Nhật ký quét/chọn tên/hoàn tác: chống ghi trùng theo event_id và cho phép hoàn tác đúng lượt. Lượt bị từ chối không được lưu. */
export const attendanceScans = pgTable(
  "attendance_scans",
  {
    eventId: uuid("event_id").primaryKey(),
    kind: scanKind("kind").notNull(),
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").references(() => students.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    mode: text("mode"),
    payloadHash: text("payload_hash").notNull(),
    prevStatus: attendanceStatus("prev_status"),
    prevReason: text("prev_reason"),
    newStatus: attendanceStatus("new_status"),
    result: scanResult("result").notNull(),
    errorCode: text("error_code"),
    targetEventId: uuid("target_event_id"),
    capturedAt: timestamp("captured_at"),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
  },
  (t) => [index("attendance_scans_session_idx").on(t.sessionId, t.receivedAt)],
);
