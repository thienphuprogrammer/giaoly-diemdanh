import {
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const attendanceStatus = pgEnum("attendance_status", [
  "present",
  "absent_excused",
  "absent_unexcused",
  "late",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  /** Trưởng khối xem được mọi lớp trong khối của mình. */
  isGradeHead: boolean("is_grade_head").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const schoolYears = pgTable("school_years", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(), // "2026-2027"
});

export const terms = pgTable("terms", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolYearId: uuid("school_year_id").notNull().references(() => schoolYears.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // "Học kỳ 1"
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
});

export const grades = pgTable("grades", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(), // "Khối Thiếu Nhi 1"
  headId: uuid("head_id").references(() => users.id, { onDelete: "set null" }),
});

export const classes = pgTable("classes", {
  id: uuid("id").primaryKey().defaultRandom(),
  gradeId: uuid("grade_id").notNull().references(() => grades.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
});

export const classCatechists = pgTable(
  "class_catechists",
  {
    classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("class_catechists_uq").on(t.classId, t.userId)],
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
});

/** Sơ đồ lưới: cells[row][col] = "seat" | "aisle" | "blocked". */
export const seatingPlans = pgTable("seating_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  rows: integer("rows").notNull(),
  cols: integer("cols").notNull(),
  cells: jsonb("cells").$type<string[][]>().notNull(),
  isActive: boolean("is_active").notNull().default(false),
});

export const seatAssignments = pgTable(
  "seat_assignments",
  {
    planId: uuid("plan_id").notNull().references(() => seatingPlans.id, { onDelete: "cascade" }),
    row: integer("row").notNull(),
    col: integer("col").notNull(),
    studentId: uuid("student_id").references(() => students.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("seat_assignments_uq").on(t.planId, t.row, t.col)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    termId: uuid("term_id").notNull().references(() => terms.id, { onDelete: "cascade" }),
    heldOn: date("held_on").notNull(),
    /** Buổi nghỉ lễ: không tính vào điểm danh. */
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
  },
  (t) => [uniqueIndex("attendance_uq").on(t.sessionId, t.studentId)],
);
