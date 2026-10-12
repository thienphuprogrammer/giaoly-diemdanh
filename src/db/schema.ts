import { sql } from "drizzle-orm";
import {
  boolean, check, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Layout } from "../lib/seating/types";

export const attendanceStatus = pgEnum("attendance_status", [
  "present", "absent_excused", "absent_unexcused", "late",
]);

export const sessionKind = pgEnum("session_kind", ["class", "mass"]);
/** Loại buổi: `class` = buổi học giáo lý, `mass` = thánh lễ Chúa nhật của lớp. */
export type SessionKind = (typeof sessionKind.enumValues)[number];

export const grades = pgTable("grades", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  /** Số tuần không đi lễ trong học kỳ bắt đầu cảnh báo (trưởng khối sửa). */
  massThreshold: integer("mass_threshold").notNull().default(2),
  /** Khối kế tiếp khi lên lớp (trưởng khối nguồn chọn); null = chỉ lên lớp trong cùng khối. */
  nextGradeId: uuid("next_grade_id").references((): AnyPgColumn => grades.id, { onDelete: "set null" }),
}, (t) => [
  check("grades_mass_threshold_min", sql`${t.massThreshold} >= 1`),
  check("grades_next_grade_not_self", sql`${t.nextGradeId} is null or ${t.nextGradeId} <> ${t.id}`),
]);

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
    /** `class` = buổi học giáo lý; `mass` = thánh lễ Chúa nhật của lớp. Truy vấn buổi học/thống kê phải lọc `class`. */
    kind: sessionKind("kind").notNull().default("class"),
    cancelled: boolean("cancelled").notNull().default(false),
    note: text("note"),
  },
  (t) => [uniqueIndex("sessions_class_date_kind_uq").on(t.classId, t.heldOn, t.kind)],
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

export const auditEntity = pgEnum("audit_entity", ["attendance", "student", "seating_plan", "session", "grade_settings", "school_year", "promotion"]);

/**
 * Nhật ký thay đổi (spec §2): một dòng cho mỗi thao tác thủ công THẬT SỰ đổi dữ liệu, ghi trong cùng transaction với
 * thay đổi; thao tác hàng loạt = một dòng tổng hợp. Lượt quét không ghi ở đây (đã có `attendance_scans`).
 * `summary` đã qua `sanitizeSummary` (không token/payload thẻ, SĐT chỉ dạng đã che). Sự kiện cấp khối có `grade_id`, không `class_id`.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    classId: uuid("class_id").references(() => classes.id, { onDelete: "cascade" }),
    gradeId: uuid("grade_id").references(() => grades.id, { onDelete: "cascade" }),
    entity: auditEntity("entity").notNull(),
    entityId: text("entity_id"),
    action: text("action").notNull(),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    // Keyset (at desc, id desc): cột cuối `id` để thứ tự ổn định khi trùng `at`.
    index("audit_events_class_at_idx").on(t.classId, t.at.desc(), t.id.desc()),
    index("audit_events_grade_at_idx").on(t.gradeId, t.at.desc(), t.id.desc()),
    index("audit_events_at_idx").on(t.at),
    check("audit_events_scope", sql`${t.classId} is not null or ${t.gradeId} is not null`),
    check("audit_events_summary_object", sql`jsonb_typeof(${t.summary}) = 'object'`),
    check("audit_events_action_format", sql`${t.action} ~ '^[a-z_]+\\.[a-z_]+$'`),
  ],
);

/**
 * Một lượt lên lớp (spec §3): các em được CHUYỂN `students.class_id` từ lớp nguồn sang lớp đích (thẻ QR, lịch sử giữ nguyên).
 * Dùng để hoàn tác trong 24 giờ (chỉ chuyển lại các em còn ở lớp đích). `removed_seats` chỉ để tham khảo: hoàn tác không
 * khôi phục chỗ ngồi. `(actor_id, client_token)` duy nhất để bấm hai lần không chuyển hai lần.
 */
export const promotions = pgTable(
  "promotions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    fromClassId: uuid("from_class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    toClassId: uuid("to_class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    studentIds: uuid("student_ids").array().notNull(),
    removedSeats: jsonb("removed_seats").$type<{ planId: string; benchId: string; seatIndex: number; studentId: string }[]>().notNull().default(sql`'[]'::jsonb`),
    clientToken: uuid("client_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneBy: uuid("undone_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("promotions_actor_client_token_uq").on(t.actorId, t.clientToken),
    index("promotions_from_class_created_idx").on(t.fromClassId, t.createdAt.desc()),
    check("promotions_distinct_classes", sql`${t.fromClassId} <> ${t.toClassId}`),
  ],
);
