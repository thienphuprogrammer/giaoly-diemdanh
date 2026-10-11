# Web điểm danh lớp giáo lý — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web mobile-first để giáo lý viên điểm danh theo buổi bằng sơ đồ băng ghế hoặc checklist, cảnh báo khi một em vắng không phép ≥ 2 buổi/học kỳ, có thống kê và trang tổng quan cho trưởng khối.

**Architecture:** Logic nghiệp vụ là hàm thuần trong `src/lib/*`. Truy vấn DB nằm trong `src/db/queries/*`. Mọi thao tác ghi đi qua `src/server/services/*` (nhận `db` + `user` + input `unknown`, validate bằng zod, kiểm quyền bằng `guardClass`, trả `ActionResult`), được test bằng PGlite (Postgres in-memory, không cần DB ngoài). Server Action trong `src/app/**/actions.ts` chỉ là lớp mỏng: `requireUser()` → gọi service → `revalidatePath`.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), TypeScript, Tailwind v4, Postgres + Drizzle ORM, session stateless bằng `jose` + cookie, `bcryptjs`, `zod` v4, `exceljs`, Vitest + PGlite, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-11-diemdanh-giaoly-design.md`

**Điều chỉnh so với spec** (đã cập nhật vào spec cùng lúc với kế hoạch này):
1. Bỏ Auth.js beta, dùng session stateless `jose` + cookie `httpOnly` theo hướng dẫn trong `node_modules/next/dist/docs/01-app/02-guides/authentication.md`. Cookie chỉ chứa `userId`; thông tin người dùng và quyền được đọc lại từ DB ở mỗi request, nên đổi quyền có hiệu lực ngay.
2. Mục `gap` trong layout có thêm `id` để làm React key.
3. Trưởng khối xác định bằng `users.is_grade_head` + `users.grade_id` (bỏ `grades.head_id`), để GLV mới tạo chưa gán lớp vẫn thuộc khối.

## Global Constraints

- Next.js **16.4**: file `src/proxy.ts` (không phải `middleware.ts`); `params` và `searchParams` là `Promise` phải `await`; đọc `node_modules/next/dist/docs/01-app/` trước khi dùng API Next chưa quen.
- Giao diện **tiếng Việt**, mobile-first, kiểm tra ở **375px** và **768px**; vùng chạm ≥ 44px; không cuộn ngang toàn trang.
- Ngưỡng cảnh báo mặc định: `unexcusedThreshold = 2` vắng không phép / học kỳ (`DEFAULT_RULES`).
- Trạng thái điểm danh đúng 4 giá trị: `present`, `absent_excused`, `absent_unexcused`, `late`. Chưa điểm danh = không có bản ghi.
- Băng 2–4 ghế; tối đa 12 hàng; tối đa 8 băng/hàng. Một em một ghế/sơ đồ.
- Ngày buổi học là chuỗi `YYYY-MM-DD` theo múi giờ **Asia/Ho_Chi_Minh**.
- Hàm thuần không sửa đối số, luôn trả bản sao mới. Hàm < 50 dòng, file < 800 dòng.
- Module có `import "server-only"` chỉ gồm `src/db/client.ts`, `src/lib/auth/dal.ts` và các `actions.ts`; mọi thứ cần test bằng Vitest **không** được import `server-only`.
- Không hardcode secret; `AUTH_SECRET` ≥ 32 ký tự, kiểm tra khi dùng.
- Coverage ≥ **80%** cho `src/lib`, `src/server`, `src/db/queries`.
- Commit theo `<type>: <description>` (feat, fix, refactor, docs, test, chore), kèm dòng attribution mà phiên làm việc yêu cầu. Chỉ `git add` đúng file của task.

## Review Focus

Các tình huống spec không nói rõ nhưng dễ gây lỗi cho người dùng thật; mỗi dòng có test ở task sở hữu code:

1. **CSV thực tế** — file từ Excel có BOM, phân cách `;`, tên có dấu phẩy trong ngoặc kép, chữ Việt dạng NFD, dòng trống, tên trùng → không được vỡ hoặc tạo trùng (Task 7).
2. **Múi giờ và ranh giới học kỳ** — mở app lúc 00:30 giờ VN (vẫn là 17:30 UTC hôm trước) phải ra đúng "hôm nay"; ngày đầu/cuối học kỳ thuộc học kỳ; ngày ngoài mọi học kỳ báo lỗi rõ (Task 10).
3. **Bấm đúp / hai thiết bị cùng lúc** — cùng em, cùng buổi, ghi hai lần hoặc song song → vẫn đúng một bản ghi (Task 10).
4. **Em bị ẩn và GLV bị gỡ khỏi lớp** — em ẩn không xếp ghế, không điểm danh, không nằm trong thống kê nhưng lịch sử còn; GLV bị gỡ khỏi lớp mất quyền ngay dù cookie còn hạn (Task 4, 9, 12).
5. **Công thức trong file xuất** — tên bắt đầu bằng `=`, `+`, `-`, `@` phải được ghi thành văn bản, không bao giờ thành công thức, kể cả khi sau này người dùng chuyển file sang CSV (Task 12; `safeCell` là lớp phòng thủ bổ sung vì exceljs đã ghi chuỗi dạng văn bản).

## Cấu trúc file

```
src/
  lib/
    attendance/  warning.ts · summary.ts · toggle.ts
    seating/     types.ts · layout.ts · assignments.ts
    access/      can-access.ts
    auth/        password.ts · session.ts · rate-limit.ts · authenticate.ts · dal.ts(server-only)
    import/      csv.ts
    export/      excel.ts
    dates.ts · validation.ts · students/short-name.ts
  db/            schema.ts · types.ts · client.ts(server-only) · queries/{access,students,classes,seating,attendance,stats}.ts
  server/        result.ts · guard.ts · services/{students,admin,seating,attendance}.ts
  test/          db.ts (PGlite + migrate) · fixtures.ts
  components/    nav/BottomNav.tsx · seating/SeatMap.tsx · ...
  app/           login · (app)/{page,can-chu-y,khoi,tai-khoan,lop/[classId]/...} · manifest.ts
  proxy.ts
scripts/         seed.ts · make-icons.ts
e2e/             setup.ts · attendance.spec.ts
drizzle/         migrations (commit vào git)
```

---

## Mốc 1 — Nền tảng, đăng nhập, phân quyền

### Task 1: Dependency, theme, khung layout

**Files:**
- Modify: `package.json`, `src/app/layout.tsx`, `src/app/globals.css`, `.gitignore`

**Interfaces:**
- Produces: các CSS token `--paper --card --ink --ink-soft --line --brand --st-present --st-excused --st-unexcused --st-late --st-none --warn-watch --warn-alert` và Tailwind color `paper card ink ink-soft line brand st-* warn-*`; font `font-body`, `font-display`.

- [ ] **Step 1: Đổi dependency**

```bash
cd /home/alexander/Workspaces/Project/diemdanh-giaoly
pnpm remove xlsx next-auth
pnpm add jose server-only exceljs
pnpm add -D @electric-sql/pglite @playwright/test tsx
pnpm exec playwright install chromium
```

- [ ] **Step 2: Thay `src/app/globals.css`** (đọc file trước, ghi đè toàn bộ)

```css
@import "tailwindcss";

:root {
  --paper: #f7f1e6;
  --card: #fffdf8;
  --ink: #2b2118;
  --ink-soft: #6b5d4f;
  --line: #e3d8c4;
  --brand: #2f5d46;
  --st-present: #3f7d4e;
  --st-excused: #3b6ea5;
  --st-unexcused: #b3392f;
  --st-late: #c98a1b;
  --st-none: #b9ad99;
  --warn-watch: #c98a1b;
  --warn-alert: #b3392f;
}

@theme inline {
  --color-paper: var(--paper);
  --color-card: var(--card);
  --color-ink: var(--ink);
  --color-ink-soft: var(--ink-soft);
  --color-line: var(--line);
  --color-brand: var(--brand);
  --color-st-present: var(--st-present);
  --color-st-excused: var(--st-excused);
  --color-st-unexcused: var(--st-unexcused);
  --color-st-late: var(--st-late);
  --color-st-none: var(--st-none);
  --color-warn-watch: var(--warn-watch);
  --color-warn-alert: var(--warn-alert);
  --font-body: var(--font-body-face), system-ui, sans-serif;
  --font-display: var(--font-display-face), Georgia, serif;
}

html { background: var(--paper); color: var(--ink); }
body { font-family: var(--font-body); -webkit-tap-highlight-color: transparent; }
h1, h2, h3 { font-family: var(--font-display); }
```

- [ ] **Step 3: Thay `src/app/layout.tsx`**

```tsx
import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Fraunces } from "next/font/google";
import "./globals.css";

const body = Be_Vietnam_Pro({
  variable: "--font-body-face",
  subsets: ["vietnamese", "latin"],
  weight: ["400", "500", "600", "700"],
});
const display = Fraunces({
  variable: "--font-display-face",
  subsets: ["vietnamese", "latin"],
});

export const metadata: Metadata = {
  title: "Điểm danh Giáo lý",
  description: "Điểm danh lớp giáo lý theo sơ đồ chỗ ngồi",
};

export const viewport: Viewport = {
  themeColor: "#2f5d46",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${body.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: Bổ sung `.gitignore`**

```bash
printf '/test-results/\n/playwright-report/\n/coverage/\n' >> .gitignore
```

- [ ] **Step 5: Xác nhận build chạy**

Run: `pnpm build`
Expected: build thành công (trang `/` mặc định vẫn còn, sẽ thay ở Task 5).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/app/layout.tsx src/app/globals.css .gitignore
git commit -m "chore: swap xlsx/next-auth for jose/exceljs, add theme tokens"
```

---

### Task 2: Sửa schema, migration, DB test bằng PGlite

**Files:**
- Create: `src/lib/seating/types.ts`, `src/db/types.ts`, `src/test/db.ts`, `src/test/fixtures.ts`, `src/db/schema.test.ts`, `drizzle/*` (sinh ra)
- Modify: `src/db/schema.ts`, `drizzle.config.ts` (giữ nguyên nếu đã đúng)

**Interfaces:**
- Produces:
  - `type Db = PgDatabase<any, typeof schema>` (`src/db/types.ts`)
  - `createTestDb(): Promise<Db>` (`src/test/db.ts`)
  - `seedBasics(db): Promise<Basics>` với `Basics = { grade, otherGrade, term, head, glv, otherGlv, cls, otherCls }` (các bản ghi đầy đủ từ DB; thêm `classId = cls.id`, `otherClassId`, `termId = term.id`, `gradeId`, `otherGradeId`) (`src/test/fixtures.ts`)
  - Types `BenchItem | GapItem`, `LayoutRow`, `Layout`, `Seat`, `Assignment` (`src/lib/seating/types.ts`)
  - Bảng: `users(gradeId,isGradeHead)`, `grades`, `schoolYears`, `terms`, `classes`, `classCatechists`, `students`, `seatingPlans(layout)`, `seatAssignments(planId,benchId,seatIndex,studentId)`, `sessions`, `attendance`, `loginAttempts(email,attemptedAt)`.

- [ ] **Step 1: Viết test lỗi** — `src/db/schema.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { seatAssignments, seatingPlans, sessions, students } from "@/db/schema";

async function setup() {
  const db = await createTestDb();
  const basics = await seedBasics(db);
  const [plan] = await db
    .insert(seatingPlans)
    .values({ classId: basics.classId, name: "A", layout: [] })
    .returning();
  const [kid] = await db
    .insert(students)
    .values({ classId: basics.classId, fullName: "Nguyễn An" })
    .returning();
  return { db, basics, plan, kid };
}

describe("schema constraints", () => {
  it("rejects a student seated twice in one plan", async () => {
    const { db, plan, kid } = await setup();
    await db.insert(seatAssignments).values({ planId: plan.id, benchId: "b1", seatIndex: 0, studentId: kid.id });
    await expect(
      db.insert(seatAssignments).values({ planId: plan.id, benchId: "b1", seatIndex: 1, studentId: kid.id }),
    ).rejects.toThrow();
  });

  it("rejects two students on one seat", async () => {
    const { db, basics, plan, kid } = await setup();
    const [other] = await db.insert(students).values({ classId: basics.classId, fullName: "Trần Bình" }).returning();
    await db.insert(seatAssignments).values({ planId: plan.id, benchId: "b1", seatIndex: 0, studentId: kid.id });
    await expect(
      db.insert(seatAssignments).values({ planId: plan.id, benchId: "b1", seatIndex: 0, studentId: other.id }),
    ).rejects.toThrow();
  });

  it("allows only one active plan per class", async () => {
    const { db, basics } = await setup();
    await db.insert(seatingPlans).values({ classId: basics.classId, name: "B", layout: [], isActive: true });
    await expect(
      db.insert(seatingPlans).values({ classId: basics.classId, name: "C", layout: [], isActive: true }),
    ).rejects.toThrow();
  });

  it("allows one session per class per day", async () => {
    const { db, basics } = await setup();
    const row = { classId: basics.classId, termId: basics.termId, heldOn: "2026-10-11" };
    await db.insert(sessions).values(row);
    await expect(db.insert(sessions).values(row)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Chạy để thấy lỗi**

Run: `pnpm test src/db/schema.test.ts`
Expected: FAIL — không tìm thấy `@/test/db`.

- [ ] **Step 3: Tạo `src/lib/seating/types.ts`**

```ts
export interface BenchItem { type: "bench"; id: string; seats: number }
export interface GapItem { type: "gap"; id: string }
export type LayoutItem = BenchItem | GapItem;
export interface LayoutRow { id: string; items: LayoutItem[] }
export type Layout = LayoutRow[];

export interface Seat { benchId: string; seatIndex: number }
export interface Assignment extends Seat { studentId: string }
```

- [ ] **Step 4: Ghi đè `src/db/schema.ts`**

```ts
import { sql } from "drizzle-orm";
import {
  boolean, date, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
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
});

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
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.studentId] })],
);
```

- [ ] **Step 5: Tạo `src/db/types.ts`**

```ts
import type { PgDatabase } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

// `any` cho query-result HKT để cả postgres-js (production) lẫn PGlite (test) đều gán được.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;
```

- [ ] **Step 6: Sinh migration**

Run: `pnpm drizzle-kit generate --name init`
Expected: tạo `drizzle/0000_init.sql` và `drizzle/meta/*`.

- [ ] **Step 7: Tạo `src/test/db.ts`**

```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";

/** Mỗi lần gọi trả về một Postgres in-memory mới, đã áp migration. */
export async function createTestDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db as unknown as Db;
}
```

- [ ] **Step 8: Tạo `src/test/fixtures.ts`**

```ts
import { classCatechists, classes, grades, schoolYears, terms, users } from "@/db/schema";
import type { Db } from "@/db/types";

export async function seedBasics(db: Db) {
  const [grade] = await db.insert(grades).values({ name: "Khối 1" }).returning();
  const [otherGrade] = await db.insert(grades).values({ name: "Khối 2" }).returning();
  const [year] = await db.insert(schoolYears).values({ name: "2026-2027" }).returning();
  const [term] = await db
    .insert(terms)
    .values({ schoolYearId: year.id, name: "Học kỳ 1", startsOn: "2026-09-01", endsOn: "2027-01-15" })
    .returning();

  const mk = async (email: string, extra: Partial<typeof users.$inferInsert> = {}) =>
    (await db.insert(users).values({ email, name: email, passwordHash: "x", ...extra }).returning())[0];

  const head = await mk("head@x.vn", { isGradeHead: true, gradeId: grade.id });
  const glv = await mk("glv@x.vn", { gradeId: grade.id });
  const otherGlv = await mk("other@x.vn", { gradeId: otherGrade.id });

  const [cls] = await db.insert(classes).values({ gradeId: grade.id, name: "Lớp A" }).returning();
  const [otherCls] = await db.insert(classes).values({ gradeId: otherGrade.id, name: "Lớp B" }).returning();
  await db.insert(classCatechists).values([
    { classId: cls.id, userId: glv.id },
    { classId: otherCls.id, userId: otherGlv.id },
  ]);

  return {
    grade, otherGrade, term, head, glv, otherGlv, cls, otherCls,
    gradeId: grade.id, otherGradeId: otherGrade.id, termId: term.id,
    classId: cls.id, otherClassId: otherCls.id,
  };
}
export type Basics = Awaited<ReturnType<typeof seedBasics>>;
```

- [ ] **Step 9: Chạy test**

Run: `pnpm test src/db/schema.test.ts`
Expected: PASS (4 test).

- [ ] **Step 10: Type-check và commit**

Run: `pnpm exec tsc --noEmit` — Expected: không lỗi.

```bash
git add src/db src/lib/seating/types.ts src/test drizzle
git commit -m "feat: revise schema for bench seating, add PGlite test harness"
```

---

### Task 3: Băm mật khẩu và session JWT

**Files:**
- Create: `src/lib/auth/password.ts`, `src/lib/auth/session.ts`, `src/lib/auth/password.test.ts`, `src/lib/auth/session.test.ts`

**Interfaces:**
- Produces:
  - `hashPassword(plain: string): Promise<string>`, `verifyPassword(plain: string, hash: string): Promise<boolean>`, `DUMMY_HASH: string`
  - `interface SessionPayload { userId: string }`
  - `encryptSession(payload: SessionPayload, secret: string, expiresAt?: string | number): Promise<string>` (mặc định `"7d"`; số = epoch giây)
  - `decryptSession(token: string | undefined, secret: string): Promise<SessionPayload | null>`

- [ ] **Step 1: Viết test** — `src/lib/auth/session.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { decryptSession, encryptSession } from "./session";

const SECRET = "s".repeat(32);

describe("session", () => {
  it("round-trips the payload", async () => {
    const token = await encryptSession({ userId: "u1" }, SECRET);
    expect(await decryptSession(token, SECRET)).toEqual({ userId: "u1" });
  });

  it("rejects a tampered token", async () => {
    const token = await encryptSession({ userId: "u1" }, SECRET);
    expect(await decryptSession(token.slice(0, -3) + "abc", SECRET)).toBeNull();
  });

  it("rejects a token signed with another secret", async () => {
    const token = await encryptSession({ userId: "u1" }, "t".repeat(32));
    expect(await decryptSession(token, SECRET)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const token = await encryptSession({ userId: "u1" }, SECRET, past);
    expect(await decryptSession(token, SECRET)).toBeNull();
  });

  it("returns null for missing or empty token", async () => {
    expect(await decryptSession(undefined, SECRET)).toBeNull();
    expect(await decryptSession("", SECRET)).toBeNull();
  });
});
```

`src/lib/auth/password.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password";

describe("password", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(await verifyPassword("correct-horse-battery", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("does not store the plain password", async () => {
    expect(await hashPassword("secret-secret")).not.toContain("secret-secret");
  });

  it("exposes a valid dummy hash for constant-time failures", async () => {
    expect(await verifyPassword("anything", DUMMY_HASH)).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy để thấy lỗi**

Run: `pnpm test src/lib/auth`
Expected: FAIL — thiếu module.

- [ ] **Step 3: Cài đặt** — `src/lib/auth/password.ts`

```ts
import bcrypt from "bcryptjs";

const COST = 10;

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, COST);
export const verifyPassword = (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash);

/** So sánh với hash giả khi email không tồn tại, để thời gian phản hồi không lộ email nào có thật. */
export const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", COST);
```

`src/lib/auth/session.ts`

```ts
import { SignJWT, jwtVerify } from "jose";

export interface SessionPayload { userId: string }

const ALG = "HS256";
const key = (secret: string) => new TextEncoder().encode(secret);

export async function encryptSession(
  payload: SessionPayload,
  secret: string,
  expiresAt: string | number = "7d",
): Promise<string> {
  return new SignJWT({ userId: payload.userId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(key(secret));
}

export async function decryptSession(
  token: string | undefined,
  secret: string,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: [ALG] });
    return typeof payload.userId === "string" ? { userId: payload.userId } : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Chạy test**

Run: `pnpm test src/lib/auth`
Expected: PASS (8 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth
git commit -m "feat: add password hashing and signed session tokens"
```

---

### Task 4: Phân quyền `canAccess`, `guardClass`, `ActionResult`

**Files:**
- Create: `src/lib/access/can-access.ts`, `src/lib/access/can-access.test.ts`, `src/db/queries/access.ts`, `src/server/result.ts`, `src/server/guard.ts`, `src/server/guard.test.ts`

**Interfaces:**
- Produces:
  - `interface AppUser { id: string; email: string; name: string; isGradeHead: boolean; gradeId: string | null }`
  - `interface AccessClass { id: string; gradeId: string; catechistIds: readonly string[] }`
  - `type AccessAction = "read" | "write"`
  - `canAccess(user: Pick<AppUser,"id"|"isGradeHead"|"gradeId">, cls: AccessClass, action: AccessAction): boolean`
  - `canManageGrade(user: Pick<AppUser,"isGradeHead"|"gradeId">, gradeId: string): boolean`
  - `getAccessClass(db: Db, classId: string): Promise<AccessClass | null>`
  - `type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }`; `ok(data)`, `fail(error)`
  - `guardClass(db: Db, user: AppUser, classId: string, action: AccessAction): Promise<AccessClass | null>` (trả `null` khi lớp không tồn tại, id sai định dạng **hoặc** không đủ quyền)
  - `NOT_FOUND = "Không tìm thấy lớp"`

- [ ] **Step 1: Viết test** — `src/lib/access/can-access.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { canAccess, canManageGrade, type AccessClass } from "./can-access";

const cls: AccessClass = { id: "c1", gradeId: "g1", catechistIds: ["glv"] };
const glv = { id: "glv", isGradeHead: false, gradeId: "g1" };
const stranger = { id: "x", isGradeHead: false, gradeId: "g1" };
const head = { id: "head", isGradeHead: true, gradeId: "g1" };
const otherHead = { id: "h2", isGradeHead: true, gradeId: "g2" };

describe("canAccess", () => {
  it("lets an assigned catechist read and write", () => {
    expect(canAccess(glv, cls, "read")).toBe(true);
    expect(canAccess(glv, cls, "write")).toBe(true);
  });

  it("denies an unassigned catechist", () => {
    expect(canAccess(stranger, cls, "read")).toBe(false);
    expect(canAccess(stranger, cls, "write")).toBe(false);
  });

  it("lets the grade head read but not write classes in the grade", () => {
    expect(canAccess(head, cls, "read")).toBe(true);
    expect(canAccess(head, cls, "write")).toBe(false);
  });

  it("lets the grade head write after assigning themselves", () => {
    expect(canAccess(head, { ...cls, catechistIds: ["glv", "head"] }, "write")).toBe(true);
  });

  it("denies a head of another grade", () => {
    expect(canAccess(otherHead, cls, "read")).toBe(false);
  });

  it("denies a catechist who was removed from the class", () => {
    expect(canAccess(glv, { ...cls, catechistIds: [] }, "read")).toBe(false);
  });
});

describe("canManageGrade", () => {
  it("only the head of that grade", () => {
    expect(canManageGrade(head, "g1")).toBe(true);
    expect(canManageGrade(head, "g2")).toBe(false);
    expect(canManageGrade(glv, "g1")).toBe(false);
  });
});
```

`src/server/guard.test.ts`

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { classCatechists } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { guardClass } from "./guard";

describe("guardClass", () => {
  it("returns the class for an assigned catechist", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    expect((await guardClass(db, b.glv, b.classId, "write"))?.id).toBe(b.classId);
  });

  it("returns null for another grade's class (no existence leak)", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    expect(await guardClass(db, b.glv, b.otherClassId, "read")).toBeNull();
  });

  it("returns null for unknown or malformed ids", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    expect(await guardClass(db, b.glv, "00000000-0000-4000-8000-000000000000", "read")).toBeNull();
    expect(await guardClass(db, b.glv, "not-a-uuid", "read")).toBeNull();
  });

  it("denies immediately after the catechist is removed from the class", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    await db.delete(classCatechists).where(eq(classCatechists.userId, b.glv.id));
    expect(await guardClass(db, b.glv, b.classId, "read")).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy để thấy lỗi**

Run: `pnpm test src/lib/access src/server/guard.test.ts`
Expected: FAIL — thiếu module.

- [ ] **Step 3: Cài đặt** — `src/lib/access/can-access.ts`

```ts
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
```

`src/db/queries/access.ts`

```ts
import { eq } from "drizzle-orm";
import type { AccessClass } from "@/lib/access/can-access";
import { classCatechists, classes } from "../schema";
import type { Db } from "../types";

export async function getAccessClass(db: Db, classId: string): Promise<AccessClass | null> {
  const [cls] = await db.select().from(classes).where(eq(classes.id, classId));
  if (!cls) return null;
  const rows = await db
    .select({ userId: classCatechists.userId })
    .from(classCatechists)
    .where(eq(classCatechists.classId, classId));
  return { id: cls.id, gradeId: cls.gradeId, catechistIds: rows.map((r) => r.userId) };
}
```

`src/server/result.ts`

```ts
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
export const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
```

`src/server/guard.ts`

```ts
import { z } from "zod";
import { getAccessClass } from "@/db/queries/access";
import type { Db } from "@/db/types";
import { canAccess, type AccessAction, type AccessClass, type AppUser } from "@/lib/access/can-access";

export const NOT_FOUND = "Không tìm thấy lớp";

/** Trả null cả khi lớp không tồn tại lẫn khi không đủ quyền, để không lộ lớp nào có thật. */
export async function guardClass(
  db: Db,
  user: AppUser,
  classId: string,
  action: AccessAction,
): Promise<AccessClass | null> {
  if (!z.uuid().safeParse(classId).success) return null;
  const cls = await getAccessClass(db, classId);
  return cls && canAccess(user, cls, action) ? cls : null;
}
```

- [ ] **Step 4: Chạy test**

Run: `pnpm test src/lib/access src/server/guard.test.ts`
Expected: PASS (11 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/access src/db/queries/access.ts src/server
git commit -m "feat: add class access control with canAccess and guardClass"
```

---

### Task 5: Đăng nhập, DAL, proxy, seed, trang tài khoản

**Files:**
- Create: `src/lib/auth/rate-limit.ts`, `src/lib/auth/rate-limit.test.ts`, `src/lib/auth/authenticate.ts`, `src/lib/auth/authenticate.test.ts`, `src/lib/auth/dal.ts`, `src/db/client.ts`, `src/proxy.ts`, `src/app/login/page.tsx`, `src/app/login/actions.ts`, `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`, `src/app/(app)/tai-khoan/page.tsx`, `src/components/nav/BottomNav.tsx`, `scripts/seed.ts`
- Delete: `src/app/page.tsx`
- Modify: `package.json` (script `seed`)

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword`, `DUMMY_HASH`, `encryptSession`, `decryptSession`, `AppUser`, `loginAttempts`, `users`.
- Produces:
  - `isLockedOut(attempts: readonly Date[], now: Date, max?: number, windowMs?: number): boolean` (mặc định 5 lần / 15 phút)
  - `authenticate(db, input: { email: string; password: string }, now?: Date): Promise<{ ok: true; userId: string } | { ok: false; reason: "invalid" | "locked" }>`
  - `db` (postgres-js, `src/db/client.ts`)
  - `getCurrentUser(): Promise<AppUser | null>`, `requireUser(): Promise<AppUser>`, `createSession(userId)`, `deleteSession()`

**Điều kiện cần:** tạo DB Postgres hosted (Neon/Supabase), đặt `DATABASE_URL` và `AUTH_SECRET` (`openssl rand -base64 32`) vào `.env.local`, rồi `pnpm drizzle-kit migrate`. Các bước 1–6 không cần DB ngoài.

- [ ] **Step 1: Viết test** — `src/lib/auth/rate-limit.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { isLockedOut } from "./rate-limit";

const now = new Date("2026-10-11T10:00:00Z");
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("isLockedOut", () => {
  it("is false below the limit", () => {
    expect(isLockedOut([minsAgo(1), minsAgo(2), minsAgo(3), minsAgo(4)], now)).toBe(false);
  });
  it("is true at the limit within the window", () => {
    expect(isLockedOut([1, 2, 3, 4, 5].map(minsAgo), now)).toBe(true);
  });
  it("ignores attempts outside the window", () => {
    expect(isLockedOut([1, 2, 3, 4, 20].map(minsAgo), now)).toBe(false);
  });
});
```

`src/lib/auth/authenticate.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { loginAttempts, users } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { authenticate } from "./authenticate";
import { hashPassword } from "./password";

const GOOD_PW = "correct-horse-1";

async function setup() {
  const db = await createTestDb();
  const [user] = await db
    .insert(users)
    .values({ email: "glv@x.vn", name: "GLV", passwordHash: await hashPassword(GOOD_PW) })
    .returning();
  return { db, user };
}
const now = new Date("2026-10-11T10:00:00Z");

describe("authenticate", () => {
  it("accepts correct credentials, ignoring email case and spaces", async () => {
    const { db, user } = await setup();
    const r = await authenticate(db, { email: "  GLV@x.vn ", password: GOOD_PW }, now);
    expect(r).toEqual({ ok: true, userId: user.id });
  });

  it("rejects a wrong password and records the attempt", async () => {
    const { db } = await setup();
    expect(await authenticate(db, { email: "glv@x.vn", password: "nope" }, now)).toEqual({ ok: false, reason: "invalid" });
    expect(await db.select().from(loginAttempts)).toHaveLength(1);
  });

  it("rejects an unknown email the same way", async () => {
    const { db } = await setup();
    expect(await authenticate(db, { email: "ghost@x.vn", password: "x" }, now)).toEqual({ ok: false, reason: "invalid" });
  });

  it("locks after 5 failures even with the right password", async () => {
    const { db } = await setup();
    for (let i = 0; i < 5; i++) await authenticate(db, { email: "glv@x.vn", password: "bad" }, now);
    expect(await authenticate(db, { email: "glv@x.vn", password: GOOD_PW }, now)).toEqual({ ok: false, reason: "locked" });
  });

  it("unlocks once the window has passed", async () => {
    const { db } = await setup();
    for (let i = 0; i < 5; i++) await authenticate(db, { email: "glv@x.vn", password: "bad" }, now);
    const later = new Date(now.getTime() + 16 * 60_000);
    expect((await authenticate(db, { email: "glv@x.vn", password: GOOD_PW }, later)).ok).toBe(true);
  });

  it("clears failed attempts after a successful login", async () => {
    const { db } = await setup();
    await authenticate(db, { email: "glv@x.vn", password: "bad" }, now);
    await authenticate(db, { email: "glv@x.vn", password: GOOD_PW }, now);
    expect(await db.select().from(loginAttempts)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Chạy để thấy lỗi**

Run: `pnpm test src/lib/auth`
Expected: FAIL — thiếu `rate-limit` và `authenticate`.

- [ ] **Step 3: Cài đặt** — `src/lib/auth/rate-limit.ts`

```ts
export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60_000;

export function isLockedOut(
  attempts: readonly Date[],
  now: Date,
  max: number = MAX_ATTEMPTS,
  windowMs: number = WINDOW_MS,
): boolean {
  const since = now.getTime() - windowMs;
  return attempts.filter((a) => a.getTime() > since).length >= max;
}
```

`src/lib/auth/authenticate.ts`

```ts
import { and, eq, gt } from "drizzle-orm";
import { loginAttempts, users } from "@/db/schema";
import type { Db } from "@/db/types";
import { DUMMY_HASH, verifyPassword } from "./password";
import { WINDOW_MS, isLockedOut } from "./rate-limit";

export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "locked" };

export async function authenticate(
  db: Db,
  input: { email: string; password: string },
  now: Date = new Date(),
): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const recent = await db
    .select({ at: loginAttempts.attemptedAt })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), gt(loginAttempts.attemptedAt, new Date(now.getTime() - WINDOW_MS))));
  if (isLockedOut(recent.map((r) => r.at), now)) return { ok: false, reason: "locked" };

  const [user] = await db.select().from(users).where(eq(users.email, email));
  const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) {
    await db.insert(loginAttempts).values({ email, attemptedAt: now });
    return { ok: false, reason: "invalid" };
  }
  await db.delete(loginAttempts).where(eq(loginAttempts.email, email));
  return { ok: true, userId: user.id };
}
```

- [ ] **Step 4: Chạy test**

Run: `pnpm test src/lib/auth`
Expected: PASS (17 test gồm cả Task 3).

- [ ] **Step 5: Tạo `src/db/client.ts`**

```ts
import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import type { Db } from "./types";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Thiếu biến môi trường DATABASE_URL");

const globalForSql = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };
const sql = globalForSql.__sql ?? postgres(url, { max: 5 });
if (process.env.NODE_ENV !== "production") globalForSql.__sql = sql;

export const db: Db = drizzle(sql, { schema });
```

- [ ] **Step 6: Tạo `src/lib/auth/dal.ts`**

```ts
import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import type { AppUser } from "@/lib/access/can-access";
import { decryptSession, encryptSession } from "./session";

export const SESSION_COOKIE = "session";
const MAX_AGE = 7 * 24 * 60 * 60;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET phải có ít nhất 32 ký tự");
  return s;
}

