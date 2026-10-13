import { sql } from "drizzle-orm";
import {
  boolean, check, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, smallint, text, time, timestamp, unique, uniqueIndex, uuid,
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
  /** Quản trị viên quản lý tài khoản, khối và lớp trên toàn hệ thống. */
  isAdmin: boolean("is_admin").notNull().default(false),
  /** Tài khoản bị khóa không thể đăng nhập hoặc sử dụng phiên cũ. */
  isActive: boolean("is_active").notNull().default(true),
  /** Tăng mỗi lần thu hồi phiên: so khớp chính xác ngay cả khi khóa/mở tài khoản trong cùng một giây. */
  sessionVersion: integer("session_version").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  /**
   * Lúc đổi/đặt lại mật khẩu gần nhất (làm tròn xuống giây). Phiên có `sat` (lúc đăng nhập) trước mốc này bị DAL từ chối.
   * NULL: chưa đổi lần nào (phiên cũ vẫn hợp lệ).
   */
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
}, (t) => [check("users_session_version_nonnegative", sql`${t.sessionVersion} >= 0`)]);

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
    /** Mỗi lớp thuộc một niên khóa; lớp cùng tên ở năm khác có ID riêng để giữ lịch sử. */
    schoolYearId: uuid("school_year_id").notNull().references(() => schoolYears.id, { onDelete: "restrict" }).default(sql`default_school_year_id()`),
    name: text("name").notNull(),
    /** Thứ trong tuần lớp học (0 = Chủ nhật … 6 = Thứ bảy); null = chưa đặt lịch (không nhắc). */
    meetsOn: smallint("meets_on"),
    /** Giờ bắt đầu buổi học (giờ Việt Nam, "HH:MM:SS"); null cùng lúc với `meetsOn`. */
    meetsAt: time("meets_at"),
  },
  (t) => [
    uniqueIndex("classes_grade_year_name_uq").on(t.gradeId, t.schoolYearId, t.name),
    index("classes_school_year_idx").on(t.schoolYearId),
    check("classes_meets_on_range", sql`${t.meetsOn} between 0 and 6`),
    check("classes_schedule_both_or_neither", sql`(${t.meetsOn} is null) = (${t.meetsAt} is null)`),
  ],
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

/** Danh sách lớp đã từng tham gia; trigger giữ cả lớp cũ khi chuyển lớp, kể cả em chưa được điểm danh. */
export const classMemberships = pgTable(
  "class_memberships",
  {
    classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.classId, t.studentId] }),
    index("class_memberships_student_idx").on(t.studentId),
  ],
);

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

export const auditEntity = pgEnum("audit_entity", ["attendance", "student", "seating_plan", "session", "grade_settings", "school_year", "promotion", "class", "account", "grade"]);

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
    check("audit_events_scope", sql`${t.classId} is not null or ${t.gradeId} is not null or ${t.entity}::text in ('account', 'grade', 'school_year')`),
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
    /** Các thành viên mới của lớp đích do lượt lên lớp tạo, dùng khi hoàn tác; NULL = lượt cũ chưa theo dõi. */
    newMembershipStudentIds: uuid("new_membership_student_ids").array(),
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

/**
 * Đăng ký Web Push của một thiết bị (spec §4). `endpoint` là URL của dịch vụ push (đã qua danh sách cho phép, xem
 * `src/lib/push/endpoint.ts`) và là duy nhất: một thiết bị đổi tài khoản thì dòng chuyển sang tài khoản mới.
 * `failure_count` đếm lần gửi lỗi tạm thời liên tiếp (429/5xx/lỗi mạng); đủ ngưỡng thì xoá đăng ký. `created_at` được đặt lại
 * mỗi lần thiết bị đồng bộ (mở trang Tài khoản), nên khi vượt trần 10 thiết bị thì thiết bị lâu nhất chưa đồng bộ bị bỏ.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
    failureCount: integer("failure_count").notNull().default(0),
    /** 401/403 liên tiếp (khoá VAPID đã đổi): đếm riêng, ngưỡng xoá cao hơn. Lỗi cục bộ không được đếm. */
    authFailureCount: integer("auth_failure_count").notNull().default(0),
  },
  (t) => [
    unique("push_subscriptions_endpoint_unique").on(t.endpoint),
    index("push_subscriptions_user_idx").on(t.userId, t.createdAt),
    check("push_subscriptions_user_agent_len", sql`${t.userAgent} is null or char_length(${t.userAgent}) <= 200`),
  ],
);

/**
 * Nhật ký đã gửi thông báo, để tác vụ định kỳ (Task 39) không gửi trùng: chèn `on conflict do nothing` trước khi gửi.
 * `target_key` là khoá đối tượng do loại thông báo tự dựng (ví dụ lớp + ngày). Khoá duy nhất coi NULL như nhau.
 */
export const notificationLog = pgTable(
  "notification_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    targetKey: text("target_key").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("notification_log_kind_target_user_uq").on(t.kind, t.targetKey, t.userId).nullsNotDistinct()],
);