export async function createSession(userId: string): Promise<void> {
  const token = await encryptSession({ userId }, secret());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function deleteSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Đọc lại user từ DB ở mỗi request: đổi quyền/xóa tài khoản có hiệu lực ngay. */
export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  const session = await decryptSession((await cookies()).get(SESSION_COOKIE)?.value, secret());
  if (!session) return null;
  const [row] = await db.select().from(users).where(eq(users.id, session.userId));
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, isGradeHead: row.isGradeHead, gradeId: row.gradeId };
});

export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
```

- [ ] **Step 7: Tạo `src/proxy.ts`** (kiểm tra lạc quan; quyền thật nằm ở DAL/guard)

```ts
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has("session");
  const isLogin = request.nextUrl.pathname === "/login";
  if (!hasSession && !isLogin) return NextResponse.redirect(new URL("/login", request.url));
  if (hasSession && isLogin) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon-.*|apple-icon.*).*)"],
};
```

- [ ] **Step 8: Trang đăng nhập** — `src/app/login/actions.ts`

```ts
"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { authenticate } from "@/lib/auth/authenticate";
import { createSession } from "@/lib/auth/dal";

const schema = z.object({
  email: z.email("Email không hợp lệ"),
  password: z.string().min(1, "Nhập mật khẩu"),
});

export async function login(_prev: { error?: string } | undefined, formData: FormData) {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const result = await authenticate(db, parsed.data);
  if (!result.ok) {
    return {
      error:
        result.reason === "locked"
          ? "Đăng nhập sai quá nhiều lần. Thử lại sau 15 phút."
          : "Email hoặc mật khẩu không đúng",
    };
  }
  await createSession(result.userId);
  redirect("/");
}
```

`src/app/login/page.tsx`

```tsx
"use client";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold text-brand">Điểm danh Giáo lý</h1>
      <p className="mt-1 text-ink-soft">Đăng nhập để mở lớp của bạn</p>
      <form action={action} className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Email
          <input name="email" type="email" autoComplete="username" required
            className="h-12 rounded-xl border border-line bg-card px-4 text-base" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Mật khẩu
          <input name="password" type="password" autoComplete="current-password" required
            className="h-12 rounded-xl border border-line bg-card px-4 text-base" />
        </label>
        {state?.error && <p role="alert" className="text-sm text-warn-alert">{state.error}</p>}
        <button disabled={pending}
          className="h-12 rounded-xl bg-brand font-semibold text-white disabled:opacity-60">
          {pending ? "Đang đăng nhập…" : "Đăng nhập"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 9: Khung ứng dụng** — xóa `src/app/page.tsx`, tạo `src/components/nav/BottomNav.tsx`

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Lớp của tôi" },
  { href: "/can-chu-y", label: "Cần chú ý" },
  { href: "/khoi", label: "Khối", headOnly: true },
  { href: "/tai-khoan", label: "Tài khoản" },
];

export function BottomNav({ isGradeHead }: { isGradeHead: boolean }) {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-3xl">
        {ITEMS.filter((i) => !i.headOnly || isGradeHead).map((i) => {
          const active = i.href === "/" ? path === "/" || path.startsWith("/lop") : path.startsWith(i.href);
          return (
            <li key={i.href} className="flex-1">
              <Link href={i.href} aria-current={active ? "page" : undefined}
                className={`flex h-14 items-center justify-center text-sm font-medium ${active ? "text-brand" : "text-ink-soft"}`}>
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

`src/app/(app)/layout.tsx`

```tsx
import { BottomNav } from "@/components/nav/BottomNav";
import { requireUser } from "@/lib/auth/dal";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col">
      <main className="flex-1 px-4 pb-24 pt-6">{children}</main>
      <BottomNav isGradeHead={user.isGradeHead} />
    </div>
  );
}
```

`src/app/(app)/page.tsx` (tạm thời, Task 6 sẽ thay)

```tsx
import { requireUser } from "@/lib/auth/dal";

export default async function HomePage() {
  const user = await requireUser();
  return <h1 className="text-2xl font-semibold">Xin chào, {user.name}</h1>;
}
```

`src/app/(app)/tai-khoan/page.tsx`

```tsx
import { redirect } from "next/navigation";
import { deleteSession, requireUser } from "@/lib/auth/dal";

export default async function AccountPage() {
  const user = await requireUser();
  async function logout() {
    "use server";
    await deleteSession();
    redirect("/login");
  }
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Tài khoản</h1>
      <p>{user.name}<br /><span className="text-ink-soft">{user.email}</span></p>
      {user.isGradeHead && <p className="text-sm text-brand">Trưởng khối</p>}
      <form action={logout}>
        <button className="h-12 w-full rounded-xl border border-line bg-card font-medium">Đăng xuất</button>
      </form>
    </section>
  );
}
```

- [ ] **Step 10: Script seed** — `scripts/seed.ts` (tự tạo client, không import `server-only`)

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { hashPassword } from "../src/lib/auth/password";
import * as schema from "../src/db/schema";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Thiếu biến ${k}`);
  return v;
};

async function main() {
  const email = need("SEED_EMAIL").trim().toLowerCase();
  const password = need("SEED_PASSWORD");
  if (password.length < 10) throw new Error("SEED_PASSWORD phải có ít nhất 10 ký tự");
  const sql = postgres(need("DATABASE_URL"), { max: 1 });
  const db = drizzle(sql, { schema });

  const [grade] = await db.insert(schema.grades)
    .values({ name: process.env.SEED_GRADE ?? "Khối 1" })
    .onConflictDoUpdate({ target: schema.grades.name, set: { name: process.env.SEED_GRADE ?? "Khối 1" } })
    .returning();
  await db.insert(schema.users).values({
    email, name: process.env.SEED_NAME ?? "Trưởng khối", passwordHash: await hashPassword(password),
    isGradeHead: true, gradeId: grade.id,
  }).onConflictDoNothing();

  const yearName = process.env.SEED_YEAR ?? "2026-2027";
  const [year] = await db.insert(schema.schoolYears).values({ name: yearName }).returning();
  await db.insert(schema.terms).values([
    { schoolYearId: year.id, name: "Học kỳ 1", startsOn: process.env.SEED_T1_START ?? "2026-09-01", endsOn: process.env.SEED_T1_END ?? "2027-01-15" },
    { schoolYearId: year.id, name: "Học kỳ 2", startsOn: process.env.SEED_T2_START ?? "2027-01-16", endsOn: process.env.SEED_T2_END ?? "2027-05-31" },
  ]);
  await sql.end();
  console.log(`Đã tạo trưởng khối ${email} cho ${grade.name}, năm học ${yearName}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Thêm vào `package.json` scripts: `"seed": "node --env-file=.env.local --import tsx scripts/seed.ts"`, `"db:migrate": "node --env-file=.env.local node_modules/drizzle-kit/bin.cjs migrate"`.

- [ ] **Step 11: Chạy kiểm tra thủ công** (cần `.env.local`)

```bash
pnpm db:migrate
read -rs SEED_PASSWORD && export SEED_PASSWORD   # nhập mật khẩu, không lưu vào lịch sử shell
SEED_EMAIL=ban@example.com pnpm seed
pnpm dev
```

Expected: `/` chuyển sang `/login`; đăng nhập đúng vào thấy "Xin chào, Trưởng khối"; sai mật khẩu 5 lần báo khóa 15 phút; `/tai-khoan` đăng xuất được.

- [ ] **Step 12: Cổng chất lượng Mốc 1**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint`
Expected: tất cả pass. Sau đó chạy agent **code-reviewer** và **security-reviewer** trên diff của Mốc 1 (auth, session, proxy, guard); sửa mọi CRITICAL/HIGH trước khi commit.

- [ ] **Step 13: Commit**

```bash
git add src scripts package.json
git commit -m "feat: add login, session DAL, proxy, seed script and app shell"
```

---

## Mốc 2 — Lớp, thiếu nhi, import CSV

### Task 6: Dịch vụ thiếu nhi + quản lý lớp/tài khoản + màn hình

**Files:**
- Create: `src/lib/validation.ts`, `src/lib/students/schema.ts`, `src/lib/students/short-name.ts`, `src/lib/students/short-name.test.ts`, `src/db/queries/classes.ts`, `src/db/queries/students.ts`, `src/server/form-state.ts`, `src/server/services/students.ts`, `src/server/services/students.test.ts`, `src/server/services/admin.ts`, `src/server/services/admin.test.ts`, `src/app/(app)/lop/[classId]/layout.tsx`, `src/components/nav/ClassTabs.tsx`, `src/app/(app)/lop/[classId]/thieu-nhi/page.tsx`, `src/app/(app)/lop/[classId]/thieu-nhi/actions.ts`, `src/app/(app)/lop/[classId]/thieu-nhi/StudentForm.tsx`, `src/app/(app)/khoi/page.tsx`, `src/app/(app)/khoi/actions.ts`, `src/components/forms/SimpleForm.tsx`
- Modify: `src/server/guard.ts` (thêm `classPermissions`), `src/server/guard.test.ts`, `src/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `guardClass`, `NOT_FOUND`, `ActionResult/ok/fail`, `canManageGrade`, `getAccessClass`, `hashPassword`, các bảng.
- Produces:
  - `optionalText(max)`, `optionalDate`, `optionalPhone` (zod, `src/lib/validation.ts`)
  - `studentFields` zod object `{ fullName, saintName?, birthDate?, parentPhone?, note? }`; `type StudentFields = z.output<typeof studentFields>` (`src/lib/students/schema.ts`)
  - `shortName(fullName: string): string` — từ cuối của họ tên, `"?"` nếu rỗng
  - `classPermissions(db, user, classId): Promise<{ canRead: boolean; canWrite: boolean }>`
  - `listClassesForUser(db, user): Promise<{ id; name; gradeId; studentCount: number; canWrite: boolean }[]>`; `getClassById(db, id): Promise<{ id; name; gradeId } | null>`
  - `listStudents(db, classId, includeInactive?: boolean)` → các dòng `students` sắp theo `fullName`
  - services (tất cả `(db: Db, user: AppUser, input: unknown) => Promise<ActionResult<…>>`): `addStudent → {id}`, `updateStudent → undefined`, `setStudentActive → undefined`, `createClass → {id}`, `createCatechist → {id}`, `assignCatechist`, `unassignCatechist`, `resetPassword` → `undefined`
  - `FormState = { error?: string; ok?: boolean } | undefined`, `toFormState(r)`

- [ ] **Step 1: Viết test lỗi** — `src/server/services/students.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { students } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { addStudent, setStudentActive, updateStudent } from "./students";

async function setup() {
  const db = await createTestDb();
  return { db, b: await seedBasics(db) };
}

describe("addStudent", () => {
  it("adds a student for an assigned catechist", async () => {
    const { db, b } = await setup();
    const r = await addStudent(db, b.glv, { classId: b.classId, fullName: "  Nguyễn Văn An ", saintName: "Phêrô", parentPhone: "0901 234 567" });
    expect(r.ok).toBe(true);
    const [row] = await db.select().from(students);
    expect(row).toMatchObject({ fullName: "Nguyễn Văn An", saintName: "Phêrô", active: true });
  });

  it("treats empty optional fields as null", async () => {
    const { db, b } = await setup();
    await addStudent(db, b.glv, { classId: b.classId, fullName: "An", saintName: "", birthDate: "", parentPhone: "", note: "" });
    const [row] = await db.select().from(students);
    expect(row).toMatchObject({ saintName: null, birthDate: null, parentPhone: null, note: null });
  });

  it("rejects a missing name with a Vietnamese message", async () => {
    const { db, b } = await setup();
    expect(await addStudent(db, b.glv, { classId: b.classId, fullName: "  " })).toEqual({ ok: false, error: "Nhập họ tên" });
  });

  it("rejects an invalid phone or date", async () => {
    const { db, b } = await setup();
    expect((await addStudent(db, b.glv, { classId: b.classId, fullName: "An", parentPhone: "abc" })).ok).toBe(false);
    expect((await addStudent(db, b.glv, { classId: b.classId, fullName: "An", birthDate: "31/02/2015" })).ok).toBe(false);
  });

  it("is forbidden for a catechist of another class and for a read-only grade head", async () => {
    const { db, b } = await setup();
    expect((await addStudent(db, b.otherGlv, { classId: b.classId, fullName: "An" })).ok).toBe(false);
    expect((await addStudent(db, b.head, { classId: b.classId, fullName: "An" })).ok).toBe(false);
    expect(await db.select().from(students)).toHaveLength(0);
  });
});

describe("updateStudent / setStudentActive", () => {
  it("updates fields and hides a student without deleting", async () => {
    const { db, b } = await setup();
    const added = await addStudent(db, b.glv, { classId: b.classId, fullName: "An", saintName: "Phêrô" });
    if (!added.ok) throw new Error("setup");
    expect((await updateStudent(db, b.glv, { studentId: added.data.id, fullName: "An Nguyễn", saintName: "" })).ok).toBe(true);
    expect((await setStudentActive(db, b.glv, { studentId: added.data.id, active: false })).ok).toBe(true);
    const [row] = await db.select().from(students);
    expect(row).toMatchObject({ fullName: "An Nguyễn", saintName: null, active: false }); // trường để trống được xóa
  });

  it("cannot touch a student of a class the user cannot write", async () => {
    const { db, b } = await setup();
    const added = await addStudent(db, b.glv, { classId: b.classId, fullName: "An" });
    if (!added.ok) throw new Error("setup");
    expect((await setStudentActive(db, b.otherGlv, { studentId: added.data.id, active: false })).ok).toBe(false);
    expect((await updateStudent(db, b.otherGlv, { studentId: "not-a-uuid", fullName: "X" })).ok).toBe(false);
  });
});

`src/server/services/admin.test.ts`

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { classCatechists, classes, users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { assignCatechist, createCatechist, createClass, resetPassword, unassignCatechist } from "./admin";

const VALID_PW = "mat-khau-dai-1";
const RESET_PW = "mat-khau-moi-123";

async function setup() {
  const db = await createTestDb();
  return { db, b: await seedBasics(db) };
}

describe("createClass", () => {
  it("lets the grade head create a class in their grade", async () => {
    const { db, b } = await setup();
    const r = await createClass(db, b.head, { name: "Lớp C" });
    expect(r.ok).toBe(true);
    const rows = await db.select().from(classes).where(eq(classes.gradeId, b.gradeId));
    expect(rows.map((c) => c.name)).toContain("Lớp C");
  });

  it("rejects a plain catechist and duplicate names", async () => {
    const { db, b } = await setup();
    expect((await createClass(db, b.glv, { name: "Lớp C" })).ok).toBe(false);
    expect((await createClass(db, b.head, { name: "Lớp A" })).ok).toBe(false);
  });
});

describe("createCatechist", () => {
  it("creates an account in the head's grade with a hashed password", async () => {
    const { db, b } = await setup();
    const r = await createCatechist(db, b.head, { name: "Cô Lan", email: "Lan@X.vn", password: VALID_PW });
    expect(r.ok).toBe(true);
    const [row] = await db.select().from(users).where(eq(users.email, "lan@x.vn"));
    expect(row).toMatchObject({ gradeId: b.gradeId, isGradeHead: false });
    expect(await verifyPassword(VALID_PW, row.passwordHash)).toBe(true);
  });

  it("rejects short passwords, duplicate emails and non-heads", async () => {
    const { db, b } = await setup();
    expect((await createCatechist(db, b.head, { name: "L", email: "l@x.vn", password: "short" })).ok).toBe(false);
    expect((await createCatechist(db, b.head, { name: "L", email: "glv@x.vn", password: VALID_PW })).ok).toBe(false);
    expect((await createCatechist(db, b.glv, { name: "L", email: "l@x.vn", password: VALID_PW })).ok).toBe(false);
  });
});

describe("assign / unassign / resetPassword", () => {
  it("assigns a catechist of the same grade and then removes them", async () => {
    const { db, b } = await setup();
    const created = await createCatechist(db, b.head, { name: "Lan", email: "lan@x.vn", password: VALID_PW });
    if (!created.ok) throw new Error("setup");
    expect((await assignCatechist(db, b.head, { classId: b.classId, userId: created.data.id })).ok).toBe(true);
    expect((await assignCatechist(db, b.head, { classId: b.classId, userId: created.data.id })).ok).toBe(true); // idempotent
    expect(await db.select().from(classCatechists).where(eq(classCatechists.userId, created.data.id))).toHaveLength(1);
    expect((await unassignCatechist(db, b.head, { classId: b.classId, userId: created.data.id })).ok).toBe(true);
    expect(await db.select().from(classCatechists).where(eq(classCatechists.userId, created.data.id))).toHaveLength(0);
  });

  it("refuses cross-grade assignment and non-head callers", async () => {
    const { db, b } = await setup();
    expect((await assignCatechist(db, b.head, { classId: b.classId, userId: b.otherGlv.id })).ok).toBe(false);
    expect((await assignCatechist(db, b.head, { classId: b.otherClassId, userId: b.glv.id })).ok).toBe(false);
    expect((await assignCatechist(db, b.glv, { classId: b.classId, userId: b.glv.id })).ok).toBe(false);
  });

  it("lets the grade head assign themselves to a class to gain write access", async () => {
    const { db, b } = await setup();
    expect((await assignCatechist(db, b.head, { classId: b.classId, userId: b.head.id })).ok).toBe(true);
    expect(await db.select().from(classCatechists).where(eq(classCatechists.userId, b.head.id))).toHaveLength(1);
  });

  it("resets a catechist's password but not another grade's", async () => {
    const { db, b } = await setup();
    expect((await resetPassword(db, b.head, { userId: b.glv.id, password: RESET_PW })).ok).toBe(true);
    const [row] = await db.select().from(users).where(eq(users.id, b.glv.id));
    expect(await verifyPassword(RESET_PW, row.passwordHash)).toBe(true);
    expect((await resetPassword(db, b.head, { userId: b.otherGlv.id, password: RESET_PW })).ok).toBe(false);
  });
});
```

`src/lib/students/short-name.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { shortName } from "./short-name";

describe("shortName", () => {
  it("uses the given name (last word)", () => expect(shortName("Nguyễn Văn An")).toBe("An"));
  it("handles one word and extra spaces", () => {
    expect(shortName("An")).toBe("An");
    expect(shortName("  Trần  Bình ")).toBe("Bình");
  });
  it("falls back to ? for empty input", () => expect(shortName("   ")).toBe("?"));
});
```

Thêm vào `src/server/guard.test.ts`:

```ts
import { classPermissions } from "./guard";

describe("classPermissions", () => {
  it("gives a head read-only access and an assigned catechist full access", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    expect(await classPermissions(db, b.head, b.classId)).toEqual({ canRead: true, canWrite: false });
    expect(await classPermissions(db, b.glv, b.classId)).toEqual({ canRead: true, canWrite: true });
    expect(await classPermissions(db, b.otherGlv, b.classId)).toEqual({ canRead: false, canWrite: false });
  });
});
```

- [ ] **Step 2: Chạy để thấy lỗi**

Run: `pnpm test src/server src/lib/students`
Expected: FAIL — thiếu module `students`, `admin`, `short-name`, `classPermissions`.

- [ ] **Step 3: Cài đặt validation** — `src/lib/validation.ts`

```ts
import { z } from "zod";

const blankToUndefined = <T>(v: T | "" | undefined): T | undefined => (v === "" ? undefined : v);

export const optionalText = (max: number) =>
  z.string().trim().max(max, `Tối đa ${max} ký tự`).optional().transform(blankToUndefined);

export const optionalDate = z
  .union([z.literal(""), z.iso.date("Ngày sinh không hợp lệ")])
  .optional()
  .transform(blankToUndefined);

export const optionalPhone = z
  .union([z.literal(""), z.string().trim().regex(/^[0-9 +().-]{6,20}$/, "SĐT không hợp lệ")])
  .optional()
  .transform(blankToUndefined);
```

`src/lib/students/schema.ts`

```ts
import { z } from "zod";
import { optionalDate, optionalPhone, optionalText } from "@/lib/validation";

export const studentFields = z.object({
  fullName: z.string().trim().min(1, "Nhập họ tên").max(120, "Họ tên quá dài"),
  saintName: optionalText(60),
  birthDate: optionalDate,
  parentPhone: optionalPhone,
  note: optionalText(500),
});
export type StudentFields = z.output<typeof studentFields>;
```

`src/lib/students/short-name.ts`

```ts
export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "?";
}
```

- [ ] **Step 4: Cài đặt truy vấn và guard**

Thêm vào `src/server/guard.ts`:

```ts
export async function classPermissions(
  db: Db,
  user: AppUser,
  classId: string,
): Promise<{ canRead: boolean; canWrite: boolean }> {
  if (!z.uuid().safeParse(classId).success) return { canRead: false, canWrite: false };
  const cls = await getAccessClass(db, classId);
  if (!cls) return { canRead: false, canWrite: false };
  return { canRead: canAccess(user, cls, "read"), canWrite: canAccess(user, cls, "write") };
}
```

`src/db/queries/classes.ts`

```ts
import { and, count, eq, inArray, or } from "drizzle-orm";
import type { AppUser } from "@/lib/access/can-access";
import { classCatechists, classes, students } from "../schema";
import type { Db } from "../types";

const assignedTo = (db: Db, userId: string) =>
  db.select({ id: classCatechists.classId }).from(classCatechists).where(eq(classCatechists.userId, userId));

export async function listClassesForUser(db: Db, user: AppUser) {
  const visible =
    user.isGradeHead && user.gradeId
      ? or(inArray(classes.id, assignedTo(db, user.id)), eq(classes.gradeId, user.gradeId))
      : inArray(classes.id, assignedTo(db, user.id));
  const rows = await db
    .select({ id: classes.id, name: classes.name, gradeId: classes.gradeId, studentCount: count(students.id) })
    .from(classes)
    .leftJoin(students, and(eq(students.classId, classes.id), eq(students.active, true)))
    .where(visible)
    .groupBy(classes.id)
    .orderBy(classes.name);
  const mine = new Set((await assignedTo(db, user.id)).map((r) => r.id));
  return rows.map((r) => ({ ...r, canWrite: mine.has(r.id) }));
}

export async function getClassById(db: Db, id: string) {
  const [row] = await db.select({ id: classes.id, name: classes.name, gradeId: classes.gradeId }).from(classes).where(eq(classes.id, id));
  return row ?? null;
}
```

`src/db/queries/students.ts`

```ts
import { and, asc, eq } from "drizzle-orm";
import { students } from "../schema";
import type { Db } from "../types";

export function listStudents(db: Db, classId: string, includeInactive = false) {
  const where = includeInactive ? eq(students.classId, classId) : and(eq(students.classId, classId), eq(students.active, true));
  return db.select().from(students).where(where).orderBy(asc(students.fullName));
}

export async function getStudent(db: Db, id: string) {
  const [row] = await db.select().from(students).where(eq(students.id, id));
  return row ?? null;
}
```

`src/server/form-state.ts`

```ts
import type { ActionResult } from "./result";

export type FormState = { error?: string; ok?: boolean } | undefined;

export function toFormState(result: ActionResult<unknown>): FormState {
  return result.ok ? { ok: true } : { error: result.error };
}
```

- [ ] **Step 5: Cài đặt services** — `src/server/services/students.ts`

```ts
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getStudent } from "@/db/queries/students";
import { students } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { studentFields } from "@/lib/students/schema";
import { NOT_FOUND, guardClass } from "../guard";
import { fail, ok, type ActionResult } from "../result";

const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Dữ liệu không hợp lệ";
const NOT_FOUND_STUDENT = "Không tìm thấy thiếu nhi";

export async function addStudent(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ id: string }>> {
  const p = studentFields.extend({ classId: z.string() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const { classId, ...fields } = p.data;
  if (!(await guardClass(db, user, classId, "write"))) return fail(NOT_FOUND);
  const [row] = await db.insert(students).values({ classId, ...fields }).returning({ id: students.id });
  return ok({ id: row.id });
}

async function loadWritable(db: Db, user: AppUser, studentId: string) {
  if (!z.uuid().safeParse(studentId).success) return null;
  const student = await getStudent(db, studentId);
  if (!student || !(await guardClass(db, user, student.classId, "write"))) return null;
  return student;
}

export async function updateStudent(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = studentFields.extend({ studentId: z.string() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const { studentId, ...fields } = p.data;
  if (!(await loadWritable(db, user, studentId))) return fail(NOT_FOUND_STUDENT);
  await db.update(students).set({
    fullName: fields.fullName,
    saintName: fields.saintName ?? null,
    birthDate: fields.birthDate ?? null,
    parentPhone: fields.parentPhone ?? null,
    note: fields.note ?? null,
  }).where(eq(students.id, studentId));
  return ok(undefined);
}

export async function setStudentActive(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = z.object({ studentId: z.string(), active: z.boolean() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  if (!(await loadWritable(db, user, p.data.studentId))) return fail(NOT_FOUND_STUDENT);
  await db.update(students).set({ active: p.data.active }).where(eq(students.id, p.data.studentId));
  return ok(undefined);
}
```

`src/server/services/admin.ts`

```ts
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getAccessClass } from "@/db/queries/access";
import { classCatechists, classes, users } from "@/db/schema";
import type { Db } from "@/db/types";
import { canManageGrade, type AppUser } from "@/lib/access/can-access";
import { hashPassword } from "@/lib/auth/password";
import { fail, ok, type ActionResult } from "../result";

const FORBIDDEN = "Bạn không có quyền thực hiện thao tác này";
const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Dữ liệu không hợp lệ";
const password = z.string().min(10, "Mật khẩu phải có ít nhất 10 ký tự").max(100);

const isHead = (user: AppUser): user is AppUser & { gradeId: string } => user.isGradeHead && !!user.gradeId;

export async function createClass(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ id: string }>> {
  const p = z.object({ name: z.string().trim().min(1, "Nhập tên lớp").max(60) }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  if (!isHead(user)) return fail(FORBIDDEN);
  const dup = await db.select({ id: classes.id }).from(classes).where(and(eq(classes.gradeId, user.gradeId), eq(classes.name, p.data.name)));
  if (dup.length > 0) return fail("Tên lớp đã tồn tại trong khối");
  const [row] = await db.insert(classes).values({ gradeId: user.gradeId, name: p.data.name }).returning({ id: classes.id });
  return ok({ id: row.id });
}

export async function createCatechist(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ id: string }>> {
  const p = z.object({
    name: z.string().trim().min(1, "Nhập họ tên").max(120),
    email: z.email("Email không hợp lệ").transform((e) => e.trim().toLowerCase()),
    password,
  }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  if (!isHead(user)) return fail(FORBIDDEN);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, p.data.email));
  if (existing) return fail("Email đã được dùng");
  try {
    const [row] = await db.insert(users).values({
      name: p.data.name, email: p.data.email, gradeId: user.gradeId, isGradeHead: false,
      passwordHash: await hashPassword(p.data.password),
    }).returning({ id: users.id });
    return ok({ id: row.id });
  } catch (error) {
    console.error("createCatechist failed", error);
    return fail("Không tạo được tài khoản");
  }
}

async function loadManaged(db: Db, user: AppUser, classId: string, userId: string) {
  if (!z.uuid().safeParse(classId).success || !z.uuid().safeParse(userId).success) return null;
  const cls = await getAccessClass(db, classId);
  if (!cls || !canManageGrade(user, cls.gradeId)) return null;
  const [target] = await db.select().from(users).where(eq(users.id, userId));
  return target && target.gradeId === cls.gradeId ? { cls, target } : null;
}

const assignInput = z.object({ classId: z.string(), userId: z.string() });

export async function assignCatechist(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = assignInput.safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  if (!(await loadManaged(db, user, p.data.classId, p.data.userId))) return fail(FORBIDDEN);
  await db.insert(classCatechists).values(p.data).onConflictDoNothing();
  return ok(undefined);
}

export async function unassignCatechist(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = assignInput.safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  if (!(await loadManaged(db, user, p.data.classId, p.data.userId))) return fail(FORBIDDEN);
  await db.delete(classCatechists).where(and(eq(classCatechists.classId, p.data.classId), eq(classCatechists.userId, p.data.userId)));
  return ok(undefined);
}

export async function resetPassword(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = z.object({ userId: z.string(), password }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  if (!isHead(user) || !z.uuid().safeParse(p.data.userId).success) return fail(FORBIDDEN);
  const [target] = await db.select().from(users).where(eq(users.id, p.data.userId));
  if (!target || target.gradeId !== user.gradeId || target.isGradeHead) return fail(FORBIDDEN);
  await db.update(users).set({ passwordHash: await hashPassword(p.data.password) }).where(eq(users.id, target.id));
  return ok(undefined);
}
```

- [ ] **Step 6: Chạy test**

Run: `pnpm test src/server src/lib/students`
Expected: PASS.

- [ ] **Step 7: Màn hình** — thay `src/app/(app)/page.tsx`

```tsx
import Link from "next/link";
import { db } from "@/db/client";
import { listClassesForUser } from "@/db/queries/classes";
import { requireUser } from "@/lib/auth/dal";

export default async function HomePage() {
  const user = await requireUser();
  const classes = await listClassesForUser(db, user);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Lớp của tôi</h1>
      {classes.length === 0 && <p className="text-ink-soft">Bạn chưa được gán lớp nào. Hãy nhờ trưởng khối gán lớp.</p>}
      <ul className="flex flex-col gap-3">
        {classes.map((c) => (
          <li key={c.id}>
            <Link href={`/lop/${c.id}`} className="flex min-h-16 items-center justify-between rounded-2xl border border-line bg-card p-4 shadow-sm">
              <span>
                <span className="block text-lg font-semibold">{c.name}</span>
                <span className="text-sm text-ink-soft">{c.studentCount} em{c.canWrite ? "" : " · chỉ xem"}</span>
              </span>
              <span aria-hidden className="text-brand">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`src/components/nav/ClassTabs.tsx`

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { slug: "", label: "Điểm danh" },
  { slug: "/thieu-nhi", label: "Thiếu nhi" },
  { slug: "/so-do", label: "Sơ đồ" },
  { slug: "/thong-ke", label: "Thống kê" },
];

export function ClassTabs({ classId }: { classId: string }) {
  const path = usePathname();
  const base = `/lop/${classId}`;
  return (
    <div role="tablist" className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4">
      {TABS.map((t) => {
        const href = base + t.slug;
        const active = t.slug === "" ? path === base || path.startsWith(`${base}/diem-danh`) : path.startsWith(href);
        return (
          <Link key={t.slug} href={href} role="tab" aria-selected={active}
            className={`flex h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium ${active ? "border-brand text-brand" : "border-transparent text-ink-soft"}`}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
```

`src/app/(app)/lop/[classId]/layout.tsx`

```tsx
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getClassById } from "@/db/queries/classes";
import { ClassTabs } from "@/components/nav/ClassTabs";
import { requireUser } from "@/lib/auth/dal";
import { guardClass } from "@/server/guard";

export default async function ClassLayout({ children, params }: { children: React.ReactNode; params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const user = await requireUser();
  if (!(await guardClass(db, user, classId, "read"))) notFound();
  const cls = await getClassById(db, classId);
  if (!cls) notFound();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{cls.name}</h1>
      <ClassTabs classId={classId} />
      {children}
    </div>
  );
}
```

`src/app/(app)/lop/[classId]/thieu-nhi/actions.ts`

```ts
"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { toFormState, type FormState } from "@/server/form-state";
import { addStudent, setStudentActive } from "@/server/services/students";

export async function addStudentAction(classId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await addStudent(db, user, { ...Object.fromEntries(formData), classId });
  if (result.ok) revalidatePath(`/lop/${classId}/thieu-nhi`);
  return toFormState(result);
}

export async function setStudentActiveAction(classId: string, studentId: string, active: boolean) {
  const user = await requireUser();
  const result = await setStudentActive(db, user, { studentId, active });
  if (result.ok) revalidatePath(`/lop/${classId}/thieu-nhi`);
  return result;
}
```

`src/app/(app)/lop/[classId]/thieu-nhi/StudentForm.tsx`

```tsx
"use client";
import { useActionState, useRef } from "react";
import type { FormState } from "@/server/form-state";
import { addStudentAction } from "./actions";

const input = "h-12 rounded-xl border border-line bg-card px-4 text-base";

export function StudentForm({ classId }: { classId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const next = await addStudentAction(classId, prev, fd);
    if (next?.ok) ref.current?.reset();
    return next;
  }, undefined);
  return (
    <form ref={ref} action={action} className="grid gap-3 rounded-2xl border border-line bg-card p-4">
      <h2 className="font-semibold">Thêm thiếu nhi</h2>
      <input name="saintName" placeholder="Tên thánh" className={input} />
      <input name="fullName" placeholder="Họ và tên *" required className={input} />
      <input name="birthDate" type="date" aria-label="Ngày sinh" className={input} />
      <input name="parentPhone" inputMode="tel" placeholder="SĐT phụ huynh" className={input} />
      <input name="note" placeholder="Ghi chú" className={input} />
      {state?.error && <p role="alert" className="text-sm text-warn-alert">{state.error}</p>}
      <button disabled={pending} className="h-12 rounded-xl bg-brand font-semibold text-white disabled:opacity-60">Thêm</button>
    </form>
  );
}
```

`src/app/(app)/lop/[classId]/thieu-nhi/page.tsx`

```tsx
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { listStudents } from "@/db/queries/students";
import { requireUser } from "@/lib/auth/dal";
import { classPermissions } from "@/server/guard";
import { setStudentActiveAction } from "./actions";
import { StudentForm } from "./StudentForm";

export default async function StudentsPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const user = await requireUser();
  const perms = await classPermissions(db, user, classId);
  if (!perms.canRead) notFound();
  const list = await listStudents(db, classId, true);
  return (
    <section className="flex flex-col gap-4">
      {perms.canWrite && <StudentForm classId={classId} />}
      <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-card">
        {list.map((s) => (
          <li key={s.id} className={`flex min-h-14 items-center justify-between px-4 py-2 ${s.active ? "" : "opacity-50"}`}>
            <span>
              <span className="block font-medium">{s.saintName ? `${s.saintName} ` : ""}{s.fullName}</span>
              <span className="text-sm text-ink-soft">{[s.birthDate, s.parentPhone].filter(Boolean).join(" · ")}{s.active ? "" : " · đã ẩn"}</span>
            </span>
            {perms.canWrite && (
              <form action={async () => { "use server"; await setStudentActiveAction(classId, s.id, !s.active); }}>
                <button className="h-11 rounded-lg px-3 text-sm text-ink-soft">{s.active ? "Ẩn" : "Hiện"}</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`src/app/(app)/khoi/actions.ts`

```ts
"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { toFormState, type FormState } from "@/server/form-state";
import { assignCatechist, createCatechist, createClass, unassignCatechist } from "@/server/services/admin";
import type { AppUser } from "@/lib/access/can-access";
import type { ActionResult } from "@/server/result";
import type { Db } from "@/db/types";

type Service = (db: Db, user: AppUser, input: unknown) => Promise<ActionResult<unknown>>;

async function run(service: Service, formData: FormData): Promise<FormState> {
  const result = await service(db, await requireUser(), Object.fromEntries(formData));
  if (result.ok) revalidatePath("/khoi");
  return toFormState(result);
}

export async function createClassAction(_: FormState, fd: FormData) { return run(createClass, fd); }
export async function createCatechistAction(_: FormState, fd: FormData) { return run(createCatechist, fd); }
export async function assignAction(_: FormState, fd: FormData) { return run(assignCatechist, fd); }
export async function unassignAction(_: FormState, fd: FormData) { return run(unassignCatechist, fd); }
```

`src/components/forms/SimpleForm.tsx`

```tsx
"use client";
import { useActionState } from "react";
import type { FormState } from "@/server/form-state";

interface Field { name: string; label: string; type?: string; options?: { value: string; label: string }[] }

export function SimpleForm({ title, fields, action }: { title: string; fields: Field[]; action: (prev: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, run, pending] = useActionState(action, undefined);
  const cls = "h-12 rounded-xl border border-line bg-card px-4 text-base";
  return (
    <form action={run} className="grid gap-3 rounded-2xl border border-line bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      {fields.map((f) => f.options ? (
        <select key={f.name} name={f.name} aria-label={f.label} required className={cls}>
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input key={f.name} name={f.name} type={f.type ?? "text"} placeholder={f.label} aria-label={f.label} required className={cls} />
      ))}
      {state?.error && <p role="alert" className="text-sm text-warn-alert">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-brand">Đã lưu</p>}
      <button disabled={pending} className="h-12 rounded-xl bg-brand font-semibold text-white disabled:opacity-60">Lưu</button>
    </form>
  );
}
```

`src/app/(app)/khoi/page.tsx` (tổng quan khối bổ sung ở Task 12; ở đây chỉ có phần quản lý)

```tsx
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { listClassesForUser } from "@/db/queries/classes";
import { classCatechists, users } from "@/db/schema";
import { requireUser } from "@/lib/auth/dal";
import { assignAction, createCatechistAction, createClassAction, unassignAction } from "./actions";
import { SimpleForm } from "@/components/forms/SimpleForm";

export default async function GradePage() {
  const user = await requireUser();
  if (!user.isGradeHead || !user.gradeId) redirect("/");
  const [classList, catechists, links] = await Promise.all([
    listClassesForUser(db, user),
    db.select().from(users).where(eq(users.gradeId, user.gradeId)),
    db.select().from(classCatechists),
  ]);
  const classOptions = classList.map((c) => ({ value: c.id, label: c.name }));
  // Trưởng khối cũng nằm trong danh sách để tự gán mình vào lớp khi cần ghi điểm danh thay GLV.
  const glvOptions = catechists.map((u) => ({ value: u.id, label: u.name }));
  const namesOf = (classId: string) =>
    links.filter((l) => l.classId === classId).map((l) => catechists.find((u) => u.id === l.userId)?.name).filter(Boolean).join(", ");
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Khối</h1>
      <ul className="flex flex-col gap-2">
        {classList.map((c) => (
          <li key={c.id} className="rounded-2xl border border-line bg-card p-4">
            <span className="font-semibold">{c.name}</span>
            <span className="block text-sm text-ink-soft">{c.studentCount} em · GLV: {namesOf(c.id) || "chưa gán"}</span>
          </li>
        ))}
      </ul>
      <SimpleForm title="Tạo lớp" action={createClassAction} fields={[{ name: "name", label: "Tên lớp" }]} />
      <SimpleForm title="Tạo tài khoản GLV" action={createCatechistAction}
        fields={[{ name: "name", label: "Họ tên" }, { name: "email", label: "Email", type: "email" }, { name: "password", label: "Mật khẩu (≥ 10 ký tự)", type: "password" }]} />
      <SimpleForm title="Gán GLV vào lớp" action={assignAction}
        fields={[{ name: "classId", label: "Lớp", options: classOptions }, { name: "userId", label: "Giáo lý viên", options: glvOptions }]} />
      <SimpleForm title="Gỡ GLV khỏi lớp" action={unassignAction}
        fields={[{ name: "classId", label: "Lớp", options: classOptions }, { name: "userId", label: "Giáo lý viên", options: glvOptions }]} />
    </section>
  );
}
```

- [ ] **Step 8: Kiểm tra**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint`
Thủ công: đăng nhập bằng trưởng khối → `/khoi` tạo lớp, tạo GLV, gán; đăng nhập bằng GLV → thấy lớp, thêm/ẩn thiếu nhi; GLV mở URL lớp khác → 404.

- [ ] **Step 9: Commit**

```bash
git add src/lib src/db/queries src/server src/components src/app
git commit -m "feat: add students, class admin services and screens"
```

---

### Task 7: Import CSV thiếu nhi

**Files:**
- Create: `src/lib/import/csv.ts`, `src/lib/import/csv.test.ts`, `src/app/(app)/lop/[classId]/thieu-nhi/ImportCsv.tsx`
- Modify: `src/server/services/students.ts`, `src/server/services/students.test.ts`, `src/app/(app)/lop/[classId]/thieu-nhi/actions.ts`, `src/app/(app)/lop/[classId]/thieu-nhi/page.tsx`

**Interfaces:**
- Consumes: `studentFields`, `StudentFields`, `guardClass`.
- Produces:
  - `MAX_IMPORT_ROWS = 500`
  - `interface ImportError { line: number; message: string }` (`line` = số thứ tự dòng dữ liệu trong file, dòng tiêu đề là 1; `0` = lỗi toàn file)
  - `parseStudentsCsv(text: string): { rows: StudentFields[]; errors: ImportError[] }`
  - `importStudents(db, user, input: unknown): Promise<ActionResult<{ inserted: number; skipped: number }>>` với input `{ classId: string; rows: unknown[] }`

- [ ] **Step 1: Viết test lỗi** — `src/lib/import/csv.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ROWS, parseStudentsCsv } from "./csv";

const HEADER = "Tên thánh,Họ tên,Ngày sinh,SĐT phụ huynh,Ghi chú";

describe("parseStudentsCsv", () => {
  it("parses a basic file", () => {
    const { rows, errors } = parseStudentsCsv(`${HEADER}\nPhêrô,Nguyễn Văn An,2015-03-04,0901234567,hay nói chuyện`);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ saintName: "Phêrô", fullName: "Nguyễn Văn An", birthDate: "2015-03-04", parentPhone: "0901234567", note: "hay nói chuyện" }]);
  });

  it("handles an Excel export: BOM, semicolons and CRLF", () => {
    const text = "﻿Tên thánh;Họ tên;Ngày sinh\r\nMaria;Trần Thu;04/03/2015\r\n";
    const { rows, errors } = parseStudentsCsv(text);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ fullName: "Trần Thu", birthDate: "2015-03-04" });
  });

  it("keeps commas, quotes and newlines inside quoted fields", () => {
    const { rows } = parseStudentsCsv(`${HEADER}\n,"Lê, Văn ""Bi""",,,"dòng 1\ndòng 2"`);
    expect(rows[0].fullName).toBe('Lê, Văn "Bi"');
    expect(rows[0].note).toBe("dòng 1\ndòng 2");
  });

  it("normalises decomposed (NFD) Vietnamese to NFC, including headers", () => {
    const nfd = "Nguyễn Văn An".normalize("NFD");
    const header = "Họ tên".normalize("NFD");
    const { rows, errors } = parseStudentsCsv(`${header}\n${nfd}`);
    expect(errors).toEqual([]);
    expect(rows[0].fullName).toBe("Nguyễn Văn An".normalize("NFC"));
  });

  it("accepts English or unaccented headers in any order", () => {
    const { rows } = parseStudentsCsv("phone,full_name\n0901234567,An");
    expect(rows[0]).toMatchObject({ fullName: "An", parentPhone: "0901234567" });
  });

  it("skips blank lines", () => {
    const { rows, errors } = parseStudentsCsv(`${HEADER}\n\nPhêrô,An,,,\n,,,,\n`);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it("reports row errors with their line number and keeps valid rows", () => {
    const { rows, errors } = parseStudentsCsv(`${HEADER}\n,,2015-01-01,,\n,An,31/02/2015,,\n,Bình,,abc,\n,Chi,,,`);
    expect(rows.map((r) => r.fullName)).toEqual(["Chi"]);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(errors[0].message).toBe("Nhập họ tên");
  });

  it("flags duplicates within the file", () => {
    const { rows, errors } = parseStudentsCsv(`${HEADER}\n,An,2015-01-01,,\n,an,2015-01-01,,`);
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([{ line: 3, message: "Trùng với dòng 2" }]);
  });

  it("errors when the name column is missing", () => {
    expect(parseStudentsCsv("Ngày sinh\n2015-01-01").errors).toEqual([{ line: 1, message: "Thiếu cột Họ tên" }]);
  });

  it("errors on an empty file and on an unterminated quote", () => {
    expect(parseStudentsCsv("").errors[0].line).toBe(0);
    expect(parseStudentsCsv(`${HEADER}\n,"An,,,`).errors[0].message).toContain("nháy");
  });

  it("refuses files over the row limit", () => {
    const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `,Em ${i},,,`).join("\n");
    const { rows, errors } = parseStudentsCsv(`${HEADER}\n${body}`);
    expect(rows).toEqual([]);
    expect(errors[0].message).toContain(String(MAX_IMPORT_ROWS));
  });
});
```

Thêm vào `src/server/services/students.test.ts`:

```ts
import { importStudents } from "./students";

describe("importStudents", () => {
  it("inserts valid rows and skips students already in the class", async () => {
    const { db, b } = await setup();
    await addStudent(db, b.glv, { classId: b.classId, fullName: "An", birthDate: "2015-01-01" });
    const r = await importStudents(db, b.glv, {
      classId: b.classId,
      rows: [{ fullName: "An", birthDate: "2015-01-01" }, { fullName: "Bình" }, { fullName: "Chi", parentPhone: "0901234567" }],
    });
    expect(r).toEqual({ ok: true, data: { inserted: 2, skipped: 1 } });
    expect(await db.select().from(students)).toHaveLength(3);
  });

  it("re-validates rows on the server", async () => {
    const { db, b } = await setup();
    expect((await importStudents(db, b.glv, { classId: b.classId, rows: [{ fullName: "" }] })).ok).toBe(false);
    expect(await db.select().from(students)).toHaveLength(0);
  });

  it("rejects more than the row limit and unauthorised callers", async () => {
    const { db, b } = await setup();
    const many = Array.from({ length: 501 }, (_, i) => ({ fullName: `Em ${i}` }));
    expect((await importStudents(db, b.glv, { classId: b.classId, rows: many })).ok).toBe(false);
    expect((await importStudents(db, b.otherGlv, { classId: b.classId, rows: [{ fullName: "X" }] })).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy để thấy lỗi**

Run: `pnpm test src/lib/import src/server/services/students.test.ts`
Expected: FAIL — thiếu `csv` và `importStudents`.

- [ ] **Step 3: Cài đặt** — `src/lib/import/csv.ts`

```ts
import { studentFields, type StudentFields } from "@/lib/students/schema";

export const MAX_IMPORT_ROWS = 500;
export interface ImportError { line: number; message: string }

type Field = "fullName" | "saintName" | "birthDate" | "parentPhone" | "note";
const ALIASES: Record<string, Field> = {
  "ho ten": "fullName", "ho va ten": "fullName", ten: "fullName", fullname: "fullName", "full name": "fullName",
  "ten thanh": "saintName", saintname: "saintName", "saint name": "saintName",
  "ngay sinh": "birthDate", birthdate: "birthDate", "birth date": "birthDate",
  "sdt phu huynh": "parentPhone", sdt: "parentPhone", "so dien thoai": "parentPhone", phone: "parentPhone", "parent phone": "parentPhone",
  "ghi chu": "note", note: "note",
};

const normalizeHeader = (h: string) =>
  h.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/đ/g, "d").replace(/[_-]+/g, " ").trim();

function detectDelimiter(firstLine: string): string {
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

/** Tách CSV theo RFC 4180 (ngoặc kép, "" thoát, xuống dòng trong ô). Ném lỗi nếu dấu nháy không đóng. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(src.split(/\r?\n/, 1)[0] ?? "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (src[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (quoted) throw new Error("Dấu nháy kép không được đóng");
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function toIsoDate(value: string): string {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  if (!m) return value;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  const real = date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
  return real ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : "invalid";
}

export function parseStudentsCsv(text: string): { rows: StudentFields[]; errors: ImportError[] } {
  let records: string[][];
  try {
    records = parseCsv(text);
  } catch (e) {
    return { rows: [], errors: [{ line: 0, message: (e as Error).message }] };
  }
  if (!records.some((r) => r.some((c) => c.trim() !== ""))) return { rows: [], errors: [{ line: 0, message: "File trống" }] };

  const columns = records[0].map((h) => ALIASES[normalizeHeader(h)]);
  if (!columns.includes("fullName")) return { rows: [], errors: [{ line: 1, message: "Thiếu cột Họ tên" }] };
  const body = records.slice(1);
  if (body.length > MAX_IMPORT_ROWS) {
    return { rows: [], errors: [{ line: 0, message: `Tối đa ${MAX_IMPORT_ROWS} dòng mỗi lần nhập` }] };
  }

  const rows: StudentFields[] = [];
  const errors: ImportError[] = [];
  const seen = new Map<string, number>();
  body.forEach((cells, index) => {
    const line = index + 2;
    if (cells.every((c) => c.trim() === "")) return;
    const raw: Partial<Record<Field, string>> = {};
    columns.forEach((field, i) => { if (field) raw[field] = (cells[i] ?? "").normalize("NFC").trim(); });
    if (raw.birthDate) raw.birthDate = toIsoDate(raw.birthDate);
    const parsed = studentFields.safeParse(raw);
    if (!parsed.success) {
      errors.push({ line, message: raw.birthDate === "invalid" ? "Ngày sinh không hợp lệ" : parsed.error.issues[0].message });
      return;
    }
    const key = `${parsed.data.fullName.toLowerCase()}|${parsed.data.birthDate ?? ""}`;
    const first = seen.get(key);
    if (first) { errors.push({ line, message: `Trùng với dòng ${first}` }); return; }
    seen.set(key, line);
    rows.push(parsed.data);
  });
  return { rows, errors };
}
```

Thêm vào `src/server/services/students.ts`:

```ts
import { MAX_IMPORT_ROWS } from "@/lib/import/csv";

export async function importStudents(
  db: Db,
  user: AppUser,
  input: unknown,
): Promise<ActionResult<{ inserted: number; skipped: number }>> {
  const p = z.object({
    classId: z.string(),
    rows: z.array(studentFields).max(MAX_IMPORT_ROWS, `Tối đa ${MAX_IMPORT_ROWS} dòng mỗi lần nhập`),
  }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const { classId, rows } = p.data;
  if (!(await guardClass(db, user, classId, "write"))) return fail(NOT_FOUND);

  const key = (r: { fullName: string; birthDate?: string | null }) => `${r.fullName.toLowerCase()}|${r.birthDate ?? ""}`;
  const existing = new Set((await db.select().from(students).where(eq(students.classId, classId))).map(key));
  const fresh = rows.filter((r) => !existing.has(key(r)));
  if (fresh.length > 0) await db.insert(students).values(fresh.map((r) => ({ classId, ...r })));
  return ok({ inserted: fresh.length, skipped: rows.length - fresh.length });
}
```

- [ ] **Step 4: Chạy test**

Run: `pnpm test src/lib/import src/server/services/students.test.ts`
Expected: PASS.

- [ ] **Step 5: UI** — thêm vào `thieu-nhi/actions.ts`

```ts
import { importStudents } from "@/server/services/students";

export async function importStudentsAction(classId: string, rows: unknown[]) {
  const user = await requireUser();
  const result = await importStudents(db, user, { classId, rows });
  if (result.ok) revalidatePath(`/lop/${classId}/thieu-nhi`);
  return result;
}
```

`thieu-nhi/ImportCsv.tsx`

```tsx
"use client";
import { useState } from "react";
import { parseStudentsCsv, type ImportError } from "@/lib/import/csv";
import type { StudentFields } from "@/lib/students/schema";
import { importStudentsAction } from "./actions";

export function ImportCsv({ classId }: { classId: string }) {
  const [rows, setRows] = useState<StudentFields[]>([]);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    setMessage(undefined);
    if (!file) return;
    const parsed = parseStudentsCsv(await file.text());
    setRows(parsed.rows);
    setErrors(parsed.errors);
  }

  async function submit() {
    setBusy(true);
    const r = await importStudentsAction(classId, rows);
    setBusy(false);
    if (r.ok) { setMessage(`Đã nhập ${r.data.inserted} em${r.data.skipped ? `, bỏ qua ${r.data.skipped} em đã có` : ""}`); setRows([]); }
    else setMessage(r.error);
  }

  return (
    <div className="grid gap-3 rounded-2xl border border-line bg-card p-4">
      <h2 className="font-semibold">Nhập từ file CSV</h2>
      <p className="text-sm text-ink-soft">Cột: Tên thánh, Họ tên, Ngày sinh, SĐT phụ huynh, Ghi chú (Excel: Lưu thành CSV).</p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
      {errors.length > 0 && (
        <ul role="alert" className="text-sm text-warn-alert">
          {errors.map((e) => <li key={`${e.line}-${e.message}`}>{e.line ? `Dòng ${e.line}: ` : ""}{e.message}</li>)}
        </ul>
      )}
      {rows.length > 0 && (
        <button onClick={submit} disabled={busy} className="h-12 rounded-xl bg-brand font-semibold text-white disabled:opacity-60">
          Nhập {rows.length} em{errors.length ? " (bỏ qua dòng lỗi)" : ""}
        </button>
      )}
      {message && <p role="status" className="text-sm">{message}</p>}
    </div>
  );
}
```

Trong `thieu-nhi/page.tsx` thêm `import { ImportCsv } from "./ImportCsv";` và render `{perms.canWrite && <ImportCsv classId={classId} />}` ngay dưới `<StudentForm …/>`.

- [ ] **Step 6: Xác nhận đã gỡ dependency cũ**

Run: `grep xlsx package.json`
Expected: không có kết quả.

- [ ] **Step 7: Cổng chất lượng Mốc 2**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint`
Expected: pass. Thủ công: import file CSV có BOM/dấu `;` từ Excel; sai dòng nào báo đúng dòng đó. Chạy agent **code-reviewer** (và **security-reviewer** cho `admin.ts`); sửa mọi CRITICAL/HIGH.

- [ ] **Step 8: Commit**

```bash
git add src
git commit -m "feat: add CSV student import with preview and server validation"
```

---

## Mốc 3 — Sơ đồ băng ghế

### Task 8: Logic sơ đồ và gán chỗ (hàm thuần)

**Files:**
- Create: `src/lib/seating/layout.ts`, `src/lib/seating/layout.test.ts`, `src/lib/seating/assignments.ts`, `src/lib/seating/assignments.test.ts`

**Interfaces:**
- Consumes: `Layout`, `LayoutRow`, `LayoutItem`, `BenchItem`, `Seat`, `Assignment` từ `src/lib/seating/types.ts`.
- Produces (`layout.ts`):
  - `LIMITS = { minSeats: 2, maxSeats: 4, maxRows: 12, maxBenchesPerRow: 8, maxItemsPerRow: 16 }`
  - `parseLayout(input: unknown): { ok: true; layout: Layout } | { ok: false; error: string }`
  - `addRow(layout, rowId): Layout`, `removeRow(layout, rowId): Layout`
  - `addBench(layout, rowId, benchId, seats = 3): Layout`, `addGap(layout, rowId, gapId): Layout`
  - `setBenchSeats(layout, benchId, seats): Layout`, `removeItem(layout, rowId, itemId): Layout`
  - `canAddRow(layout): boolean`, `canAddBench(layout, rowId): boolean`
  - `seatsOf(layout): Seat[]` (theo thứ tự đọc: hàng → băng → ghế)
  - `defaultLayout(newId: () => string): Layout` (3 hàng × 2 băng × 3 ghế, có lối đi giữa)
- Produces (`assignments.ts`):
  - `seatKey(seat: Seat): string` (`"<benchId>:<seatIndex>"`)
  - `assignStudent(layout, assignments, seat, studentId): { ok: true; assignments: Assignment[] } | { ok: false; error: string }`
  - `unassignSeat(assignments, seat): Assignment[]`
  - `pruneAssignments(layout, assignments): Assignment[]`
  - `unseatedStudentIds(studentIds: readonly string[], assignments): string[]`

- [ ] **Step 1: Viết test lỗi** — `src/lib/seating/layout.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  LIMITS, addBench, addGap, addRow, canAddBench, canAddRow, defaultLayout, parseLayout,
  removeItem, removeRow, seatsOf, setBenchSeats,
} from "./layout";
import type { Layout } from "./types";

const base: Layout = [
  { id: "r1", items: [{ type: "bench", id: "b1", seats: 3 }, { type: "gap", id: "g1" }, { type: "bench", id: "b2", seats: 2 }] },
];

describe("layout operations", () => {
  it("never mutate their input", () => {
    const snapshot = structuredClone(base);
    addRow(base, "r2"); addBench(base, "r1", "b3"); addGap(base, "r1", "g2");
    setBenchSeats(base, "b1", 4); removeItem(base, "r1", "b1"); removeRow(base, "r1");
    expect(base).toEqual(snapshot);
  });

  it("adds a row, a 3-seat bench by default, and a gap", () => {
    const withRow = addRow(base, "r2");
    expect(withRow[1]).toEqual({ id: "r2", items: [] });
    expect(addBench(withRow, "r2", "b9")[1].items).toEqual([{ type: "bench", id: "b9", seats: 3 }]);
    expect(addGap(withRow, "r2", "g9")[1].items).toEqual([{ type: "gap", id: "g9" }]);
  });

  it("changes seats, removes an item and removes a row", () => {
    expect(setBenchSeats(base, "b2", 4)[0].items[2]).toEqual({ type: "bench", id: "b2", seats: 4 });
    expect(removeItem(base, "r1", "g1")[0].items.map((i) => i.id)).toEqual(["b1", "b2"]);
    expect(removeRow(base, "r1")).toEqual([]);
  });

  it("lists seats in reading order", () => {
    expect(seatsOf(base)).toEqual([
      { benchId: "b1", seatIndex: 0 }, { benchId: "b1", seatIndex: 1 }, { benchId: "b1", seatIndex: 2 },
      { benchId: "b2", seatIndex: 0 }, { benchId: "b2", seatIndex: 1 },
    ]);
  });

  it("builds a valid default layout with unique ids", () => {
    let n = 0;
    const layout = defaultLayout(() => `id${++n}`);
    expect(layout).toHaveLength(3);
    expect(parseLayout(layout).ok).toBe(true);
    expect(seatsOf(layout)).toHaveLength(18);
  });

  it("reports when more rows or benches can be added", () => {
    const rows = Array.from({ length: LIMITS.maxRows }, (_, i) => ({ id: `r${i}`, items: [] }));
    expect(canAddRow(rows)).toBe(false);
    expect(canAddRow(rows.slice(1))).toBe(true);
    const full: Layout = [{ id: "r", items: Array.from({ length: LIMITS.maxBenchesPerRow }, (_, i) => ({ type: "bench" as const, id: `b${i}`, seats: 2 })) }];
    expect(canAddBench(full, "r")).toBe(false);
    expect(canAddBench(base, "r1")).toBe(true);
  });
});

describe("parseLayout", () => {
  it("accepts a valid layout and an empty one", () => {
    expect(parseLayout(base)).toEqual({ ok: true, layout: base });
    expect(parseLayout([]).ok).toBe(true);
  });

  it("rejects benches with fewer than 2 or more than 4 seats", () => {
    for (const seats of [1, 5, 2.5]) {
      const r = parseLayout([{ id: "r", items: [{ type: "bench", id: "b", seats }] }]);
      expect(r).toEqual({ ok: false, error: "Mỗi băng có từ 2 đến 4 ghế" });
    }
  });

  it("rejects too many rows and too many benches in a row", () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({ id: `r${i}`, items: [] }));
    expect(parseLayout(rows)).toEqual({ ok: false, error: "Tối đa 12 hàng" });
    const benches = Array.from({ length: 9 }, (_, i) => ({ type: "bench", id: `b${i}`, seats: 2 }));
    expect(parseLayout([{ id: "r", items: benches }])).toEqual({ ok: false, error: "Mỗi hàng tối đa 8 băng" });
  });

  it("rejects duplicate ids and malformed input", () => {
    const dup = [{ id: "r", items: [{ type: "bench", id: "x", seats: 2 }, { type: "gap", id: "x" }] }];
    expect(parseLayout(dup)).toEqual({ ok: false, error: "Mã băng hoặc hàng bị trùng" });
    expect(parseLayout("nope")).toEqual({ ok: false, error: "Sơ đồ không hợp lệ" });
    expect(parseLayout([{ id: "r", items: [{ type: "table" }] }])).toEqual({ ok: false, error: "Sơ đồ không hợp lệ" });
  });
});
```

`src/lib/seating/assignments.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { assignStudent, pruneAssignments, seatKey, unassignSeat, unseatedStudentIds } from "./assignments";
import type { Assignment, Layout } from "./types";

const layout: Layout = [{ id: "r1", items: [{ type: "bench", id: "b1", seats: 2 }, { type: "bench", id: "b2", seats: 2 }] }];
const s = (benchId: string, seatIndex: number) => ({ benchId, seatIndex });

describe("assignStudent", () => {
  it("seats a student on a valid seat", () => {
    const r = assignStudent(layout, [], s("b1", 0), "an");
    expect(r).toEqual({ ok: true, assignments: [{ benchId: "b1", seatIndex: 0, studentId: "an" }] });
  });

  it("moves a student who is already seated", () => {
    const start: Assignment[] = [{ ...s("b1", 0), studentId: "an" }];
    const r = assignStudent(layout, start, s("b2", 1), "an");
    expect(r).toEqual({ ok: true, assignments: [{ ...s("b2", 1), studentId: "an" }] });
  });

  it("replaces the occupant, who becomes unseated", () => {
    const start: Assignment[] = [{ ...s("b1", 0), studentId: "an" }];
    const r = assignStudent(layout, start, s("b1", 0), "binh");
    expect(r).toEqual({ ok: true, assignments: [{ ...s("b1", 0), studentId: "binh" }] });
  });

  it("rejects seats that do not exist and does not mutate its input", () => {
    const start: Assignment[] = Object.freeze([{ ...s("b1", 0), studentId: "an" }]) as Assignment[];
    expect(assignStudent(layout, start, s("b1", 2), "binh")).toEqual({ ok: false, error: "Ghế không tồn tại trong sơ đồ" });
    expect(assignStudent(layout, start, s("zzz", 0), "binh").ok).toBe(false);
    expect(start).toHaveLength(1);
  });
});

describe("unassignSeat / pruneAssignments / unseatedStudentIds", () => {
  const start: Assignment[] = [
    { ...s("b1", 0), studentId: "an" },
    { ...s("b2", 1), studentId: "binh" },
  ];

  it("unassigns one seat", () => {
    expect(unassignSeat(start, s("b1", 0))).toEqual([{ ...s("b2", 1), studentId: "binh" }]);
  });

  it("prunes assignments of removed benches and of seats that no longer exist", () => {
    const shrunk: Layout = [{ id: "r1", items: [{ type: "bench", id: "b1", seats: 2 }] }];
    expect(pruneAssignments(shrunk, start)).toEqual([{ ...s("b1", 0), studentId: "an" }]);
    const fewerSeats: Layout = [{ id: "r1", items: [{ type: "bench", id: "b1", seats: 2 }, { type: "bench", id: "b2", seats: 2 }] }];
    const high: Assignment[] = [{ ...s("b2", 3), studentId: "chi" }];
    expect(pruneAssignments(fewerSeats, high)).toEqual([]);
  });

  it("lists students without a seat", () => {
    expect(unseatedStudentIds(["an", "binh", "chi"], start)).toEqual(["chi"]);
  });

  it("builds stable seat keys", () => expect(seatKey(s("b1", 2))).toBe("b1:2"));
});
```

- [ ] **Step 2: Chạy để thấy lỗi**

Run: `pnpm test src/lib/seating`
Expected: FAIL — thiếu module.

- [ ] **Step 3: Cài đặt** — `src/lib/seating/layout.ts`

```ts
import { z } from "zod";
import type { Layout, LayoutRow, Seat } from "./types";

export const LIMITS = { minSeats: 2, maxSeats: 4, maxRows: 12, maxBenchesPerRow: 8, maxItemsPerRow: 16 } as const;

const MSG = {
  seats: "Mỗi băng có từ 2 đến 4 ghế",
  rows: "Tối đa 12 hàng",
  benches: "Mỗi hàng tối đa 8 băng",
  items: "Mỗi hàng tối đa 16 mục",
  duplicate: "Mã băng hoặc hàng bị trùng",
  invalid: "Sơ đồ không hợp lệ",
} as const;
const KNOWN = new Set<string>(Object.values(MSG));

const benchSchema = z.object({
  type: z.literal("bench"),
  id: z.string().min(1),
  seats: z.number().int(MSG.seats).min(LIMITS.minSeats, MSG.seats).max(LIMITS.maxSeats, MSG.seats),
});
const gapSchema = z.object({ type: z.literal("gap"), id: z.string().min(1) });
const rowSchema = z.object({
  id: z.string().min(1),
  items: z.array(z.discriminatedUnion("type", [benchSchema, gapSchema])).max(LIMITS.maxItemsPerRow, MSG.items),
});
const layoutSchema = z.array(rowSchema).max(LIMITS.maxRows, MSG.rows);

type ParseResult = { ok: true; layout: Layout } | { ok: false; error: string };

export function parseLayout(input: unknown): ParseResult {
  const parsed = layoutSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? MSG.invalid;
    return { ok: false, error: KNOWN.has(message) ? message : MSG.invalid };
  }
  const layout: Layout = parsed.data;
  const ids = new Set<string>();
  for (const row of layout) {
    if (row.items.filter((i) => i.type === "bench").length > LIMITS.maxBenchesPerRow) return { ok: false, error: MSG.benches };
    for (const id of [row.id, ...row.items.map((i) => i.id)]) {
      if (ids.has(id)) return { ok: false, error: MSG.duplicate };
      ids.add(id);
    }
  }
  return { ok: true, layout };
}

const mapRow = (layout: Layout, rowId: string, fn: (row: LayoutRow) => LayoutRow): Layout =>
  layout.map((row) => (row.id === rowId ? fn(row) : row));

export const addRow = (layout: Layout, rowId: string): Layout => [...layout, { id: rowId, items: [] }];
export const removeRow = (layout: Layout, rowId: string): Layout => layout.filter((r) => r.id !== rowId);

export const addBench = (layout: Layout, rowId: string, benchId: string, seats = 3): Layout =>
  mapRow(layout, rowId, (row) => ({ ...row, items: [...row.items, { type: "bench", id: benchId, seats }] }));

export const addGap = (layout: Layout, rowId: string, gapId: string): Layout =>
  mapRow(layout, rowId, (row) => ({ ...row, items: [...row.items, { type: "gap", id: gapId }] }));

export const removeItem = (layout: Layout, rowId: string, itemId: string): Layout =>
  mapRow(layout, rowId, (row) => ({ ...row, items: row.items.filter((i) => i.id !== itemId) }));

export const setBenchSeats = (layout: Layout, benchId: string, seats: number): Layout =>
  layout.map((row) => ({
    ...row,
    items: row.items.map((i) => (i.type === "bench" && i.id === benchId ? { ...i, seats } : i)),
  }));

export const canAddRow = (layout: Layout): boolean => layout.length < LIMITS.maxRows;

export function canAddBench(layout: Layout, rowId: string): boolean {
  const row = layout.find((r) => r.id === rowId);
  return !!row && row.items.filter((i) => i.type === "bench").length < LIMITS.maxBenchesPerRow && row.items.length < LIMITS.maxItemsPerRow;
}

export function seatsOf(layout: Layout): Seat[] {
  return layout.flatMap((row) =>
    row.items.flatMap((item) =>
      item.type === "bench" ? Array.from({ length: item.seats }, (_, seatIndex) => ({ benchId: item.id, seatIndex })) : [],
    ),
  );
}

export function defaultLayout(newId: () => string): Layout {
  return Array.from({ length: 3 }, () => ({
    id: newId(),
    items: [
      { type: "bench" as const, id: newId(), seats: 3 },
      { type: "gap" as const, id: newId() },
      { type: "bench" as const, id: newId(), seats: 3 },
    ],
  }));
}
```

`src/lib/seating/assignments.ts`

```ts
import { seatsOf } from "./layout";
import type { Assignment, Layout, Seat } from "./types";

export const seatKey = (seat: Seat): string => `${seat.benchId}:${seat.seatIndex}`;

type AssignResult = { ok: true; assignments: Assignment[] } | { ok: false; error: string };

export function assignStudent(
  layout: Layout,
  assignments: readonly Assignment[],
  seat: Seat,
  studentId: string,
): AssignResult {
  const target = seatKey(seat);
  if (!seatsOf(layout).some((s) => seatKey(s) === target)) return { ok: false, error: "Ghế không tồn tại trong sơ đồ" };
  const kept = assignments.filter((a) => a.studentId !== studentId && seatKey(a) !== target);
  return { ok: true, assignments: [...kept, { benchId: seat.benchId, seatIndex: seat.seatIndex, studentId }] };
}

export const unassignSeat = (assignments: readonly Assignment[], seat: Seat): Assignment[] =>
  assignments.filter((a) => seatKey(a) !== seatKey(seat));

export function pruneAssignments(layout: Layout, assignments: readonly Assignment[]): Assignment[] {
  const valid = new Set(seatsOf(layout).map(seatKey));
  return assignments.filter((a) => valid.has(seatKey(a)));
}

export function unseatedStudentIds(studentIds: readonly string[], assignments: readonly Assignment[]): string[] {
  const seated = new Set(assignments.map((a) => a.studentId));
  return studentIds.filter((id) => !seated.has(id));
}
```

- [ ] **Step 4: Chạy test**

Run: `pnpm test src/lib/seating`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/seating
git commit -m "feat: add pure bench seating layout and assignment logic"
```

---

### Task 9: Lưu sơ đồ, gán ghế và editor

**Files:**
- Create: `src/db/queries/seating.ts`, `src/server/services/seating.ts`, `src/server/services/seating.test.ts`, `src/components/seating/SeatMap.tsx`, `src/app/(app)/lop/[classId]/so-do/page.tsx`, `src/app/(app)/lop/[classId]/so-do/actions.ts`, `src/app/(app)/lop/[classId]/so-do/SeatEditor.tsx`

**Interfaces:**
- Consumes: `Layout`, `Assignment`, `Seat`, `parseLayout`, `defaultLayout`, `assignStudent`, `unassignSeat`, `pruneAssignments`, `guardClass`, `NOT_FOUND`, `getStudent`.
- Produces:
  - `listPlans(db, classId): Promise<{ id: string; name: string; isActive: boolean }[]>`
  - `getPlan(db, planId): Promise<{ plan: typeof seatingPlans.$inferSelect; assignments: Assignment[] } | null>`
  - `replaceAssignments(db: Pick<Db, "delete" | "insert">, planId, assignments): Promise<void>`
  - services (`(db, user, input: unknown)`): `createPlan → {id}` (input `{classId, name}`), `saveLayout → {layout, assignments}` (input `{planId, layout}`), `assignSeat → {assignments}` (input `{planId, benchId, seatIndex, studentId: string | null}`), `activatePlan → undefined` (`{planId}`), `deletePlan → undefined` (`{planId}`)
  - `<SeatMap layout renderSeat>` : `{ layout: Layout; renderSeat: (seat: Seat) => React.ReactNode }`

- [ ] **Step 1: Viết test lỗi** — `src/server/services/seating.test.ts`

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getPlan } from "@/db/queries/seating";
import { seatAssignments, seatingPlans, students } from "@/db/schema";
import type { BenchItem } from "@/lib/seating/types";
import { parseLayout } from "@/lib/seating/layout";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { activatePlan, assignSeat, createPlan, deletePlan, saveLayout } from "./seating";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const created = await createPlan(db, b.glv, { classId: b.classId, name: "Sơ đồ 1" });
  if (!created.ok) throw new Error("setup");
  const planId = created.data.id;
  const data = await getPlan(db, planId);
  const benches = data!.plan.layout.flatMap((r) => r.items).filter((i): i is BenchItem => i.type === "bench");
  const kid = async (name: string, extra: Partial<typeof students.$inferInsert> = {}) =>
    (await db.insert(students).values({ classId: b.classId, fullName: name, ...extra }).returning())[0];
  return { db, b, planId, benches, kid };
}

describe("createPlan", () => {
  it("makes the first plan active, later ones inactive, with a valid default layout", async () => {
    const { db, b, planId } = await setup();
    const second = await createPlan(db, b.glv, { classId: b.classId, name: "Sơ đồ 2" });
    if (!second.ok) throw new Error("setup");
    const [p1] = await db.select().from(seatingPlans).where(eq(seatingPlans.id, planId));
    const [p2] = await db.select().from(seatingPlans).where(eq(seatingPlans.id, second.data.id));
    expect([p1.isActive, p2.isActive]).toEqual([true, false]);
    expect(parseLayout(p1.layout).ok).toBe(true);
  });

  it("is forbidden for other classes' catechists and read-only heads, and rejects blank names", async () => {
    const { db, b } = await setup();
    expect((await createPlan(db, b.otherGlv, { classId: b.classId, name: "X" })).ok).toBe(false);
    expect((await createPlan(db, b.head, { classId: b.classId, name: "X" })).ok).toBe(false);
    expect((await createPlan(db, b.glv, { classId: b.classId, name: "  " })).ok).toBe(false);
  });
});

describe("saveLayout", () => {
  it("rejects an invalid layout and keeps the stored one", async () => {
    const { db, b, planId } = await setup();
    const before = (await getPlan(db, planId))!.plan.layout;
    const r = await saveLayout(db, b.glv, { planId, layout: [{ id: "r", items: [{ type: "bench", id: "x", seats: 5 }] }] });
    expect(r).toEqual({ ok: false, error: "Mỗi băng có từ 2 đến 4 ghế" });
    expect((await getPlan(db, planId))!.plan.layout).toEqual(before);
  });

  it("prunes assignments of a removed bench", async () => {
    const { db, b, planId, benches, kid } = await setup();
    const an = await kid("An");
    await assignSeat(db, b.glv, { planId, benchId: benches[0].id, seatIndex: 0, studentId: an.id });
    const layout = (await getPlan(db, planId))!.plan.layout.map((row) => ({ ...row, items: row.items.filter((i) => i.id !== benches[0].id) }));
    const r = await saveLayout(db, b.glv, { planId, layout });
    expect(r.ok && r.data.assignments).toEqual([]);
    expect(await db.select().from(seatAssignments)).toHaveLength(0);
  });
});

describe("assignSeat", () => {
  it("seats, moves (one row per student) and replaces an occupant", async () => {
    const { db, b, planId, benches, kid } = await setup();
    const [an, binh] = [await kid("An"), await kid("Bình")];
    await assignSeat(db, b.glv, { planId, benchId: benches[0].id, seatIndex: 0, studentId: an.id });
    await assignSeat(db, b.glv, { planId, benchId: benches[0].id, seatIndex: 1, studentId: an.id });
    expect(await db.select().from(seatAssignments)).toHaveLength(1);
    const r = await assignSeat(db, b.glv, { planId, benchId: benches[0].id, seatIndex: 1, studentId: binh.id });
    expect(r.ok && r.data.assignments).toEqual([{ benchId: benches[0].id, seatIndex: 1, studentId: binh.id }]);
  });

  it("clears a seat when studentId is null", async () => {
    const { db, b, planId, benches, kid } = await setup();
    const an = await kid("An");
    await assignSeat(db, b.glv, { planId, benchId: benches[0].id, seatIndex: 0, studentId: an.id });
    const r = await assignSeat(db, b.glv, { planId, benchId: benches[0].id, seatIndex: 0, studentId: null });
    expect(r.ok && r.data.assignments).toEqual([]);
  });

  it("rejects hidden students, students of another class and unknown seats", async () => {
    const { db, b, planId, benches, kid } = await setup();
    const hidden = await kid("Ẩn", { active: false });
    const [stranger] = await db.insert(students).values({ classId: b.otherClassId, fullName: "Lạ" }).returning();
    expect((await assignSeat(db, b.glv, { planId, benchId: benches[0].id, seatIndex: 0, studentId: hidden.id })).ok).toBe(false);
    expect((await assignSeat(db, b.glv, { planId, benchId: benches[0].id, seatIndex: 0, studentId: stranger.id })).ok).toBe(false);
    const an = await kid("An");
    expect((await assignSeat(db, b.glv, { planId, benchId: "nope", seatIndex: 0, studentId: an.id })).ok).toBe(false);
  });

  it("is forbidden for a catechist of another class", async () => {
    const { db, b, planId, benches, kid } = await setup();
    const an = await kid("An");
    expect((await assignSeat(db, b.otherGlv, { planId, benchId: benches[0].id, seatIndex: 0, studentId: an.id })).ok).toBe(false);
  });
});

describe("activatePlan / deletePlan", () => {
  it("keeps exactly one active plan and refuses to delete the active one", async () => {
    const { db, b, planId } = await setup();
    const second = await createPlan(db, b.glv, { classId: b.classId, name: "Sơ đồ 2" });
    if (!second.ok) throw new Error("setup");
    expect((await deletePlan(db, b.glv, { planId })).ok).toBe(false);
    expect((await activatePlan(db, b.glv, { planId: second.data.id })).ok).toBe(true);
    const active = (await db.select().from(seatingPlans)).filter((p) => p.isActive);
    expect(active.map((p) => p.id)).toEqual([second.data.id]);
    expect((await deletePlan(db, b.glv, { planId })).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Chạy để thấy lỗi**

Run: `pnpm test src/server/services/seating.test.ts`
Expected: FAIL — thiếu module `seating`.

- [ ] **Step 3: Truy vấn** — `src/db/queries/seating.ts`

```ts
import { asc, eq } from "drizzle-orm";
import type { Assignment } from "@/lib/seating/types";
import { seatAssignments, seatingPlans } from "../schema";
import type { Db } from "../types";

export const listPlans = (db: Db, classId: string) =>
  db
    .select({ id: seatingPlans.id, name: seatingPlans.name, isActive: seatingPlans.isActive })
    .from(seatingPlans)
    .where(eq(seatingPlans.classId, classId))
    .orderBy(asc(seatingPlans.name));

export async function getPlan(db: Db, planId: string) {
  const [plan] = await db.select().from(seatingPlans).where(eq(seatingPlans.id, planId));
  if (!plan) return null;
  const rows = await db.select().from(seatAssignments).where(eq(seatAssignments.planId, planId));
  const assignments: Assignment[] = rows.map((r) => ({ benchId: r.benchId, seatIndex: r.seatIndex, studentId: r.studentId }));
  return { plan, assignments };
}

/** Thay toàn bộ phân ghế của một sơ đồ; gọi trong transaction để nguyên tử. */
export async function replaceAssignments(
  db: Pick<Db, "delete" | "insert">,
  planId: string,
  assignments: readonly Assignment[],
): Promise<void> {
  await db.delete(seatAssignments).where(eq(seatAssignments.planId, planId));
  if (assignments.length > 0) await db.insert(seatAssignments).values(assignments.map((a) => ({ planId, ...a })));
}
```

- [ ] **Step 4: Service** — `src/server/services/seating.ts`

```ts
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getPlan, replaceAssignments } from "@/db/queries/seating";
import { getStudent } from "@/db/queries/students";
import { seatingPlans } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { assignStudent, pruneAssignments, unassignSeat } from "@/lib/seating/assignments";
import { defaultLayout, parseLayout } from "@/lib/seating/layout";
import type { Assignment, Layout } from "@/lib/seating/types";
import { NOT_FOUND, guardClass } from "../guard";
import { fail, ok, type ActionResult } from "../result";

const NOT_FOUND_PLAN = "Không tìm thấy sơ đồ";
const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Dữ liệu không hợp lệ";

async function loadWritablePlan(db: Db, user: AppUser, planId: string) {
  if (!z.uuid().safeParse(planId).success) return null;
  const data = await getPlan(db, planId);
  if (!data || !(await guardClass(db, user, data.plan.classId, "write"))) return null;
  return data;
}

export async function createPlan(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ id: string }>> {
  const p = z.object({ classId: z.string(), name: z.string().trim().min(1, "Nhập tên sơ đồ").max(60) }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  if (!(await guardClass(db, user, p.data.classId, "write"))) return fail(NOT_FOUND);
  const existing = await db.select({ id: seatingPlans.id }).from(seatingPlans).where(eq(seatingPlans.classId, p.data.classId));
  const [row] = await db
    .insert(seatingPlans)
    .values({ classId: p.data.classId, name: p.data.name, layout: defaultLayout(() => crypto.randomUUID()), isActive: existing.length === 0 })
    .returning({ id: seatingPlans.id });
  return ok({ id: row.id });
}

export async function saveLayout(
  db: Db,
  user: AppUser,
  input: unknown,
): Promise<ActionResult<{ layout: Layout; assignments: Assignment[] }>> {
  const p = z.object({ planId: z.string(), layout: z.unknown() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const parsed = parseLayout(p.data.layout);
  if (!parsed.ok) return fail(parsed.error);
  const data = await loadWritablePlan(db, user, p.data.planId);
  if (!data) return fail(NOT_FOUND_PLAN);
  const kept = pruneAssignments(parsed.layout, data.assignments);
  await db.transaction(async (tx) => {
    await tx.update(seatingPlans).set({ layout: parsed.layout }).where(eq(seatingPlans.id, data.plan.id));
    await replaceAssignments(tx, data.plan.id, kept);
  });
  return ok({ layout: parsed.layout, assignments: kept });
}

export async function assignSeat(
  db: Db,
  user: AppUser,
  input: unknown,
): Promise<ActionResult<{ assignments: Assignment[] }>> {
  const p = z.object({
    planId: z.string(),
    benchId: z.string().min(1),
    seatIndex: z.number().int().min(0),
    studentId: z.string().nullable(),
  }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const data = await loadWritablePlan(db, user, p.data.planId);
  if (!data) return fail(NOT_FOUND_PLAN);
  const seat = { benchId: p.data.benchId, seatIndex: p.data.seatIndex };

  let next: Assignment[];
  if (p.data.studentId === null) {
    next = unassignSeat(data.assignments, seat);
  } else {
    if (!z.uuid().safeParse(p.data.studentId).success) return fail("Không thể xếp em này");
    const student = await getStudent(db, p.data.studentId);
    if (!student || student.classId !== data.plan.classId || !student.active) return fail("Không thể xếp em này");
    const result = assignStudent(data.plan.layout, data.assignments, seat, student.id);
    if (!result.ok) return fail(result.error);
    next = result.assignments;
  }
  await db.transaction((tx) => replaceAssignments(tx, data.plan.id, next));
  return ok({ assignments: next });
}

export async function activatePlan(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = z.object({ planId: z.string() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const data = await loadWritablePlan(db, user, p.data.planId);
  if (!data) return fail(NOT_FOUND_PLAN);
  await db.transaction(async (tx) => {
    await tx.update(seatingPlans).set({ isActive: false }).where(eq(seatingPlans.classId, data.plan.classId));
    await tx.update(seatingPlans).set({ isActive: true }).where(eq(seatingPlans.id, data.plan.id));
  });
  return ok(undefined);
}

export async function deletePlan(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = z.object({ planId: z.string() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const data = await loadWritablePlan(db, user, p.data.planId);
  if (!data) return fail(NOT_FOUND_PLAN);
  if (data.plan.isActive) return fail("Không thể xóa sơ đồ đang dùng");
  await db.delete(seatingPlans).where(eq(seatingPlans.id, data.plan.id));
  return ok(undefined);
}
```

- [ ] **Step 5: Chạy test**

Run: `pnpm test src/server/services/seating.test.ts`
Expected: PASS.

- [ ] **Step 6: Giao diện** — `src/components/seating/SeatMap.tsx`

```tsx
import type { Layout, Seat } from "@/lib/seating/types";

export function SeatMap({ layout, renderSeat }: { layout: Layout; renderSeat: (seat: Seat) => React.ReactNode }) {
  if (layout.length === 0) return <p className="text-ink-soft">Sơ đồ chưa có hàng nào.</p>;
  return (
    <div className="flex flex-col gap-3 overflow-x-auto pb-2">
      {layout.map((row, index) => (
        <div key={row.id} role="group" aria-label={`Hàng ${index + 1}`} className="flex min-w-max items-stretch gap-2">
          {row.items.map((item) =>
            item.type === "gap" ? (
              <div key={item.id} aria-hidden className="w-6 shrink-0" />
            ) : (
              <div key={item.id} className="flex gap-1 rounded-2xl border border-line bg-card p-1.5 shadow-sm">
                {Array.from({ length: item.seats }, (_, seatIndex) => (
                  <div key={seatIndex}>{renderSeat({ benchId: item.id, seatIndex })}</div>
                ))}
              </div>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
```

`src/app/(app)/lop/[classId]/so-do/actions.ts`

```ts
"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { toFormState, type FormState } from "@/server/form-state";
import * as seating from "@/server/services/seating";

const path = (classId: string) => `/lop/${classId}/so-do`;

export async function createPlanAction(classId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const result = await seating.createPlan(db, await requireUser(), { ...Object.fromEntries(formData), classId });
  if (result.ok) revalidatePath(path(classId));
  return toFormState(result);
}

export async function saveLayoutAction(classId: string, input: unknown) {
  const result = await seating.saveLayout(db, await requireUser(), input);
  if (result.ok) revalidatePath(path(classId));
  return result;
}

export async function assignSeatAction(classId: string, input: unknown) {
  const result = await seating.assignSeat(db, await requireUser(), input);
  if (result.ok) revalidatePath(path(classId));
  return result;
}

export async function activatePlanAction(classId: string, planId: string) {
  const result = await seating.activatePlan(db, await requireUser(), { planId });
  if (result.ok) revalidatePath(path(classId));
  return result;
}

export async function deletePlanAction(classId: string, planId: string) {
  const result = await seating.deletePlan(db, await requireUser(), { planId });
  if (result.ok) revalidatePath(path(classId));
  return result;
}
```

`src/app/(app)/lop/[classId]/so-do/SeatEditor.tsx`

```tsx
"use client";
import { useState } from "react";
import { SeatMap } from "@/components/seating/SeatMap";
import { seatKey, unseatedStudentIds } from "@/lib/seating/assignments";
import { addBench, addGap, addRow, canAddBench, canAddRow, removeItem, removeRow, setBenchSeats, LIMITS } from "@/lib/seating/layout";
import type { Assignment, Layout, Seat } from "@/lib/seating/types";
import { shortName } from "@/lib/students/short-name";
import { assignSeatAction, saveLayoutAction } from "./actions";

interface Props {
  classId: string;
  planId: string;
  initialLayout: Layout;
  initialAssignments: Assignment[];
  students: { id: string; fullName: string }[];
  canWrite: boolean;
}

const uid = () => crypto.randomUUID();
const chip = "h-11 min-w-11 rounded-lg border border-line bg-card px-3 text-sm font-medium";

export function SeatEditor({ classId, planId, initialLayout, initialAssignments, students, canWrite }: Props) {
  const [mode, setMode] = useState<"seat" | "layout">("seat");
  const [layout, setLayout] = useState(initialLayout);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [picking, setPicking] = useState<Seat | null>(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string>();

  const names = new Map(students.map((s) => [s.id, s.fullName]));
  const owner = new Map(assignments.map((a) => [seatKey(a), a.studentId]));
  const freeIds = new Set(unseatedStudentIds(students.map((s) => s.id), assignments));
  const edit = (next: Layout) => { setLayout(next); setDirty(true); setMessage(undefined); };

  async function save() {
    const r = await saveLayoutAction(classId, { planId, layout });
    if (r.ok) { setAssignments(r.data.assignments); setDirty(false); setMessage("Đã lưu bố cục"); }
    else setMessage(r.error);
  }

  async function assign(studentId: string | null) {
    if (!picking) return;
    const r = await assignSeatAction(classId, { planId, ...picking, studentId });
    setPicking(null);
    if (r.ok) setAssignments(r.data.assignments); else setMessage(r.error);
  }

  return (
    <div className="flex flex-col gap-4">
      {canWrite && (
        <div className="flex gap-2" role="tablist">
          <button role="tab" aria-selected={mode === "seat"} disabled={dirty} onClick={() => setMode("seat")} className={`${chip} ${mode === "seat" ? "bg-brand text-white" : ""}`}>Xếp chỗ</button>
          <button role="tab" aria-selected={mode === "layout"} onClick={() => setMode("layout")} className={`${chip} ${mode === "layout" ? "bg-brand text-white" : ""}`}>Bố cục</button>
        </div>
      )}
      {dirty && <p className="text-sm text-warn-watch">Hãy lưu bố cục trước khi xếp chỗ.</p>}

      {mode === "seat" || !canWrite ? (
        <>
          <SeatMap layout={layout} renderSeat={(seat) => {
            const id = owner.get(seatKey(seat));
            return (
              <button disabled={!canWrite} onClick={() => setPicking(seat)} aria-label={id ? `Ghế của ${names.get(id)}` : "Ghế trống"}
                className={`flex h-16 w-16 items-center justify-center rounded-xl border text-xs font-medium ${id ? "border-brand bg-paper" : "border-dashed border-line text-ink-soft"}`}>
                {id ? shortName(names.get(id) ?? "") : "+"}
              </button>
            );
          }} />
          <p className="text-sm text-ink-soft">Chưa xếp chỗ: {freeIds.size} em</p>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          {layout.map((row, index) => (
            <div key={row.id} className="rounded-2xl border border-line bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Hàng {index + 1}</span>
                <button className={chip} disabled={!canAddBench(layout, row.id)} onClick={() => edit(addBench(layout, row.id, uid()))}>+ Băng</button>
                <button className={chip} onClick={() => edit(addGap(layout, row.id, uid()))}>+ Lối đi</button>
                <button className={`${chip} text-warn-alert`} onClick={() => edit(removeRow(layout, row.id))}>Xóa hàng</button>
              </div>
              <ul className="mt-2 flex flex-wrap gap-2">
                {row.items.map((item) => (
                  <li key={item.id} className="flex items-center gap-1 rounded-xl border border-line px-2 py-1 text-sm">
                    {item.type === "gap" ? "Lối đi" : (
                      <>
                        Băng
                        <button aria-label="Bớt ghế" className={chip} disabled={item.seats <= LIMITS.minSeats} onClick={() => edit(setBenchSeats(layout, item.id, item.seats - 1))}>−</button>
                        {item.seats}
                        <button aria-label="Thêm ghế" className={chip} disabled={item.seats >= LIMITS.maxSeats} onClick={() => edit(setBenchSeats(layout, item.id, item.seats + 1))}>+</button>
                      </>
                    )}
                    <button aria-label="Xóa" className={`${chip} text-warn-alert`} onClick={() => edit(removeItem(layout, row.id, item.id))}>×</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <button className={chip} disabled={!canAddRow(layout)} onClick={() => edit(addRow(layout, uid()))}>+ Thêm hàng</button>
          <button className="h-12 rounded-xl bg-brand font-semibold text-white disabled:opacity-60" disabled={!dirty} onClick={save}>Lưu bố cục</button>
        </div>
      )}
      {message && <p role="status" className="text-sm">{message}</p>}

      {picking && (
        <div role="dialog" aria-label="Chọn em" className="fixed inset-x-0 bottom-0 z-30 max-h-[70dvh] overflow-y-auto rounded-t-3xl border-t border-line bg-card p-4 shadow-2xl">
          <div className="mx-auto max-w-3xl">
            <button className={`${chip} mb-2 w-full`} onClick={() => assign(null)}>Bỏ trống ghế này</button>
            <ul className="grid gap-1">
              {students.filter((s) => freeIds.has(s.id) || owner.get(seatKey(picking)) === s.id).map((s) => (
                <li key={s.id}><button className="h-12 w-full rounded-lg px-3 text-left" onClick={() => assign(s.id)}>{s.fullName}</button></li>
              ))}
            </ul>
            <button className={`${chip} mt-2 w-full`} onClick={() => setPicking(null)}>Đóng</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

`src/app/(app)/lop/[classId]/so-do/page.tsx`

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { SimpleForm } from "@/components/forms/SimpleForm";
import { db } from "@/db/client";
import { getPlan, listPlans } from "@/db/queries/seating";
import { listStudents } from "@/db/queries/students";
import { requireUser } from "@/lib/auth/dal";
import { classPermissions } from "@/server/guard";
import { activatePlanAction, createPlanAction, deletePlanAction } from "./actions";
import { SeatEditor } from "./SeatEditor";

export default async function SeatingPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<{ plan?: string }>;
}) {
  const { classId } = await params;
  const { plan: planParam } = await searchParams;
  const user = await requireUser();
  const perms = await classPermissions(db, user, classId);
  if (!perms.canRead) notFound();

  const plans = await listPlans(db, classId);
  const selected = plans.find((p) => p.id === planParam) ?? plans.find((p) => p.isActive) ?? plans[0];
  const data = selected ? await getPlan(db, selected.id) : null;
  const students = (await listStudents(db, classId)).map((s) => ({ id: s.id, fullName: s.fullName }));

  return (
    <section className="flex flex-col gap-4">
      <nav className="flex flex-wrap gap-2" aria-label="Các sơ đồ">
        {plans.map((p) => (
          <Link key={p.id} href={`?plan=${p.id}`}
            className={`flex h-11 items-center rounded-full border px-4 text-sm ${p.id === selected?.id ? "border-brand bg-brand text-white" : "border-line bg-card"}`}>
            {p.name}{p.isActive ? " ★" : ""}
          </Link>
        ))}
      </nav>
      {data && selected && (
        <>
          <SeatEditor key={selected.id} classId={classId} planId={selected.id} initialLayout={data.plan.layout}
            initialAssignments={data.assignments} students={students} canWrite={perms.canWrite} />
          {perms.canWrite && (
            <div className="flex gap-2">
              {!selected.isActive && (
                <form action={async () => { "use server"; await activatePlanAction(classId, selected.id); }}>
                  <button className="h-11 rounded-lg border border-line bg-card px-4 text-sm">Dùng sơ đồ này</button>
                </form>
              )}
              {!selected.isActive && (
                <form action={async () => { "use server"; await deletePlanAction(classId, selected.id); }}>
                  <button className="h-11 rounded-lg border border-line bg-card px-4 text-sm text-warn-alert">Xóa sơ đồ</button>
                </form>
              )}
            </div>
          )}
        </>
      )}
      {!data && <p className="text-ink-soft">Lớp chưa có sơ đồ{perms.canWrite ? ". Hãy tạo sơ đồ đầu tiên." : "."}</p>}
      {perms.canWrite && (
        <SimpleForm title="Tạo sơ đồ mới" action={createPlanAction.bind(null, classId)} fields={[{ name: "name", label: "Tên sơ đồ" }]} />
      )}
    </section>
  );
}
```

- [ ] **Step 7: Cổng chất lượng Mốc 3**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint`
Expected: pass. Thủ công ở khung 375px: tạo sơ đồ, thêm/bớt băng, lưu, xếp em vào ghế, đổi chỗ, ẩn một em rồi tải lại (em đó biến khỏi khay). Chạy agent **code-reviewer**; sửa mọi CRITICAL/HIGH.

- [ ] **Step 8: Commit**

```bash
git add src
git commit -m "feat: add seating plan persistence, seat assignment and editor"
```

---

## Mốc 4 — Điểm danh

### Task 10: Logic và dịch vụ điểm danh

**Files:**
- Create: `src/lib/dates.ts`, `src/lib/dates.test.ts`, `src/lib/attendance/toggle.ts`, `src/lib/attendance/toggle.test.ts`, `src/lib/attendance/summary.ts`, `src/lib/attendance/summary.test.ts`, `src/lib/attendance/ui.ts`, `src/db/queries/attendance.ts`, `src/server/services/attendance.ts`, `src/server/services/attendance.test.ts`
- Modify: `src/lib/attendance/warning.ts`, `src/lib/attendance/warning.test.ts`

**Interfaces:**
- Consumes: `AttendanceStatus`, `evaluateWarning`, `DEFAULT_RULES` (đã có), `guardClass`, `classPermissions`, `NOT_FOUND`, `Layout`, `Assignment`.
- Produces:
  - `todayInVietnam(now?: Date): string` → `"YYYY-MM-DD"` theo Asia/Ho_Chi_Minh
  - `evaluateWarningFromCount(unexcused: number, rules?: AttendanceRules): WarningResult`
  - `toggleStatus(current: AttendanceStatus | null): AttendanceStatus`
  - `interface StudentSummary { present: number; excused: number; unexcused: number; late: number; marked: number; warning: WarningResult }`; `summarize(records: ReadonlyArray<{ status: AttendanceStatus }>, rules?): StudentSummary`
  - `STATUS_LABEL`, `STATUS_CLASS`, `NONE_CLASS` (`src/lib/attendance/ui.ts`)
  - queries: `findTermFor(db, date): Promise<{ id: string; name: string } | null>`, `findSession(db, classId, date)`, `getSession(db, id)`, `unexcusedCount(db, studentId, termId): Promise<number>`, `listSessions(db, classId, limit?): Promise<{ id; heldOn; cancelled; marked: number; absent: number }[]>`, `loadBoardData(db, sessionId)`
  - `interface BoardStudent { id: string; fullName: string; saintName: string | null; status: AttendanceStatus | null; reason: string | null; priorUnexcused: number }`
  - `interface Board { sessionId: string; classId: string; heldOn: string; cancelled: boolean; canWrite: boolean; students: BoardStudent[]; plan: { layout: Layout; assignments: Assignment[] } | null }`
  - services: `openSession(db, user, {classId, heldOn}) → {id: string}`, `setStatus(db, user, {sessionId, studentId, status: AttendanceStatus | null, reason: string | null}) → {warning: WarningResult}`, `markAllPresent(db, user, {sessionId}) → {marked: number}`, `setCancelled(db, user, {sessionId, cancelled}) → undefined`, `readBoard(db, user, sessionId): Promise<Board | null>`

- [ ] **Step 1: Viết test lỗi (logic thuần)**

`src/lib/dates.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { todayInVietnam } from "./dates";

describe("todayInVietnam", () => {
  it("uses the Vietnam calendar day, not UTC", () => {
    expect(todayInVietnam(new Date("2026-10-10T17:30:00Z"))).toBe("2026-10-11"); // 00:30 giờ VN
    expect(todayInVietnam(new Date("2026-10-10T16:59:00Z"))).toBe("2026-10-10"); // 23:59 giờ VN
  });
  it("handles midday and year boundaries", () => {
    expect(todayInVietnam(new Date("2026-10-11T05:00:00Z"))).toBe("2026-10-11");
    expect(todayInVietnam(new Date("2026-12-31T18:00:00Z"))).toBe("2027-01-01");
  });
});
```

`src/lib/attendance/toggle.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { toggleStatus } from "./toggle";

describe("toggleStatus", () => {
  it("goes unmarked → present → absent_unexcused → present", () => {
    expect(toggleStatus(null)).toBe("present");
    expect(toggleStatus("present")).toBe("absent_unexcused");
    expect(toggleStatus("absent_unexcused")).toBe("present");
  });
  it("resets late and excused to present", () => {
    expect(toggleStatus("late")).toBe("present");
    expect(toggleStatus("absent_excused")).toBe("present");
  });
});
```

`src/lib/attendance/summary.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { summarize } from "./summary";

describe("summarize", () => {
  it("counts each status and derives the warning", () => {
    const s = summarize([
      { status: "present" }, { status: "present" }, { status: "late" },
      { status: "absent_excused" }, { status: "absent_unexcused" }, { status: "absent_unexcused" },
    ]);
    expect(s).toMatchObject({ present: 2, late: 1, excused: 1, unexcused: 2, marked: 6 });
    expect(s.warning.level).toBe("warning");
  });
  it("is all zeros and none for no records", () => {
    expect(summarize([])).toMatchObject({ marked: 0, unexcused: 0, warning: { level: "none" } });
  });
});
```

Thêm vào `src/lib/attendance/warning.test.ts`:

```ts
import { evaluateWarningFromCount } from "./warning";

describe("evaluateWarningFromCount", () => {
  it("maps counts to levels with the default threshold", () => {
    expect(evaluateWarningFromCount(0)).toEqual({ level: "none", unexcused: 0, remaining: 2 });
    expect(evaluateWarningFromCount(1)).toEqual({ level: "watch", unexcused: 1, remaining: 1 });
    expect(evaluateWarningFromCount(2)).toEqual({ level: "warning", unexcused: 2, remaining: 0 });
    expect(evaluateWarningFromCount(5).level).toBe("warning");
  });
});
```

- [ ] **Step 2: Chạy để thấy lỗi**

Run: `pnpm test src/lib`
Expected: FAIL — thiếu `dates`, `toggle`, `summary`, `evaluateWarningFromCount`.

- [ ] **Step 3: Cài đặt logic thuần**

`src/lib/dates.ts`

```ts
const VN_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }); // YYYY-MM-DD

export function todayInVietnam(now: Date = new Date()): string {
  return VN_DAY.format(now);
}
```

Sửa `src/lib/attendance/warning.ts` — thay thân `evaluateWarning` để dùng hàm mới:

```ts
export function evaluateWarningFromCount(
  unexcused: number,
  rules: AttendanceRules = DEFAULT_RULES,
): WarningResult {
  const remaining = Math.max(0, rules.unexcusedThreshold - unexcused);
  const level: WarningLevel =
    unexcused >= rules.unexcusedThreshold ? "warning" : unexcused > 0 ? "watch" : "none";
  return { level, unexcused, remaining };
}

export function evaluateWarning(
  records: ReadonlyArray<{ status: AttendanceStatus }>,
  rules: AttendanceRules = DEFAULT_RULES,
): WarningResult {
  return evaluateWarningFromCount(countUnexcused(records), rules);
}
```

`src/lib/attendance/toggle.ts`

```ts
import type { AttendanceStatus } from "./warning";

/** Chạm ghế: chưa điểm danh → có mặt → vắng không phép → có mặt. Các trạng thái khác về có mặt. */
export function toggleStatus(current: AttendanceStatus | null): AttendanceStatus {
  return current === "present" ? "absent_unexcused" : "present";
}
```

`src/lib/attendance/summary.ts`

```ts
import { DEFAULT_RULES, evaluateWarning, type AttendanceRules, type AttendanceStatus, type WarningResult } from "./warning";

export interface StudentSummary {
  present: number;
  excused: number;
  unexcused: number;
  late: number;
  marked: number;
  warning: WarningResult;
}

export function summarize(
  records: ReadonlyArray<{ status: AttendanceStatus }>,
  rules: AttendanceRules = DEFAULT_RULES,
): StudentSummary {
  const count = (s: AttendanceStatus) => records.filter((r) => r.status === s).length;
  return {
    present: count("present"),
    excused: count("absent_excused"),
    unexcused: count("absent_unexcused"),
    late: count("late"),
    marked: records.length,
    warning: evaluateWarning(records, rules),
  };
}
```

`src/lib/attendance/ui.ts`

```ts
import type { AttendanceStatus } from "./warning";

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Có mặt",
  absent_excused: "Vắng có phép",
  absent_unexcused: "Vắng không phép",
  late: "Đi muộn",
};

export const STATUS_CLASS: Record<AttendanceStatus, string> = {
  present: "border-st-present bg-st-present text-white",
  absent_excused: "border-st-excused bg-st-excused text-white",
  absent_unexcused: "border-st-unexcused bg-st-unexcused text-white",
  late: "border-st-late bg-st-late text-white",
};

export const NONE_CLASS = "border-dashed border-st-none bg-paper text-ink-soft";
```

- [ ] **Step 4: Chạy test logic thuần**

Run: `pnpm test src/lib`
Expected: PASS.

- [ ] **Step 5: Viết test dịch vụ lỗi** — `src/server/services/attendance.test.ts`

```ts
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { listSessions } from "@/db/queries/attendance";
import { attendance, students } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { markAllPresent, openSession, readBoard, setCancelled, setStatus } from "./attendance";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const mk = async (fullName: string, extra: Partial<typeof students.$inferInsert> = {}) =>
    (await db.insert(students).values({ classId: b.classId, fullName, ...extra }).returning())[0];
  const open = async (heldOn: string) => {
    const r = await openSession(db, b.glv, { classId: b.classId, heldOn });
    if (!r.ok) throw new Error(r.error);
    return r.data.id;
  };
  return { db, b, mk, open };
}

describe("openSession", () => {
  it("creates a session inside the term, including both boundary days", async () => {
    const { open } = await setup();
    await expect(open("2026-09-01")).resolves.toBeTruthy();
    await expect(open("2027-01-15")).resolves.toBeTruthy();
  });

  it("rejects dates outside every term and malformed dates", async () => {
    const { db, b } = await setup();
    expect(await openSession(db, b.glv, { classId: b.classId, heldOn: "2026-08-31" })).toEqual({ ok: false, error: "Ngày này không thuộc học kỳ nào" });
    expect((await openSession(db, b.glv, { classId: b.classId, heldOn: "11/10/2026" })).ok).toBe(false);
  });

  it("is idempotent: opening the same day twice returns the same session", async () => {
    const { open } = await setup();
    expect(await open("2026-10-11")).toBe(await open("2026-10-11"));
  });

  it("is forbidden for other catechists and read-only heads", async () => {
    const { db, b } = await setup();
    expect((await openSession(db, b.otherGlv, { classId: b.classId, heldOn: "2026-10-11" })).ok).toBe(false);
    expect((await openSession(db, b.head, { classId: b.classId, heldOn: "2026-10-11" })).ok).toBe(false);
  });
});

describe("setStatus", () => {
  it("upserts, and clears the record when status is null", async () => {
    const { db, b, mk, open } = await setup();
    const an = await mk("An");
    const sessionId = await open("2026-10-11");
    await setStatus(db, b.glv, { sessionId, studentId: an.id, status: "present", reason: null });
    await setStatus(db, b.glv, { sessionId, studentId: an.id, status: "absent_excused", reason: "ốm" });
    const [row] = await db.select().from(attendance);
    expect(row).toMatchObject({ status: "absent_excused", reason: "ốm", updatedBy: b.glv.id });
    await setStatus(db, b.glv, { sessionId, studentId: an.id, status: null, reason: null });
    expect(await db.select().from(attendance)).toHaveLength(0);
  });

  it("keeps exactly one row for double taps and concurrent writes", async () => {
    const { db, b, mk, open } = await setup();
    const an = await mk("An");
    const sessionId = await open("2026-10-11");
    const input = { sessionId, studentId: an.id, status: "absent_unexcused" as const, reason: null };
    await Promise.all([1, 2, 3, 4, 5].map(() => setStatus(db, b.glv, input)));
    expect(await db.select().from(attendance)).toHaveLength(1);
  });

  it("returns a warning that counts other sessions of the term", async () => {
    const { db, b, mk, open } = await setup();
    const an = await mk("An");
    const s1 = await open("2026-10-04");
    const s2 = await open("2026-10-11");
    const first = await setStatus(db, b.glv, { sessionId: s1, studentId: an.id, status: "absent_unexcused", reason: null });
    expect(first.ok && first.data.warning.level).toBe("watch");
    const second = await setStatus(db, b.glv, { sessionId: s2, studentId: an.id, status: "absent_unexcused", reason: null });
    expect(second.ok && second.data.warning).toEqual({ level: "warning", unexcused: 2, remaining: 0 });
  });

  it("does not count late or excused toward the warning, nor cancelled sessions", async () => {
    const { db, b, mk, open } = await setup();
    const an = await mk("An");
    const s1 = await open("2026-10-04");
    const s2 = await open("2026-10-11");
    await setStatus(db, b.glv, { sessionId: s1, studentId: an.id, status: "absent_unexcused", reason: null });
    await setCancelled(db, b.glv, { sessionId: s1, cancelled: true });
    const r = await setStatus(db, b.glv, { sessionId: s2, studentId: an.id, status: "absent_unexcused", reason: null });
    expect(r.ok && r.data.warning.level).toBe("watch");
  });

  it("rejects a cancelled session, hidden students, other classes' students and strangers", async () => {
    const { db, b, mk, open } = await setup();
    const an = await mk("An");
    const hidden = await mk("Ẩn", { active: false });
    const [alien] = await db.insert(students).values({ classId: b.otherClassId, fullName: "Lạ" }).returning();
    const sessionId = await open("2026-10-11");
    const call = (studentId: string, user = b.glv) => setStatus(db, user, { sessionId, studentId, status: "present", reason: null });
    expect((await call(hidden.id)).ok).toBe(false);
    expect((await call(alien.id)).ok).toBe(false);
    expect((await call(an.id, b.otherGlv)).ok).toBe(false);
    await setCancelled(db, b.glv, { sessionId, cancelled: true });
    expect(await call(an.id)).toEqual({ ok: false, error: "Buổi này đã được đánh dấu nghỉ lễ" });
  });
});

describe("markAllPresent", () => {
  it("fills only unmarked active students and keeps existing marks", async () => {
    const { db, b, mk, open } = await setup();
    const [an, binh] = [await mk("An"), await mk("Bình")];
    await mk("Ẩn", { active: false });
    const sessionId = await open("2026-10-11");
    await setStatus(db, b.glv, { sessionId, studentId: an.id, status: "absent_unexcused", reason: null });
    const r = await markAllPresent(db, b.glv, { sessionId });
    expect(r).toEqual({ ok: true, data: { marked: 1 } });
    const rows = await db.select().from(attendance).where(and(eq(attendance.sessionId, sessionId), eq(attendance.studentId, binh.id)));
    expect(rows[0].status).toBe("present");
    expect((await db.select().from(attendance)).find((x) => x.studentId === an.id)?.status).toBe("absent_unexcused");
  });
});

describe("readBoard and listSessions", () => {
  it("returns prior unexcused counts from other sessions, hides inactive students", async () => {
    const { db, b, mk, open } = await setup();
    const an = await mk("An");
    await mk("Ẩn", { active: false });
    const s1 = await open("2026-10-04");
    const s2 = await open("2026-10-11");
    await setStatus(db, b.glv, { sessionId: s1, studentId: an.id, status: "absent_unexcused", reason: null });
    await setStatus(db, b.glv, { sessionId: s2, studentId: an.id, status: "absent_unexcused", reason: null });
    const board = await readBoard(db, b.glv, s2);
    expect(board?.students).toHaveLength(1);
    expect(board?.students[0]).toMatchObject({ id: an.id, status: "absent_unexcused", priorUnexcused: 1 });
    expect(board?.canWrite).toBe(true);
  });

  it("is read-only for the grade head and null for outsiders", async () => {
    const { db, b, open } = await setup();
    const sessionId = await open("2026-10-11");
    expect((await readBoard(db, b.head, sessionId))?.canWrite).toBe(false);
    expect(await readBoard(db, b.otherGlv, sessionId)).toBeNull();
    expect(await readBoard(db, b.glv, "not-a-uuid")).toBeNull();
  });

  it("lists sessions newest first with mark counts", async () => {
    const { db, b, mk, open } = await setup();
    const an = await mk("An");
    const s1 = await open("2026-10-04");
    await open("2026-10-11");
    await setStatus(db, b.glv, { sessionId: s1, studentId: an.id, status: "absent_unexcused", reason: null });
    const list = await listSessions(db, b.classId);
    expect(list.map((s) => s.heldOn)).toEqual(["2026-10-11", "2026-10-04"]);
    expect(list[1]).toMatchObject({ marked: 1, absent: 1 });
  });
});
```

- [ ] **Step 6: Chạy để thấy lỗi**

Run: `pnpm test src/server/services/attendance.test.ts`
Expected: FAIL — thiếu module `attendance`.

- [ ] **Step 7: Truy vấn** — `src/db/queries/attendance.ts`

```ts
import { and, asc, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import type { Assignment, Layout } from "@/lib/seating/types";
import type { AttendanceStatus } from "@/lib/attendance/warning";
import { attendance, seatAssignments, seatingPlans, sessions, students, terms } from "../schema";
import type { Db } from "../types";

export async function findTermFor(db: Db, date: string) {
  const [row] = await db
    .select({ id: terms.id, name: terms.name })
    .from(terms)
    .where(and(lte(terms.startsOn, date), gte(terms.endsOn, date)));
  return row ?? null;
}

export async function findSession(db: Db, classId: string, heldOn: string) {
  const [row] = await db.select().from(sessions).where(and(eq(sessions.classId, classId), eq(sessions.heldOn, heldOn)));
  return row ?? null;
}

export async function getSession(db: Db, id: string) {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
  return row ?? null;
}

/** Số buổi vắng không phép của một em trong học kỳ, bỏ qua buổi nghỉ lễ. */
export async function unexcusedCount(db: Db, studentId: string, termId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
    .where(and(
      eq(attendance.studentId, studentId),
      eq(sessions.termId, termId),
      eq(sessions.cancelled, false),
      eq(attendance.status, "absent_unexcused"),
    ));
  return row?.n ?? 0;
}

export function listSessions(db: Db, classId: string, limit = 30) {
  return db
    .select({
      id: sessions.id,
      heldOn: sessions.heldOn,
      cancelled: sessions.cancelled,
      marked: sql<number>`count(${attendance.studentId})::int`,
      absent: sql<number>`(count(*) filter (where ${attendance.status} = 'absent_unexcused'))::int`,
    })
    .from(sessions)
    .leftJoin(attendance, eq(attendance.sessionId, sessions.id))
    .where(eq(sessions.classId, classId))
    .groupBy(sessions.id)
    .orderBy(desc(sessions.heldOn))
    .limit(limit);
}

export interface BoardStudent {
  id: string;
  fullName: string;
  saintName: string | null;
  status: AttendanceStatus | null;
  reason: string | null;
  priorUnexcused: number;
}

export async function loadBoardData(db: Db, session: typeof sessions.$inferSelect) {
  const roster = await db.select().from(students)
    .where(and(eq(students.classId, session.classId), eq(students.active, true)))
    .orderBy(asc(students.fullName));
  const marks = await db.select().from(attendance).where(eq(attendance.sessionId, session.id));
  const prior = await db
    .select({ studentId: attendance.studentId, n: sql<number>`count(*)::int` })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
    .where(and(
      eq(sessions.classId, session.classId),
      eq(sessions.termId, session.termId),
      eq(sessions.cancelled, false),
      ne(sessions.id, session.id),
      eq(attendance.status, "absent_unexcused"),
    ))
    .groupBy(attendance.studentId);

  const markOf = new Map(marks.map((m) => [m.studentId, m]));
  const priorOf = new Map(prior.map((p) => [p.studentId, p.n]));
  const boardStudents: BoardStudent[] = roster.map((s) => ({
    id: s.id,
    fullName: s.fullName,
    saintName: s.saintName,
    status: markOf.get(s.id)?.status ?? null,
    reason: markOf.get(s.id)?.reason ?? null,
    priorUnexcused: priorOf.get(s.id) ?? 0,
  }));

  const [plan] = await db.select().from(seatingPlans)
    .where(and(eq(seatingPlans.classId, session.classId), eq(seatingPlans.isActive, true)));
  let planData: { layout: Layout; assignments: Assignment[] } | null = null;
  if (plan) {
    const rows = await db.select().from(seatAssignments).where(eq(seatAssignments.planId, plan.id));
    planData = {
      layout: plan.layout,
      assignments: rows.map((r) => ({ benchId: r.benchId, seatIndex: r.seatIndex, studentId: r.studentId })),
    };
  }
  return { students: boardStudents, plan: planData };
}
```

- [ ] **Step 8: Service** — `src/server/services/attendance.ts`

```ts
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { findSession, findTermFor, getSession, loadBoardData, unexcusedCount, type BoardStudent } from "@/db/queries/attendance";
import { getStudent } from "@/db/queries/students";
import { attendance, sessions, students } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { evaluateWarningFromCount, type WarningResult } from "@/lib/attendance/warning";
import type { Assignment, Layout } from "@/lib/seating/types";
import { NOT_FOUND, classPermissions, guardClass } from "../guard";
import { fail, ok, type ActionResult } from "../result";

const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Dữ liệu không hợp lệ";
const NOT_FOUND_SESSION = "Không tìm thấy buổi học";
const CANCELLED = "Buổi này đã được đánh dấu nghỉ lễ";
const STATUSES = ["present", "absent_excused", "absent_unexcused", "late"] as const;

export interface Board {
  sessionId: string;
  classId: string;
  heldOn: string;
  cancelled: boolean;
  canWrite: boolean;
  students: BoardStudent[];
  plan: { layout: Layout; assignments: Assignment[] } | null;
}

export async function openSession(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ id: string }>> {
  const p = z.object({ classId: z.string(), heldOn: z.iso.date("Ngày không hợp lệ") }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  if (!(await guardClass(db, user, p.data.classId, "write"))) return fail(NOT_FOUND);
  const term = await findTermFor(db, p.data.heldOn);
  if (!term) return fail("Ngày này không thuộc học kỳ nào");
  await db.insert(sessions).values({ classId: p.data.classId, termId: term.id, heldOn: p.data.heldOn }).onConflictDoNothing();
  const session = await findSession(db, p.data.classId, p.data.heldOn);
  return session ? ok({ id: session.id }) : fail(NOT_FOUND_SESSION);
}

async function loadWritableSession(db: Db, user: AppUser, sessionId: string) {
  if (!z.uuid().safeParse(sessionId).success) return null;
  const session = await getSession(db, sessionId);
  if (!session || !(await guardClass(db, user, session.classId, "write"))) return null;
  return session;
}

export async function setStatus(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ warning: WarningResult }>> {
  const p = z.object({
    sessionId: z.string(),
    studentId: z.string(),
    status: z.enum(STATUSES).nullable(),
    reason: z.string().trim().max(200, "Lý do tối đa 200 ký tự").nullable(),
  }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const session = await loadWritableSession(db, user, p.data.sessionId);
  if (!session) return fail(NOT_FOUND_SESSION);
  if (session.cancelled) return fail(CANCELLED);
  if (!z.uuid().safeParse(p.data.studentId).success) return fail("Không tìm thấy thiếu nhi");
  const student = await getStudent(db, p.data.studentId);
  if (!student || student.classId !== session.classId || !student.active) return fail("Không tìm thấy thiếu nhi");

  if (p.data.status === null) {
    await db.delete(attendance).where(and(eq(attendance.sessionId, session.id), eq(attendance.studentId, student.id)));
  } else {
    const values = { status: p.data.status, reason: p.data.reason || null, updatedBy: user.id, updatedAt: new Date() };
    await db.insert(attendance)
      .values({ sessionId: session.id, studentId: student.id, ...values })
      .onConflictDoUpdate({ target: [attendance.sessionId, attendance.studentId], set: values });
  }
  return ok({ warning: evaluateWarningFromCount(await unexcusedCount(db, student.id, session.termId)) });
}

export async function markAllPresent(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ marked: number }>> {
  const p = z.object({ sessionId: z.string() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const session = await loadWritableSession(db, user, p.data.sessionId);
  if (!session) return fail(NOT_FOUND_SESSION);
  if (session.cancelled) return fail(CANCELLED);
  const roster = await db.select({ id: students.id }).from(students)
    .where(and(eq(students.classId, session.classId), eq(students.active, true)));
  const markedIds = new Set(
    (await db.select({ id: attendance.studentId }).from(attendance).where(eq(attendance.sessionId, session.id))).map((m) => m.id),
  );
  const missing = roster.filter((s) => !markedIds.has(s.id));
  if (missing.length > 0) {
    await db.insert(attendance)
      .values(missing.map((m) => ({ sessionId: session.id, studentId: m.id, status: "present" as const, updatedBy: user.id })))
      .onConflictDoNothing();
  }
  return ok({ marked: missing.length });
}

export async function setCancelled(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = z.object({ sessionId: z.string(), cancelled: z.boolean() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const session = await loadWritableSession(db, user, p.data.sessionId);
  if (!session) return fail(NOT_FOUND_SESSION);
  await db.update(sessions).set({ cancelled: p.data.cancelled }).where(eq(sessions.id, session.id));
  return ok(undefined);
}

export async function readBoard(db: Db, user: AppUser, sessionId: string): Promise<Board | null> {
  if (!z.uuid().safeParse(sessionId).success) return null;
  const session = await getSession(db, sessionId);
  if (!session) return null;
  const perms = await classPermissions(db, user, session.classId);
  if (!perms.canRead) return null;
  const data = await loadBoardData(db, session);
  return {
    sessionId: session.id,
    classId: session.classId,
    heldOn: session.heldOn,
    cancelled: session.cancelled,
    canWrite: perms.canWrite,
    ...data,
  };
}
```

- [ ] **Step 9: Chạy test**

Run: `pnpm test`
Expected: PASS toàn bộ.

- [ ] **Step 10: Commit**

```bash
git add src
git commit -m "feat: add attendance domain logic and services"
```

---

### Task 11: Màn hình điểm danh (sơ đồ + checklist)

**Files:**
- Create: `src/components/attendance/StudentButton.tsx`, `src/components/attendance/StatusSheet.tsx`, `src/app/(app)/lop/[classId]/diem-danh/[date]/page.tsx`, `src/app/(app)/lop/[classId]/diem-danh/[date]/actions.ts`, `src/app/(app)/lop/[classId]/diem-danh/[date]/AttendanceBoard.tsx`, `src/app/(app)/lop/[classId]/OpenDate.tsx`
- Modify: `src/app/(app)/lop/[classId]/page.tsx` (tạo mới nếu chưa có — tab "Điểm danh")

**Interfaces:**
- Consumes: `Board`, `BoardStudent`, `readBoard`, `openSession`, `setStatus`, `markAllPresent`, `setCancelled`, `toggleStatus`, `evaluateWarningFromCount`, `STATUS_LABEL`, `STATUS_CLASS`, `NONE_CLASS`, `SeatMap`, `seatKey`, `shortName`, `todayInVietnam`, `listSessions`, `findSession`.
- Produces: `<AttendanceBoard board={board} />`; actions `setStatusAction(classId, input)`, `markAllPresentAction(classId, input)`, `setCancelledAction(classId, input)`.

- [ ] **Step 1: Server Actions** — `diem-danh/[date]/actions.ts`

```ts
"use server";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import * as attendance from "@/server/services/attendance";

// Không revalidate mỗi lần chạm: client giữ trạng thái lạc quan; các trang thống kê là dynamic nên luôn đọc mới.
export async function setStatusAction(input: unknown) {
  return attendance.setStatus(db, await requireUser(), input);
}
export async function markAllPresentAction(input: unknown) {
  return attendance.markAllPresent(db, await requireUser(), input);
}
export async function setCancelledAction(input: unknown) {
  return attendance.setCancelled(db, await requireUser(), input);
}
```

- [ ] **Step 2: Nút ghế/em** — `src/components/attendance/StudentButton.tsx`

```tsx
"use client";
import { useRef } from "react";
import { NONE_CLASS, STATUS_CLASS, STATUS_LABEL } from "@/lib/attendance/ui";
import type { AttendanceStatus, WarningLevel } from "@/lib/attendance/warning";
import { shortName } from "@/lib/students/short-name";

interface Props {
  fullName: string;
  status: AttendanceStatus | null;
  warning: WarningLevel;
  failed?: boolean;
  disabled?: boolean;
  onTap: () => void;
  onLongPress: () => void;
}

const LONG_MS = 500;

export function StudentButton({ fullName, status, warning, failed, disabled, onTap, onLongPress }: Props) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fired = useRef(false);
  const stop = () => clearTimeout(timer.current);
  return (
    <button
      disabled={disabled}
      aria-label={`${fullName}: ${status ? STATUS_LABEL[status] : "chưa điểm danh"}`}
      onPointerDown={() => { fired.current = false; timer.current = setTimeout(() => { fired.current = true; onLongPress(); }, LONG_MS); }}
      onPointerUp={() => { stop(); if (!fired.current) onTap(); }}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative flex h-16 w-16 touch-manipulation select-none items-center justify-center rounded-xl border-2 text-xs font-semibold ${status ? STATUS_CLASS[status] : NONE_CLASS} ${failed ? "ring-2 ring-warn-alert ring-offset-2" : ""}`}
    >
      {shortName(fullName)}
      {warning !== "none" && (
        <span aria-label={warning === "warning" ? "Cảnh báo vắng" : "Đã vắng 1 buổi"}
          className={`absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card text-[10px] font-bold text-white ${warning === "warning" ? "bg-warn-alert" : "bg-warn-watch"}`}>
          {warning === "warning" ? "!" : "1"}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 3: Bảng chọn trạng thái** — `src/components/attendance/StatusSheet.tsx`

```tsx
"use client";
import { useState } from "react";
import { STATUS_CLASS, STATUS_LABEL } from "@/lib/attendance/ui";
import type { AttendanceStatus } from "@/lib/attendance/warning";

const ORDER: AttendanceStatus[] = ["present", "late", "absent_excused", "absent_unexcused"];

interface Props {
  name: string;
  current: AttendanceStatus | null;
  reason: string | null;
  onPick: (status: AttendanceStatus | null, reason: string | null) => void;
  onClose: () => void;
}

export function StatusSheet({ name, current, reason, onPick, onClose }: Props) {
  const [text, setText] = useState(reason ?? "");
  return (
    <div role="dialog" aria-label={`Điểm danh ${name}`} className="fixed inset-x-0 bottom-0 z-30 rounded-t-3xl border-t border-line bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <h2 className="text-lg font-semibold">{name}</h2>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Lý do (không bắt buộc)" maxLength={200}
          className="h-12 rounded-xl border border-line px-4" />
        <div className="grid grid-cols-2 gap-2">
          {ORDER.map((s) => (
            <button key={s} onClick={() => onPick(s, text.trim() || null)} aria-pressed={current === s}
              className={`h-12 rounded-xl border-2 text-sm font-semibold ${current === s ? STATUS_CLASS[s] : "border-line bg-paper"}`}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <button onClick={() => onPick(null, null)} className="h-12 rounded-xl border border-line text-sm">Bỏ điểm danh (chưa điểm danh)</button>
        <button onClick={onClose} className="h-12 rounded-xl text-sm text-ink-soft">Đóng</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Bảng điểm danh** — `diem-danh/[date]/AttendanceBoard.tsx`

```tsx
"use client";
import { useMemo, useState } from "react";
import { SeatMap } from "@/components/seating/SeatMap";
import { StatusSheet } from "@/components/attendance/StatusSheet";
import { StudentButton } from "@/components/attendance/StudentButton";
import { toggleStatus } from "@/lib/attendance/toggle";
import { STATUS_LABEL } from "@/lib/attendance/ui";
import { evaluateWarningFromCount, type AttendanceStatus } from "@/lib/attendance/warning";
import { seatKey } from "@/lib/seating/assignments";
import type { Board } from "@/server/services/attendance";
import { markAllPresentAction, setCancelledAction, setStatusAction } from "./actions";

type Mark = { status: AttendanceStatus; reason: string | null } | null;

export function AttendanceBoard({ board }: { board: Board }) {
  const [marks, setMarks] = useState<Record<string, Mark>>(() =>
    Object.fromEntries(board.students.map((s) => [s.id, s.status ? { status: s.status, reason: s.reason } : null])),
  );
  const [mode, setMode] = useState<"map" | "list">(board.plan ? "map" : "list");
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(board.cancelled);
  const readOnly = !board.canWrite || cancelled;

  const byId = useMemo(() => new Map(board.students.map((s) => [s.id, s])), [board.students]);
  const levelOf = (id: string) =>
    evaluateWarningFromCount((byId.get(id)?.priorUnexcused ?? 0) + (marks[id]?.status === "absent_unexcused" ? 1 : 0)).level;
  const markedCount = Object.values(marks).filter(Boolean).length;

  async function save(studentId: string, next: Mark) {
    const previous = marks[studentId];
    setMarks((m) => ({ ...m, [studentId]: next }));
    setError(null);
    setFailedId(null);
    const result = await setStatusAction({ sessionId: board.sessionId, studentId, status: next?.status ?? null, reason: next?.reason ?? null });
    if (!result.ok) {
      setMarks((m) => ({ ...m, [studentId]: previous }));
      setFailedId(studentId);
      setError(`Chưa lưu được cho ${byId.get(studentId)?.fullName}. Chạm lại để thử.`);
    }
  }

  const tap = (id: string) => { if (!readOnly) void save(id, { status: toggleStatus(marks[id]?.status ?? null), reason: null }); };

  async function markAll() {
    const result = await markAllPresentAction({ sessionId: board.sessionId });
    if (!result.ok) { setError(result.error); return; }
    setMarks((m) => Object.fromEntries(Object.entries(m).map(([id, v]) => [id, v ?? { status: "present" as const, reason: null }])));
  }

  async function toggleCancelled(value: boolean) {
    const result = await setCancelledAction({ sessionId: board.sessionId, cancelled: value });
    if (result.ok) setCancelled(value); else setError(result.error);
  }

  const button = (id: string) => (
    <StudentButton fullName={byId.get(id)!.fullName} status={marks[id]?.status ?? null} warning={levelOf(id)}
      failed={failedId === id} disabled={readOnly} onTap={() => tap(id)} onLongPress={() => !readOnly && setSheetFor(id)} />
  );

  const seatOf = new Map(board.plan?.assignments.map((a) => [seatKey(a), a.studentId]) ?? []);
  const seated = new Set(board.plan?.assignments.map((a) => a.studentId));
  const unseated = board.students.filter((s) => !seated.has(s.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium" aria-live="polite">Đã điểm danh {markedCount}/{board.students.length}</p>
        {board.canWrite && !cancelled && (
          <button onClick={markAll} className="h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-white">Tất cả có mặt</button>
        )}
      </div>
      {cancelled && <p role="status" className="rounded-xl bg-paper p-3 text-sm">Buổi nghỉ lễ — không tính vào thống kê.</p>}
      {board.canWrite && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cancelled} onChange={(e) => toggleCancelled(e.target.checked)} className="h-5 w-5" /> Buổi nghỉ lễ
        </label>
      )}
      {error && <p role="alert" className="text-sm text-warn-alert">{error}</p>}

      <div role="tablist" className="flex gap-2">
        {(["map", "list"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
            disabled={m === "map" && !board.plan}
            className={`h-11 rounded-lg border border-line px-4 text-sm font-medium disabled:opacity-40 ${mode === m ? "bg-brand text-white" : "bg-card"}`}>
            {m === "map" ? "Sơ đồ" : "Checklist"}
          </button>
        ))}
      </div>

      {mode === "map" && board.plan ? (
        <>
          <SeatMap layout={board.plan.layout} renderSeat={(seat) => {
            const id = seatOf.get(seatKey(seat));
            return id ? button(id) : <div aria-hidden className="h-16 w-16 rounded-xl border border-dashed border-line opacity-50" />;
          }} />
          {unseated.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-ink-soft">Chưa xếp chỗ</h2>
              <div className="flex flex-wrap gap-2">{unseated.map((s) => <div key={s.id}>{button(s.id)}</div>)}</div>
            </div>
          )}
        </>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-card">
          {board.students.map((s) => (
            <li key={s.id} className="flex min-h-14 items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-medium">{s.saintName ? `${s.saintName} ` : ""}{s.fullName}</span>
              <span className="flex gap-1">
                <button disabled={readOnly} aria-pressed={marks[s.id]?.status === "present"} onClick={() => save(s.id, { status: "present", reason: null })}
                  className={`h-11 rounded-lg border px-3 text-sm ${marks[s.id]?.status === "present" ? "border-st-present bg-st-present text-white" : "border-line"}`}>Có</button>
                <button disabled={readOnly} aria-pressed={marks[s.id]?.status === "absent_unexcused"} onClick={() => save(s.id, { status: "absent_unexcused", reason: null })}
                  className={`h-11 rounded-lg border px-3 text-sm ${marks[s.id]?.status === "absent_unexcused" ? "border-st-unexcused bg-st-unexcused text-white" : "border-line"}`}>Vắng</button>
                <button disabled={readOnly} aria-label={`Thêm lựa chọn cho ${s.fullName}`} onClick={() => setSheetFor(s.id)}
                  className="h-11 w-11 rounded-lg border border-line text-lg">⋯</button>
              </span>
              {levelOf(s.id) !== "none" && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold text-white ${levelOf(s.id) === "warning" ? "bg-warn-alert" : "bg-warn-watch"}`}>
                  {levelOf(s.id) === "warning" ? "Cảnh báo" : "Vắng 1"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {sheetFor && (
        <StatusSheet name={byId.get(sheetFor)!.fullName} current={marks[sheetFor]?.status ?? null} reason={marks[sheetFor]?.reason ?? null}
          onClose={() => setSheetFor(null)}
          onPick={(status, reason) => { const id = sheetFor; setSheetFor(null); void save(id, status ? { status, reason } : null); }} />
      )}
      <p className="sr-only">{Object.values(STATUS_LABEL).join(", ")}</p>
    </div>
  );
}
```

- [ ] **Step 5: Trang điểm danh** — `diem-danh/[date]/page.tsx`

```tsx
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { findSession } from "@/db/queries/attendance";
import { requireUser } from "@/lib/auth/dal";
import { classPermissions } from "@/server/guard";
import { openSession, readBoard } from "@/server/services/attendance";
import { AttendanceBoard } from "./AttendanceBoard";

export default async function AttendancePage({ params }: { params: Promise<{ classId: string; date: string }> }) {
  const { classId, date } = await params;
  if (!z.iso.date().safeParse(date).success) notFound();
  const user = await requireUser();
  const perms = await classPermissions(db, user, classId);
  if (!perms.canRead) notFound();

  let sessionId: string;
  if (perms.canWrite) {
    // Mở buổi là idempotent (một buổi/lớp/ngày), nên an toàn khi gọi lúc render.
    const opened = await openSession(db, user, { classId, heldOn: date });
    if (!opened.ok) return <p role="alert" className="text-warn-alert">{opened.error}</p>;
    sessionId = opened.data.id;
  } else {
    const existing = await findSession(db, classId, date);
    if (!existing) return <p className="text-ink-soft">Chưa có buổi điểm danh ngày {date}.</p>;
    sessionId = existing.id;
  }
  const board = await readBoard(db, user, sessionId);
  if (!board) notFound();
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Buổi ngày {date}</h2>
      <AttendanceBoard board={board} />
    </section>
  );
}
```

- [ ] **Step 6: Tab "Điểm danh" của lớp** — `src/app/(app)/lop/[classId]/OpenDate.tsx`

```tsx
"use client";
import { useRouter } from "next/navigation";

export function OpenDate({ classId, today }: { classId: string; today: string }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm">
      Điểm danh bù ngày
      <input type="date" max={today} onChange={(e) => e.target.value && router.push(`/lop/${classId}/diem-danh/${e.target.value}`)}
        className="h-11 rounded-lg border border-line bg-card px-3" />
    </label>
  );
}
```

`src/app/(app)/lop/[classId]/page.tsx`

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { listSessions } from "@/db/queries/attendance";
import { requireUser } from "@/lib/auth/dal";
import { todayInVietnam } from "@/lib/dates";
import { classPermissions } from "@/server/guard";
import { OpenDate } from "./OpenDate";

export default async function ClassHomePage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const user = await requireUser();
  const perms = await classPermissions(db, user, classId);
  if (!perms.canRead) notFound();
  const today = todayInVietnam();
  const sessions = await listSessions(db, classId);
  return (
    <section className="flex flex-col gap-4">
      {perms.canWrite && (
        <>
          {/* prefetch={false}: mở buổi tạo bản ghi, không được chạy khi chỉ prefetch */}
          <Link prefetch={false} href={`/lop/${classId}/diem-danh/${today}`}
            className="flex h-14 items-center justify-center rounded-2xl bg-brand text-lg font-semibold text-white">
            Điểm danh hôm nay
          </Link>
          <OpenDate classId={classId} today={today} />
        </>
      )}
      <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-card">
        {sessions.length === 0 && <li className="p-4 text-ink-soft">Chưa có buổi nào.</li>}
        {sessions.map((s) => (
          <li key={s.id}>
            <Link prefetch={false} href={`/lop/${classId}/diem-danh/${s.heldOn}`} className="flex min-h-14 items-center justify-between px-4 py-2">
              <span className="font-medium">{s.heldOn}{s.cancelled ? " · nghỉ lễ" : ""}</span>
              <span className="text-sm text-ink-soft">{s.marked} đã điểm danh · {s.absent} vắng KP</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 7: Cổng chất lượng Mốc 4**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint`
Expected: pass. Thủ công ở 375px (cần `.env.local`): tạo lớp + vài em + sơ đồ → "Điểm danh hôm nay" → "Tất cả có mặt" → chạm một ghế thành vắng (viền/ghế đỏ), chạm lại về có mặt; nhấn giữ mở bảng chọn; chuyển sang Checklist thấy cùng trạng thái; bật "Buổi nghỉ lễ" khóa thao tác. Chạy agent **code-reviewer** và **security-reviewer** (quyền ghi điểm danh); sửa mọi CRITICAL/HIGH.

- [ ] **Step 8: Commit**

```bash
git add src
git commit -m "feat: add attendance screen with seat map and checklist modes"
```

---

## Mốc 5 — Thống kê, Cần chú ý, Khối, xuất Excel

### Task 12: Thống kê, cảnh báo, tổng quan khối, xuất Excel

**Files:**
- Create: `src/db/queries/stats.ts`, `src/server/services/stats.ts`, `src/server/services/stats.test.ts`, `src/lib/export/excel.ts`, `src/lib/export/excel.test.ts`, `src/app/(app)/lop/[classId]/thong-ke/page.tsx`, `src/app/(app)/lop/[classId]/thong-ke/export/route.ts`, `src/app/(app)/can-chu-y/page.tsx`
- Modify: `src/app/(app)/khoi/page.tsx`, `src/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `summarize`, `StudentSummary`, `AppUser`, `guardClass`, `listClassesForUser`, bảng `students/attendance/sessions/terms/classes`.
- Produces:
  - queries: `listTerms(db)`, `resolveTerm(db, termId: string | undefined, today: string): Promise<{ id; name; startsOn; endsOn } | null>` (ưu tiên `termId` hợp lệ → học kỳ chứa `today` → học kỳ mới nhất), `rosterOf(db, classIds)`, `termRecords(db, classIds, termId)`, `sessionsHeld(db, classIds, termId): Promise<Map<string, number>>`, `classesInGrade(db, gradeId)`
  - `interface StatRow { studentId: string; classId: string; fullName: string; saintName: string | null; summary: StudentSummary }`
  - `classStats(db, user, classId, termId): Promise<{ term: { id: string; name: string }; className: string; rows: StatRow[] } | null>` (null nếu không có quyền đọc, học kỳ không tồn tại)
  - `interface AttentionItem { classId: string; className: string; studentId: string; fullName: string; level: "watch" | "warning"; unexcused: number }`; `attentionList(db, user, termId): Promise<AttentionItem[]>` (warning trước, rồi số buổi vắng giảm dần, rồi tên lớp, tên em)
  - `interface GradeRow { classId: string; className: string; studentCount: number; sessions: number; presentRate: number | null; warningCount: number }`; `gradeOverview(db, user, termId): Promise<GradeRow[] | null>` (null nếu không phải trưởng khối)
  - `safeCell(value: string): string`; `buildStatsWorkbook(input: { className: string; termName: string; rows: StatRow[] }): Promise<Buffer>`

- [ ] **Step 1: Viết test lỗi** — `src/lib/export/excel.test.ts`

```ts
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { summarize } from "@/lib/attendance/summary";
import { buildStatsWorkbook, safeCell } from "./excel";

describe("safeCell", () => {
  it("neutralises spreadsheet formulas", () => {
    for (const v of ["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tx", "\rx"]) expect(safeCell(v)).toBe(`'${v}`);
  });
  it("leaves ordinary names alone", () => {
    expect(safeCell("Nguyễn Văn An")).toBe("Nguyễn Văn An");
    expect(safeCell("")).toBe("");
  });
});

describe("buildStatsWorkbook", () => {
  it("writes a header, one row per student and sanitises text cells", async () => {
    const rows = [
      { studentId: "1", classId: "c", fullName: "=HYPERLINK(\"http://x\")", saintName: "Phêrô", summary: summarize([{ status: "present" }, { status: "absent_unexcused" }, { status: "absent_unexcused" }]) },
      { studentId: "2", classId: "c", fullName: "Trần Bình", saintName: null, summary: summarize([]) },
    ];
    const buffer = await buildStatsWorkbook({ className: "Lớp A/B?", termName: "Học kỳ 1", rows });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe("Lớp A B");
    expect(ws.getRow(1).values).toContain("Họ tên");
    expect(ws.getRow(2).getCell(3).value).toBe("'=HYPERLINK(\"http://x\")");
    expect(ws.getRow(2).getCell(7).value).toBe(2); // vắng không phép
    expect(ws.getRow(2).getCell(8).value).toBe("Cảnh báo");
    expect(ws.getRow(3).getCell(8).value ?? "").toBe("");
  });
});
```

`src/server/services/stats.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { attendance, sessions, students } from "@/db/schema";
import type { Db } from "@/db/types";
import { createTestDb } from "@/test/db";
import { seedBasics, type Basics } from "@/test/fixtures";
import { attentionList, classStats, gradeOverview } from "./stats";

type Status = "present" | "absent_excused" | "absent_unexcused" | "late";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const kid = async (fullName: string, extra: Partial<typeof students.$inferInsert> = {}, classId = b.classId) =>
    (await db.insert(students).values({ classId, fullName, ...extra }).returning())[0];
  const session = async (heldOn: string, extra: { cancelled?: boolean; classId?: string } = {}) =>
    (await db.insert(sessions).values({ classId: extra.classId ?? b.classId, termId: b.termId, heldOn, cancelled: extra.cancelled ?? false }).returning())[0];
  const mark = (sessionId: string, studentId: string, status: Status) => db.insert(attendance).values({ sessionId, studentId, status });
  return { db, b, kid, session, mark };
}

describe("classStats", () => {
  it("summarises each active student for the term and flags warnings", async () => {
    const { db, b, kid, session, mark } = await setup();
    const [an, binh] = [await kid("An"), await kid("Bình")];
    const [s1, s2, s3] = [await session("2026-10-04"), await session("2026-10-11"), await session("2026-10-18")];
    await mark(s1.id, an.id, "absent_unexcused"); await mark(s2.id, an.id, "absent_unexcused"); await mark(s3.id, an.id, "present");
    await mark(s1.id, binh.id, "absent_excused"); await mark(s2.id, binh.id, "late");
    const stats = await classStats(db, b.glv, b.classId, b.termId);
    const an1 = stats!.rows.find((r) => r.studentId === an.id)!;
    expect(an1.summary).toMatchObject({ present: 1, unexcused: 2, marked: 3 });
    expect(an1.summary.warning.level).toBe("warning");
    expect(stats!.rows.find((r) => r.studentId === binh.id)!.summary.warning.level).toBe("none");
    expect(stats!.className).toBe("Lớp A");
  });

  it("ignores cancelled sessions and hidden students", async () => {
    const { db, b, kid, session, mark } = await setup();
    const an = await kid("An");
    const hidden = await kid("Ẩn", { active: false });
    const s1 = await session("2026-10-04", { cancelled: true });
    await mark(s1.id, an.id, "absent_unexcused"); await mark(s1.id, hidden.id, "absent_unexcused");
    const stats = await classStats(db, b.glv, b.classId, b.termId);
    expect(stats!.rows.map((r) => r.studentId)).toEqual([an.id]);
    expect(stats!.rows[0].summary.unexcused).toBe(0);
  });

  it("is readable by the grade head, null for outsiders and unknown terms", async () => {
    const { db, b } = await setup();
    expect(await classStats(db, b.head, b.classId, b.termId)).not.toBeNull();
    expect(await classStats(db, b.otherGlv, b.classId, b.termId)).toBeNull();
    expect(await classStats(db, b.glv, b.classId, "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await classStats(db, b.glv, b.classId, "bad")).toBeNull();
  });
});

describe("attentionList", () => {
  async function scenario() {
    const s = await setup();
    const { b, kid, session, mark } = s;
    const [an, binh, chi] = [await kid("An"), await kid("Bình"), await kid("Chi")];
    const other = await kid("Dũng", {}, b.otherClassId);
    const [s1, s2] = [await session("2026-10-04"), await session("2026-10-11")];
    const o1 = await session("2026-10-04", { classId: b.otherClassId });
    await mark(s1.id, an.id, "absent_unexcused");
    await mark(s1.id, binh.id, "absent_unexcused"); await mark(s2.id, binh.id, "absent_unexcused");
    await mark(s1.id, chi.id, "absent_excused");
    await mark(o1.id, other.id, "absent_unexcused");
    return { ...s, an, binh, chi, other };
  }

  it("lists watch and warning students, warnings first, never students without unexcused absences", async () => {
    const { db, b, an, binh } = await scenario();
    const list = await attentionList(db, b.glv, b.termId);
    expect(list.map((i) => [i.studentId, i.level])).toEqual([[binh.id, "warning"], [an.id, "watch"]]);
  });

  it("only shows classes the user can read; the head sees the whole grade", async () => {
    const { db, b, other } = await scenario();
    expect((await attentionList(db, b.glv, b.termId)).some((i) => i.studentId === other.id)).toBe(false);
    expect((await attentionList(db, b.otherGlv, b.termId)).map((i) => i.studentId)).toEqual([other.id]);
    const head = await attentionList(db, b.head, b.termId);
    expect(head.map((i) => i.className)).toEqual(["Lớp A", "Lớp A"]);
  });
});

describe("gradeOverview", () => {
  it("is only for grade heads", async () => {
    const { db, b } = await setup();
    expect(await gradeOverview(db, b.glv, b.termId)).toBeNull();
  });

  it("reports students, sessions held, presence rate and warnings per class of the grade", async () => {
    const { db, b, kid, session, mark } = await setup();
    const [an, binh] = [await kid("An"), await kid("Bình")];
    const [s1, s2] = [await session("2026-10-04"), await session("2026-10-11")];
    await session("2026-10-18", { cancelled: true });
    await mark(s1.id, an.id, "present"); await mark(s1.id, binh.id, "absent_unexcused");
    await mark(s2.id, an.id, "late"); await mark(s2.id, binh.id, "absent_unexcused");
    const rows = await gradeOverview(db, b.head, b.termId);
    expect(rows).toEqual([{ classId: b.classId, className: "Lớp A", studentCount: 2, sessions: 2, presentRate: 0.5, warningCount: 1 }]);
  });

  it("gives a null presence rate when nothing was marked", async () => {
    const { db, b } = await setup();
    expect((await gradeOverview(db, b.head, b.termId))![0].presentRate).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy để thấy lỗi**

Run: `pnpm test src/lib/export src/server/services/stats.test.ts`
Expected: FAIL — thiếu module `excel`, `stats`.

- [ ] **Step 3: Truy vấn** — `src/db/queries/stats.ts`

```ts
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { attendance, classes, sessions, students, terms } from "../schema";
import type { Db } from "../types";

export const listTerms = (db: Db) => db.select().from(terms).orderBy(desc(terms.startsOn));

export async function resolveTerm(db: Db, termId: string | undefined, today: string) {
  const all = await listTerms(db);
  return all.find((t) => t.id === termId) ?? all.find((t) => t.startsOn <= today && today <= t.endsOn) ?? all[0] ?? null;
}

export async function rosterOf(db: Db, classIds: string[]) {
  if (classIds.length === 0) return [];
  return db.select().from(students)
    .where(and(inArray(students.classId, classIds), eq(students.active, true)))
    .orderBy(asc(students.fullName));
}

export async function termRecords(db: Db, classIds: string[], termId: string) {
  if (classIds.length === 0) return [];
  return db
    .select({ studentId: attendance.studentId, status: attendance.status })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
    .where(and(inArray(sessions.classId, classIds), eq(sessions.termId, termId), eq(sessions.cancelled, false)));
}

export async function sessionsHeld(db: Db, classIds: string[], termId: string): Promise<Map<string, number>> {
  if (classIds.length === 0) return new Map();
  const rows = await db
    .select({ classId: sessions.classId, n: sql<number>`count(*)::int` })
    .from(sessions)
    .where(and(inArray(sessions.classId, classIds), eq(sessions.termId, termId), eq(sessions.cancelled, false)))
    .groupBy(sessions.classId);
  return new Map(rows.map((r) => [r.classId, r.n]));
}

export const classesInGrade = (db: Db, gradeId: string) =>
  db.select().from(classes).where(eq(classes.gradeId, gradeId)).orderBy(asc(classes.name));
```

Lưu ý: `termRecords` ở trên không trả `classId` của em; để gom theo em ta cần `studentId` là đủ vì mỗi em thuộc đúng một lớp.

- [ ] **Step 4: Service** — `src/server/services/stats.ts`

```ts
import { z } from "zod";
import { getClassById, listClassesForUser } from "@/db/queries/classes";
import { classesInGrade, listTerms, rosterOf, sessionsHeld, termRecords } from "@/db/queries/stats";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { summarize, type StudentSummary } from "@/lib/attendance/summary";
import type { AttendanceStatus } from "@/lib/attendance/warning";
import { guardClass } from "../guard";

export interface StatRow {
  studentId: string;
  classId: string;
  fullName: string;
  saintName: string | null;
  summary: StudentSummary;
}

type Roster = Awaited<ReturnType<typeof rosterOf>>;

function buildRows(roster: Roster, records: { studentId: string; status: AttendanceStatus }[]): StatRow[] {
  const byStudent = new Map<string, { status: AttendanceStatus }[]>();
  for (const r of records) byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), { status: r.status }]);
  return roster.map((s) => ({
    studentId: s.id, classId: s.classId, fullName: s.fullName, saintName: s.saintName,
    summary: summarize(byStudent.get(s.id) ?? []),
  }));
}

async function termOf(db: Db, termId: string) {
  if (!z.uuid().safeParse(termId).success) return null;
  return (await listTerms(db)).find((t) => t.id === termId) ?? null;
}

export async function classStats(db: Db, user: AppUser, classId: string, termId: string) {
  if (!(await guardClass(db, user, classId, "read"))) return null;
  const term = await termOf(db, termId);
  const cls = await getClassById(db, classId);
  if (!term || !cls) return null;
  const [roster, records] = await Promise.all([rosterOf(db, [classId]), termRecords(db, [classId], term.id)]);
  return { term: { id: term.id, name: term.name }, className: cls.name, rows: buildRows(roster, records) };
}

export interface AttentionItem {
  classId: string;
  className: string;
  studentId: string;
  fullName: string;
  level: "watch" | "warning";
  unexcused: number;
}

export async function attentionList(db: Db, user: AppUser, termId: string): Promise<AttentionItem[]> {
  const term = await termOf(db, termId);
  if (!term) return [];
  const visible = await listClassesForUser(db, user);
  const ids = visible.map((c) => c.id);
  const names = new Map(visible.map((c) => [c.id, c.name]));
  const [roster, records] = await Promise.all([rosterOf(db, ids), termRecords(db, ids, term.id)]);
  return buildRows(roster, records)
    .filter((r) => r.summary.warning.level !== "none")
    .map((r) => ({
      classId: r.classId, className: names.get(r.classId) ?? "", studentId: r.studentId, fullName: r.fullName,
      level: r.summary.warning.level as "watch" | "warning", unexcused: r.summary.unexcused,
    }))
    .sort((a, b) =>
      Number(b.level === "warning") - Number(a.level === "warning") ||
      b.unexcused - a.unexcused ||
      a.className.localeCompare(b.className, "vi") ||
      a.fullName.localeCompare(b.fullName, "vi"));
}

export interface GradeRow {
  classId: string;
  className: string;
  studentCount: number;
  sessions: number;
  presentRate: number | null;
  warningCount: number;
}

export async function gradeOverview(db: Db, user: AppUser, termId: string): Promise<GradeRow[] | null> {
  if (!user.isGradeHead || !user.gradeId) return null;
  const term = await termOf(db, termId);
  const classList = await classesInGrade(db, user.gradeId);
  const ids = classList.map((c) => c.id);
  if (!term) return classList.map((c) => ({ classId: c.id, className: c.name, studentCount: 0, sessions: 0, presentRate: null, warningCount: 0 }));
  const [roster, records, held] = await Promise.all([rosterOf(db, ids), termRecords(db, ids, term.id), sessionsHeld(db, ids, term.id)]);
  const rows = buildRows(roster, records);
  return classList.map((c) => {
    const mine = rows.filter((r) => r.classId === c.id);
    const marked = mine.reduce((n, r) => n + r.summary.marked, 0);
    const here = mine.reduce((n, r) => n + r.summary.present + r.summary.late, 0);
    return {
      classId: c.id, className: c.name, studentCount: mine.length, sessions: held.get(c.id) ?? 0,
      presentRate: marked === 0 ? null : here / marked,
      warningCount: mine.filter((r) => r.summary.warning.level === "warning").length,
    };
  });
}
```

`src/lib/export/excel.ts`

```ts
import ExcelJS from "exceljs";
import type { StatRow } from "@/server/services/stats";

const FORMULA_START = /^[=+\-@\t\r]/;

/** Chống CSV/Excel formula injection: ô văn bản bắt đầu bằng = + - @ được chèn dấu nháy đơn. */
export function safeCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

const sheetName = (name: string) => name.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Thống kê";

const LEVEL_LABEL = { none: "", watch: "Cần chú ý", warning: "Cảnh báo" } as const;

export async function buildStatsWorkbook(input: { className: string; termName: string; rows: StatRow[] }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName(input.className));
  ws.addRow(["STT", "Tên thánh", "Họ tên", "Có mặt", "Đi muộn", "Vắng có phép", "Vắng không phép", "Cảnh báo"]);
  ws.getRow(1).font = { bold: true };
  input.rows.forEach((r, i) => {
    const s = r.summary;
    ws.addRow([i + 1, safeCell(r.saintName ?? ""), safeCell(r.fullName), s.present, s.late, s.excused, s.unexcused, LEVEL_LABEL[s.warning.level]]);
  });
  [6, 14, 28, 10, 10, 14, 18, 12].forEach((width, i) => { ws.getColumn(i + 1).width = width; });
  ws.getCell("J1").value = safeCell(`${input.className} — ${input.termName}`);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
```

Kiểm tra cột trong test: STT=1, Tên thánh=2, Họ tên=3, Có mặt=4, Đi muộn=5, Vắng có phép=6, Vắng không phép=7, Cảnh báo=8 — khớp `getCell(3)`, `getCell(7)`, `getCell(8)` ở test.

- [ ] **Step 5: Chạy test**

Run: `pnpm test src/lib/export src/server/services/stats.test.ts`
Expected: PASS.

- [ ] **Step 6: Trang thống kê** — `thong-ke/page.tsx`

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { listTerms, resolveTerm } from "@/db/queries/stats";
import { requireUser } from "@/lib/auth/dal";
import { todayInVietnam } from "@/lib/dates";
import { classStats } from "@/server/services/stats";

export default async function StatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<{ termId?: string }>;
}) {
  const { classId } = await params;
  const { termId } = await searchParams;
  const user = await requireUser();
  const term = await resolveTerm(db, termId, todayInVietnam());
  if (!term) return <p className="text-ink-soft">Chưa có học kỳ nào.</p>;
  const stats = await classStats(db, user, classId, term.id);
  if (!stats) notFound();
  const terms = await listTerms(db);
  const badge = (level: string) =>
    level === "warning" ? "bg-warn-alert text-white" : level === "watch" ? "bg-warn-watch text-white" : "";
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap gap-2" aria-label="Học kỳ">
          {terms.map((t) => (
            <Link key={t.id} href={`?termId=${t.id}`}
              className={`flex h-11 items-center rounded-full border px-4 text-sm ${t.id === term.id ? "border-brand bg-brand text-white" : "border-line bg-card"}`}>
              {t.name}
            </Link>
          ))}
        </nav>
        <a href={`/lop/${classId}/thong-ke/export?termId=${term.id}`} className="flex h-11 items-center rounded-lg border border-line bg-card px-4 text-sm font-medium">Xuất Excel</a>
      </div>
      <div className="overflow-hidden rounded-2xl border border-line bg-card">
        <div className="grid grid-cols-[1fr_repeat(4,2.25rem)_5.5rem] items-center gap-x-1 border-b border-line px-3 py-2 text-xs font-semibold text-ink-soft">
          <span>Em</span><span title="Có mặt">CM</span><span title="Đi muộn">M</span><span title="Vắng có phép">CP</span><span title="Vắng không phép">KP</span><span />
        </div>
        <ul className="divide-y divide-line">
          {stats.rows.map((r) => (
            <li key={r.studentId} className="grid min-h-12 grid-cols-[1fr_repeat(4,2.25rem)_5.5rem] items-center gap-x-1 px-3 py-2 text-sm">
              <span className="truncate font-medium">{r.fullName}</span>
              <span>{r.summary.present}</span><span>{r.summary.late}</span><span>{r.summary.excused}</span><span>{r.summary.unexcused}</span>
              <span className={`rounded-full px-2 py-0.5 text-center text-xs font-semibold ${badge(r.summary.warning.level)}`}>
                {r.summary.warning.level === "warning" ? "Cảnh báo" : r.summary.warning.level === "watch" ? "Vắng 1" : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

`thong-ke/export/route.ts`

```ts
import { db } from "@/db/client";
import { resolveTerm } from "@/db/queries/stats";
import { getCurrentUser } from "@/lib/auth/dal";
import { todayInVietnam } from "@/lib/dates";
import { buildStatsWorkbook } from "@/lib/export/excel";
import { classStats } from "@/server/services/stats";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET(request: Request, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const term = await resolveTerm(db, new URL(request.url).searchParams.get("termId") ?? undefined, todayInVietnam());
  const stats = term ? await classStats(db, user, classId, term.id) : null;
  if (!stats) return new Response("Not found", { status: 404 });
  const buffer = await buildStatsWorkbook({ className: stats.className, termName: stats.term.name, rows: stats.rows });
  const filename = `diem-danh-${stats.className}-${stats.term.name}.xlsx`.replace(/[^\p{L}\p{N}._-]+/gu, "-");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": XLSX,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
```

- [ ] **Step 7: Trang "Cần chú ý"** — `src/app/(app)/can-chu-y/page.tsx`

```tsx
import Link from "next/link";
import { db } from "@/db/client";
import { resolveTerm } from "@/db/queries/stats";
import { requireUser } from "@/lib/auth/dal";
import { todayInVietnam } from "@/lib/dates";
import { attentionList } from "@/server/services/stats";

export default async function AttentionPage() {
  const user = await requireUser();
  const term = await resolveTerm(db, undefined, todayInVietnam());
  const items = term ? await attentionList(db, user, term.id) : [];
  const groups = Map.groupBy(items, (i) => i.classId);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Cần chú ý</h1>
      <p className="text-sm text-ink-soft">{term?.name ?? "Chưa có học kỳ"} · vắng không phép từ 2 buổi là cảnh báo.</p>
      {items.length === 0 && <p className="rounded-2xl border border-line bg-card p-4">Chưa có em nào cần chú ý. 🎉</p>}
      {[...groups.values()].map((list) => (
        <div key={list[0].classId} className="rounded-2xl border border-line bg-card">
          <Link href={`/lop/${list[0].classId}/thong-ke`} className="block border-b border-line px-4 py-3 font-semibold">{list[0].className}</Link>
          <ul className="divide-y divide-line">
            {list.map((i) => (
              <li key={i.studentId} className="flex min-h-12 items-center justify-between px-4 py-2">
                <span className="font-medium">{i.fullName}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold text-white ${i.level === "warning" ? "bg-warn-alert" : "bg-warn-watch"}`}>
                  {i.level === "warning" ? `Cảnh báo · ${i.unexcused} buổi` : "Vắng 1 buổi"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 8: Tổng quan khối và số em cần chú ý trên trang chủ**

Trong `src/app/(app)/khoi/page.tsx`, thêm phía trên danh sách lớp hiện có:

```tsx
import { resolveTerm } from "@/db/queries/stats";
import { todayInVietnam } from "@/lib/dates";
import { gradeOverview } from "@/server/services/stats";

// trong component, sau khi có `user`:
const term = await resolveTerm(db, undefined, todayInVietnam());
const overview = term ? await gradeOverview(db, user, term.id) : [];

// trong JSX, trước <ul> các lớp:
<div className="rounded-2xl border border-line bg-card">
  <h2 className="border-b border-line px-4 py-3 font-semibold">Tổng quan {term?.name}</h2>
  <ul className="divide-y divide-line">
    {overview?.map((r) => (
      <li key={r.classId} className="flex min-h-14 items-center justify-between px-4 py-2">
        <span>
          <span className="block font-medium">{r.className}</span>
          <span className="text-sm text-ink-soft">{r.studentCount} em · {r.sessions} buổi</span>
        </span>
        <span className="text-right text-sm">
          <span className="block">{r.presentRate === null ? "—" : `${Math.round(r.presentRate * 100)}% có mặt`}</span>
          {r.warningCount > 0 && <span className="font-semibold text-warn-alert">{r.warningCount} cảnh báo</span>}
        </span>
      </li>
    ))}
  </ul>
</div>
```

Trong `src/app/(app)/page.tsx`, thêm số em cần chú ý vào mỗi thẻ lớp:

```tsx
import { resolveTerm } from "@/db/queries/stats";
import { todayInVietnam } from "@/lib/dates";
import { attentionList } from "@/server/services/stats";

// sau khi có `classes`:
const term = await resolveTerm(db, undefined, todayInVietnam());
const attention = term ? await attentionList(db, user, term.id) : [];
const needs = (classId: string) => attention.filter((a) => a.classId === classId).length;

// trong thẻ lớp, cạnh số em:
{needs(c.id) > 0 && <span className="ml-2 rounded-full bg-warn-alert px-2 py-0.5 text-xs font-semibold text-white">{needs(c.id)} cần chú ý</span>}
```

- [ ] **Step 9: Cổng chất lượng Mốc 5**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint`
Expected: pass. Thủ công: tải file Excel từ `/lop/<id>/thong-ke`, mở bằng Excel/LibreOffice; thêm một em tên `=1+1` rồi xuất lại, ô phải hiện chuỗi nguyên văn, không tính toán. Chạy agent **code-reviewer**; sửa mọi CRITICAL/HIGH.

- [ ] **Step 10: Commit**

```bash
git add src
git commit -m "feat: add term statistics, attention list, grade overview and Excel export"
```

---

## Mốc 6 — Kiểm thử E2E, PWA, hoàn thiện

### Task 13: E2E trên điện thoại và tablet

**Files:**
- Create: `playwright.config.ts`, `e2e/global-setup.ts`, `e2e/attendance.spec.ts`
- Modify: `package.json` (script `test:e2e`), `.gitignore` (`/e2e/.state.json`)

**Interfaces:**
- Consumes: toàn bộ ứng dụng, `hashPassword`, `todayInVietnam`, schema, thư mục `drizzle/`.
- Produces: biến môi trường `E2E_DATABASE_URL` (DB riêng cho E2E, **tên DB phải chứa `e2e`**), file trạng thái `e2e/.state.json` với `{ classA, classB }`.

**Điều kiện cần:** một Postgres dùng riêng cho E2E, ví dụ

```bash
docker run -d --name diemdanh-e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=diemdanh_e2e -p 55432:5432 postgres:16
export E2E_DATABASE_URL=postgres://postgres:e2e@localhost:55432/diemdanh_e2e
```

(hoặc một branch Neon riêng; `global-setup` sẽ **xóa sạch** schema `public` nên tuyệt đối không trỏ vào DB thật.)

- [ ] **Step 1: Cấu hình Playwright** — `playwright.config.ts`

```ts
import { defineConfig } from "@playwright/test";

const url = process.env.E2E_DATABASE_URL ?? "";
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "phone-375", use: { browserName: "chromium", viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
    { name: "tablet-768", use: { browserName: "chromium", viewport: { width: 768, height: 1024 }, hasTouch: true } },
  ],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: url, AUTH_SECRET: "e".repeat(40) },
  },
});
```

Thêm script `"test:e2e": "playwright test"` vào `package.json` và dòng `/e2e/.state.json` vào `.gitignore`.

- [ ] **Step 2: Dữ liệu E2E** — `e2e/global-setup.ts`

```ts
import { writeFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";
import { todayInVietnam } from "../src/lib/dates";

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
  const [classA] = await db.insert(s.classes).values({ gradeId: gradeA.id, name: "Lớp A" }).returning();
  const [classB] = await db.insert(s.classes).values({ gradeId: gradeB.id, name: "Lớp B" }).returning();
  await db.insert(s.classCatechists).values([{ classId: classA.id, userId: glvA.id }, { classId: classB.id, userId: glvB.id }]);

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

  writeFileSync("e2e/.state.json", JSON.stringify({ classA: classA.id, classB: classB.id }));
  await sql.end();
}
```

- [ ] **Step 3: Viết kịch bản** — `e2e/attendance.spec.ts`

```ts
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const state = () => JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { classA: string; classB: string };
const LOGIN_PW = "e2e-password-1";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(LOGIN_PW);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeVisible();
}

test("điểm danh bằng sơ đồ, thấy cảnh báo và danh sách Cần chú ý", async ({ page }) => {
  await login(page, "glv-a@e2e.vn");
  await page.getByRole("link", { name: /Lớp A/ }).click();
  await page.getByRole("link", { name: "Điểm danh hôm nay" }).click();

  await page.getByRole("button", { name: "Tất cả có mặt" }).click();
  await expect(page.getByText("Đã điểm danh 4/4")).toBeVisible();

  // An đã vắng 1 buổi trước đó; chạm để đánh vắng buổi này => đủ 2 buổi => cảnh báo.
  await page.getByRole("button", { name: /Nguyễn An: Có mặt/ }).click();
  await expect(page.getByRole("button", { name: /Nguyễn An: Vắng không phép/ })).toBeVisible();
  await expect(page.getByLabel("Cảnh báo vắng")).toBeVisible();

  // Nhấn giữ mở bảng chọn trạng thái.
  const binh = page.getByRole("button", { name: /Nguyễn Bình/ });
  await binh.hover();
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: /Điểm danh Nguyễn Bình/ })).toBeVisible();
  await page.getByRole("button", { name: "Vắng có phép" }).click();
  await expect(page.getByRole("button", { name: /Nguyễn Bình: Vắng có phép/ })).toBeVisible();

  // Chế độ checklist dùng cùng dữ liệu.
  await page.getByRole("tab", { name: "Checklist" }).click();
  await expect(page.getByRole("button", { name: "Vắng", exact: true, pressed: true })).toHaveCount(1);

  await page.goto("/can-chu-y");
  await expect(page.getByText("Nguyễn An")).toBeVisible();
  await expect(page.getByText(/Cảnh báo · 2 buổi/)).toBeVisible();
});

test("GLV lớp khác không xem được lớp này", async ({ page }) => {
  await login(page, "glv-b@e2e.vn");
  const response = await page.goto(`/lop/${state().classA}`);
  expect(response?.status()).toBe(404);
});

test("không cuộn ngang trên màn hình điểm danh", async ({ page }) => {
  await login(page, "glv-a@e2e.vn");
  await page.getByRole("link", { name: /Lớp A/ }).click();
  await page.getByRole("link", { name: "Điểm danh hôm nay" }).click();
  await expect(page.getByText(/Đã điểm danh/)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
```

- [ ] **Step 4: Chạy**

Run: `pnpm test:e2e`
Expected: 3 test × 2 project đều PASS. Nếu test 1 chạy lần 2 trên cùng DB thì trạng thái buổi hôm nay còn sót; `global-setup` xóa và dựng lại DB mỗi lần chạy nên luôn sạch.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e package.json .gitignore
git commit -m "test: add mobile and tablet E2E for attendance flow and permissions"
```

---

### Task 14: PWA, README, hoàn thiện và kiểm tra cuối

**Files:**
- Create: `src/app/manifest.ts`, `scripts/make-icons.ts`, `public/icon-192.png`, `public/icon-512.png` (sinh ra)
- Modify: `src/app/layout.tsx`, `vitest.config.ts`, `README.md`, `package.json`

**Interfaces:**
- Consumes: token màu ở Task 1.
- Produces: web app có thể "Thêm vào màn hình chính"; ngưỡng coverage ép buộc trong `pnpm test:cov`.

- [ ] **Step 1: Manifest** — `src/app/manifest.ts`

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Điểm danh Giáo lý",
    short_name: "Điểm danh",
    description: "Điểm danh lớp giáo lý theo sơ đồ chỗ ngồi",
    lang: "vi",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f1e6",
    theme_color: "#2f5d46",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
```

Trong `src/app/layout.tsx`, thêm vào `metadata`: `icons: { icon: "/icon-192.png", apple: "/icon-192.png" },`.

- [ ] **Step 2: Sinh icon** — `scripts/make-icons.ts`

```ts
import { chromium } from "@playwright/test";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <rect width="512" height="512" fill="#2f5d46"/>
  <rect x="96" y="156" width="140" height="90" rx="22" fill="#f7f1e6"/>
  <rect x="276" y="156" width="140" height="90" rx="22" fill="#f7f1e6"/>
  <rect x="96" y="286" width="140" height="90" rx="22" fill="#f7f1e6" opacity=".55"/>
  <path d="M296 331l34 34 70-76" fill="none" stroke="#f7f1e6" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

async function main() {
  const browser = await chromium.launch();
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<body style="margin:0">${SVG}</body>`);
    await page.screenshot({ path: `public/icon-${size}.png`, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
  }
  await browser.close();
}
main();
```

Run: `node --import tsx scripts/make-icons.ts`
Expected: tạo `public/icon-192.png`, `public/icon-512.png`. Mở xem bằng mắt: nền xanh, 3 băng ghế và dấu tích.

- [ ] **Step 3: Ép ngưỡng coverage** — `vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/server/**", "src/db/queries/**"],
      exclude: ["**/*.test.ts", "src/lib/auth/dal.ts", "src/lib/attendance/ui.ts", "src/test/**"],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
```

Run: `pnpm test:cov`
Expected: đạt ngưỡng. Nếu chưa đạt, đọc báo cáo, **viết thêm test cho nhánh chưa phủ** (không hạ ngưỡng).

- [ ] **Step 4: README** — thay `README.md` bằng hướng dẫn tiếng Việt gồm: yêu cầu (Node 22, pnpm, Postgres hosted), biến môi trường (`DATABASE_URL`, `AUTH_SECRET`), `pnpm install`, `pnpm db:migrate`, `pnpm seed` (các biến `SEED_*`), `pnpm dev`, cách tạo trưởng khối → lớp → GLV, `pnpm test`, `pnpm test:cov`, `pnpm test:e2e` (kèm cảnh báo về DB E2E riêng), và mục triển khai Vercel (đặt `DATABASE_URL`, `AUTH_SECRET` trong Project Settings; chạy `pnpm db:migrate` với DB production trước khi deploy; **không** commit `.env*`).

- [ ] **Step 5: Kiểm tra giao diện bằng mắt**

Chạy `pnpm dev`, dùng Playwright chụp màn hình ở 320, 375, 768, 1024px cho: `/login`, `/`, `/lop/<id>` (tab điểm danh), buổi điểm danh (sơ đồ và checklist), `/lop/<id>/so-do` (cả hai chế độ), `/lop/<id>/thong-ke`, `/can-chu-y`, `/khoi`. Kiểm tra: không cuộn ngang toàn trang, vùng chạm ≥ 44px, chữ không bị cắt, trạng thái phân biệt được không chỉ bằng màu (có nhãn/biểu tượng), chữ có độ tương phản đủ. Sửa lỗi nhìn thấy được rồi chụp lại.

- [ ] **Step 6: Kiểm tra cuối**

Run:

```bash
pnpm test:cov && pnpm exec tsc --noEmit && pnpm lint && pnpm build && pnpm test:e2e
```

Expected: tất cả pass. Ghi kết quả thật (số test, % coverage) vào mô tả commit; nếu có gì không chạy được (ví dụ chưa có DB E2E) phải nói rõ là chưa chạy.

- [ ] **Step 7: Rà soát toàn bộ trước khi hoàn tất**

Chạy agent **security-reviewer** trên toàn bộ ứng dụng (đăng nhập, session, guard, import CSV, export Excel, route handler, proxy) và agent **code-reviewer** trên toàn bộ diff của nhánh. Giải quyết mọi CRITICAL/HIGH; ghi các MEDIUM chưa sửa vào README mục "Việc nên làm sau".

- [ ] **Step 8: Commit và hoàn tất nhánh**

```bash
git add src public scripts README.md package.json vitest.config.ts
git commit -m "feat: add PWA manifest, icons, coverage gate and README"
```

Sau đó dùng skill `superpowers:finishing-a-development-branch` để chọn cách tích hợp.
