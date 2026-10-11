# Web điểm danh lớp giáo lý — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web mobile-first để giáo lý viên điểm danh theo buổi bằng sơ đồ băng ghế, danh sách hoặc quét QR liên tục, cảnh báo khi một em vắng không phép ≥ 2 buổi/học kỳ, có thống kê và trang tổng quan cho trưởng khối. Mốc QR dùng queue + Redis để lưu nền, có tìm tên và sửa/hoàn tác từng lượt.

**Architecture:** Logic nghiệp vụ là hàm thuần trong `src/lib/*`. Truy vấn DB nằm trong `src/db/queries/*`. Thao tác ghi đi qua `src/server/services/*` (nhận `db` + `user` + input `unknown`, validate bằng zod, kiểm quyền bằng `guardClass`, trả kết quả có kiểu), test bằng PGlite cho phần DB/logic. Server Action và QR Route Handler chỉ là lớp mỏng xác thực → service; điểm danh không revalidate toàn trang sau từng lượt. QR: receipt + outbox Postgres → dispatcher → Redis queue → worker → transaction ghi attendance/event/version → truy vấn kết quả theo batch cho UI. Integration queue/worker dùng Redis thật trong môi trường test riêng.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), TypeScript, Tailwind v4, Postgres + Drizzle ORM, session stateless bằng `jose` + cookie, `bcryptjs`, `zod` v4, `exceljs`, Vitest + PGlite, Playwright; mốc QR bổ sung Redis, queue adapter (BullMQ dự kiến), worker/dispatcher riêng và thư viện QR được kiểm tra trước khi chọn.

**Spec:** `docs/superpowers/specs/2026-10-11-diemdanh-giaoly-design.md`

**Điều chỉnh so với spec** (đã cập nhật vào spec cùng lúc với kế hoạch này):
1. Bỏ Auth.js beta, dùng session stateless `jose` + cookie `httpOnly` theo hướng dẫn trong `node_modules/next/dist/docs/01-app/02-guides/authentication.md`. Cookie chỉ chứa `userId`; thông tin người dùng và quyền được đọc lại từ DB ở mỗi request, nên đổi quyền có hiệu lực ngay.
2. Mục `gap` trong layout có thêm `id` để làm React key.
3. Trưởng khối xác định bằng `users.is_grade_head` + `users.grade_id` (bỏ `grades.head_id`), để GLV mới tạo chưa gán lớp vẫn thuộc khối.
4. Cập nhật 2026-10-12: thêm **Mốc 7, Task 15–21** cho UX QR liên tục, queue + Redis, receipt/outbox bền, xử lý lỗi và hoàn tác an toàn. QR do GLV quét, không phải tự check-in. Chi tiết nghiệp vụ tại spec mục 3, 4.1–4.3, 7–11.

**Cách tiếp tục trên code hiện có:** Mốc 1–6 giữ làm kế hoạch nền ban đầu; không chạy lại các đoạn tạo/ghi đè file hoặc suy ra tiến độ từ checkbox cũ. Đọc implementation hiện tại trước khi sửa. Mốc 7 là phần mở rộng cần triển khai và kiểm chứng; các bước dưới đây chưa được đánh dấu hoàn thành. Bản nháp UI chỉ tham khảo, lần cập nhật này không mặc định thay toàn bộ theme.

## Global Constraints

- Next.js **16.4**: file `src/proxy.ts` (không phải `middleware.ts`); `params` và `searchParams` là `Promise` phải `await`; đọc `node_modules/next/dist/docs/01-app/` trước khi dùng API Next chưa quen.
- Giao diện **tiếng Việt**, mobile-first, kiểm tra ở **375px** và **768px**; vùng chạm ≥ 44px; không cuộn ngang toàn trang.
- Ngưỡng cảnh báo mặc định: `unexcusedThreshold = 2` vắng không phép / học kỳ (`DEFAULT_RULES`).
- Trạng thái điểm danh đúng 4 giá trị: `present`, `absent_excused`, `absent_unexcused`, `late`. Chưa điểm danh = không có bản ghi.
- Băng 2–4 ghế; tối đa 12 hàng; tối đa 8 băng/hàng. Một em một ghế/sơ đồ.
- Ngày buổi học là chuỗi `YYYY-MM-DD` theo múi giờ **Asia/Ho_Chi_Minh**.
- Hàm thuần không sửa đối số, luôn trả bản sao mới. Hàm < 50 dòng, file < 800 dòng.
- Boundary runtime/secret (`src/db/client.ts`, `src/lib/auth/dal.ts`, actions, QR route/Redis adapter khi phù hợp) phải tách khỏi module nghiệp vụ được test; module test bằng Vitest không kéo `server-only` vào. Worker chạy Node có entrypoint/adapter riêng, không import marker dành cho Next.js vào runtime worker.
- Không hardcode secret; `AUTH_SECRET` ≥ 32 ký tự, kiểm tra khi dùng.
- Coverage ≥ **80%** cho `src/lib`, `src/server`, `src/db/queries`.
- Commit theo `<type>: <description>` (feat, fix, refactor, docs, test, chore), kèm dòng attribution mà phiên làm việc yêu cầu. Chỉ `git add` đúng file của task.
- QR: trạng thái gửi/nhận/xử lý không phải trạng thái điểm danh; không tính lượt chờ vào số đã lưu. Camera không chờ worker để đọc mã mới.
- Receipt + outbox commit trước acknowledgment; event ID giữ nguyên khi gửi lại, DB version giữ cả sau xóa. QR, thủ công, ghi hàng loạt và undo phải cùng giao thức concurrency.
- Thẻ invalid/sai lớp/bị thu hồi, em inactive, mất quyền hoặc buổi nghỉ lễ không được ghi; status/undo cũng xác thực và kiểm quyền. Không tự mở URL QR.
- Không triển khai offline đầy đủ trong mốc này; hàng chờ tại điện thoại là trong phiên. Nơi chạy worker, mức tải/giới hạn backlog và chỉ tiêu đo được chốt ở Task 15, không coi Redis là bảo đảm tốc độ hoặc độ bền mặc định.

## Review Focus

Các tình huống spec không nói rõ nhưng dễ gây lỗi cho người dùng thật; mỗi dòng có test ở task sở hữu code:

1. **CSV thực tế** — file từ Excel có BOM, phân cách `;`, tên có dấu phẩy trong ngoặc kép, chữ Việt dạng NFD, dòng trống, tên trùng → không được vỡ hoặc tạo trùng (Task 7).
2. **Múi giờ và ranh giới học kỳ** — mở app lúc 00:30 giờ VN (vẫn là 17:30 UTC hôm trước) phải ra đúng "hôm nay"; ngày đầu/cuối học kỳ thuộc học kỳ; ngày ngoài mọi học kỳ báo lỗi rõ (Task 10).
3. **Bấm đúp / hai thiết bị cùng lúc** — cùng em, cùng buổi, ghi hai lần hoặc song song → vẫn đúng một bản ghi (Task 10).
4. **Em bị ẩn và GLV bị gỡ khỏi lớp** — em ẩn không xếp ghế, không điểm danh, không nằm trong thống kê nhưng lịch sử còn; GLV bị gỡ khỏi lớp mất quyền ngay dù cookie còn hạn (Task 4, 9, 12).
5. **Công thức trong file xuất** — tên bắt đầu bằng `=`, `+`, `-`, `@` phải được ghi thành văn bản, không bao giờ thành công thức, kể cả khi sau này người dùng chuyển file sang CSV (Task 12; `safeCell` là lớp phòng thủ bổ sung vì exceljs đã ghi chuỗi dạng văn bản).
6. **QR lỗi/nhầm** — mã không đọc được hoặc invalid không tạo điểm danh; sai lớp không lộ thông tin ngoài quyền; thẻ hợp lệ nhưng nhầm người có sửa đúng lượt; đi trễ/vắng không bị ghi đè tự động (Task 17–20).
7. **Queue/retry/undo** — timeout sau receipt, Redis/worker restart, event trùng/khác payload, lệch thứ tự, xóa thủ công rồi replay, undo race với apply, sửa mới từ thiết bị khác (Task 16, 18, 20).
8. **Hiệu năng và trạng thái thật** — đo camera/decoder/API/worker riêng; 30 thẻ liên tục không reload hoặc modal chặn; số đã lưu chỉ tăng sau commit; backlog/lỗi không mất sau toast (Task 15, 19–21).

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
```

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

### Task 14: PWA, README, hoàn thiện và kiểm tra MVP nền

**Phạm vi cổng chất lượng:** Task này hoàn thiện Mốc 1–6. Với phạm vi QR bổ sung,
không coi pass Task 14 là xong release; cổng toàn bộ và hoàn tất nhánh nằm ở Task 21.

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

Với phạm vi QR đã bổ sung, tiếp tục Mốc 7 và chỉ dùng skill
`superpowers:finishing-a-development-branch` sau cổng toàn bộ ở Task 21.

---

---

## Mốc 7 — QR liên tục, ưu tiên độ trễ (ghi đồng bộ, không Redis)

> **Thay thế hoàn toàn** bản Mốc 7 cũ (Redis, outbox, worker, bảng version). Căn cứ: mục "Mốc mở rộng QR", §3 "Dữ liệu bổ sung cho mốc QR", §4.1–4.3, §7, §8, §9 của spec `docs/superpowers/specs/2026-10-11-diemdanh-giaoly-design.md`. Mốc 1–6 đã hoàn thành; mốc này làm trên nhánh `feat/qr-attendance`, cắt từ `main` **sau khi** nhánh `feat/ui-redesign` (giao diện "Rõ ràng": `Sheet`, `Pill`, `Notice`, `EmptyState`, `STATUS_META`, `lucide-react`) đã merge. Mọi component mới dùng các thành phần đó.

**Mục tiêu hàng đầu: độ trễ.** Cảm nhận tức thì ở máy khách (bảng tra nạp sẵn, cập nhật lạc quan, gửi nền song song); máy chủ ghi **đồng bộ** trong một transaction rồi trả kết quả cuối ngay trong phản hồi. Không có hàng chờ ở máy chủ.

### Global Constraints bổ sung cho Mốc 7

- `qr_token`: 32 ký tự hex thường (≥ 128 bit) do **database** sinh (`replace(gen_random_uuid()::text,'-','')`), lưu thẳng, duy nhất. Nội dung QR là `dd1.<qr_token>`, không chứa gì khác.
- Token **không bao giờ** nằm trong: kết quả `listStudents`/`getStudent`/`rosterOf`/`loadBoardData`, props của Client Component không phải màn quét/in thẻ, thống kê, xuất Excel, log. Chỉ hai nơi đọc token: trang in thẻ và bảng tra của màn quét, **chỉ cho người có quyền ghi lớp**.
- Mọi đường vào QR (service và route) kiểm quyền ghi từ **phiên đăng nhập**, không tin `userId`/quyền/`classId` do máy khách gửi. Thẻ lớp khác / mã lạ / mã đã đổi / em bị ẩn trả cùng một thông báo ("Thẻ không dùng được cho lớp này"), không lộ tên.
- Route POST: kiểm tra Origin cùng host, `Content-Type: application/json`, body ≤ 4 KB, giới hạn tốc độ theo tài khoản, phản hồi `Cache-Control: private, no-store`. Route nằm ngoài redirect của `proxy.ts` (trả 401 JSON, không chuyển hướng HTML).
- Một `event_id` (UUID do máy khách tạo) gắn với payload + actor bất biến: gửi lại đúng payload → trả kết quả đã lưu; khác payload/actor → 409 `event_conflict`.
- Quy tắc quét (bảng §4.2) là **một hàm thuần** `decideScan` dùng chung cho máy khách (lạc quan) và máy chủ (quyết định thật).
- Hàng gửi ở máy khách: ≤ 50 lượt đang chờ; gửi song song nhưng **tuần tự cho cùng một em**; lỗi mạng/5xx/timeout thử lại tự động tối đa 3 lần (0,5s / 1,5s / 4s) cùng `event_id`, sau đó `failed` + nút "Thử lại"; mọi phản hồi khác 5xx là kết quả cuối, không retry.
- Camera chỉ bật sau thao tác người dùng, một stream suốt phiên quét; không mở URL trong QR; không `router.refresh`/tải lại sau mỗi lượt.
- Không `console.log` token; không đưa token vào URL, query string hay `localStorage`.

## Review Focus (Mốc 7)

1. **Rò rỉ token** — mọi nơi `select()` toàn bộ cột `students` (danh sách, thống kê, bảng điểm danh, trang sơ đồ, import) không được đẩy `qrToken` xuống client; người chỉ-đọc (trưởng khối) không thấy token (Task 17, 18).
2. **Quét trùng và đua** — cùng `event_id` gửi lại / gửi song song, hai thiết bị quét cùng em, quét khi ghi tay xảy ra cùng lúc: luôn một bản ghi, kết quả nhất quán (Task 18).
3. **Hoàn tác không ghi đè** — hoàn tác sau khi đã có sửa tay mới hơn phải trả `conflict`, không đổi gì; hoàn tác lượt tạo mới thì xóa bản ghi; đường ghi tay cũ phải đặt lại `last_event_id` (Task 16, 18).
4. **Camera và thiết bị** — từ chối quyền, không có camera, iOS Safari (không có `BarcodeDetector`), thẻ mờ/chói, một mã nằm lâu trong khung không bị quét lặp, mã mới quét ngay (Task 15, 19).
5. **Mất mạng giữa chừng** — máy chủ đã commit nhưng phản hồi thất lạc: gửi lại cùng `event_id` không tạo lượt thứ hai và UI hiện đúng kết quả; rời trang khi còn lượt chờ có cảnh báo (Task 18, 19, 20).

---

### Task 15: Đo cơ sở, chọn thư viện QR, hợp đồng decoder

**Files:**
- Create: `scripts/bench-baseline.ts`, `docs/superpowers/qr-baseline.md`, `src/lib/qr/decoder.ts`, `src/lib/qr/generate.ts`, `src/lib/qr/qr-roundtrip.test.ts`, `scripts/copy-qr-wasm.mjs`, `public/zxing_reader.wasm` (sinh ra)
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `interface QrDecoder { decodeVideo(video: HTMLVideoElement): Promise<string | null> }`; `createQrDecoder(): Promise<QrDecoder>` (`src/lib/qr/decoder.ts`, chỉ chạy ở trình duyệt)
  - `qrSvg(text: string): Promise<string>` — chuỗi SVG của mã QR mức sửa lỗi M, lề 1 module (`src/lib/qr/generate.ts`, chỉ chạy ở máy chủ)
  - Tài liệu `docs/superpowers/qr-baseline.md` ghi: số đo cơ sở (p50/p95, số truy vấn), vùng chạy app/DB, thư viện đã chọn và lý do, ngưỡng quyết định.

- [ ] **Step 1: Cài thư viện**

```bash
pnpm add barcode-detector qrcode
pnpm add -D @types/qrcode
```

`barcode-detector` là ponyfill của Barcode Detection API chạy trên zxing-wasm (dùng được trên iOS Safari, nơi trình duyệt không có `BarcodeDetector`); `qrcode` sinh mã ở máy chủ. Đọc `node_modules/barcode-detector/README.md` và `node_modules/zxing-wasm/README.md` để **xác nhận** tên export (`BarcodeDetector`, `prepareZXingModule`, đường dẫn `barcode-detector/ponyfill`), cách chỉ chỗ tải file `.wasm`, và dung lượng. Nếu API khác với mã mẫu ở Step 4, sửa mã cho đúng nhưng **giữ nguyên interface `QrDecoder`**. Ghi vào `qr-baseline.md` đúng phiên bản và lý do chọn; nếu chọn thư viện khác (ví dụ chỉ dùng `zxing-wasm`) thì ghi thay thế đó.

- [ ] **Step 2: Viết test vòng tròn (sinh → giải mã)**

`src/lib/qr/qr-roundtrip.test.ts` — kiểm tra bộ sinh và bộ giải mã của ta hiểu nhau với đúng loại payload sẽ in (không cần camera hay PNG):

```ts
// @vitest-environment node
import QRCode from "qrcode";
import { readBarcodes } from "zxing-wasm/reader";
import { describe, expect, it } from "vitest";
/** Vẽ ma trận module của qrcode thành ImageData (đen/trắng, lề 4 module) để zxing đọc. */
function toImageData(text: string, scale = 8) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const quiet = 4;
  const side = (size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!qr.modules.get(y, x)) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = ((y + quiet) * scale + dy) * side + (x + quiet) * scale + dx;
          data.fill(0, px * 4, px * 4 + 3);
        }
      }
    }
  }
  return { data, width: side, height: side, colorSpace: "srgb" as const };
}

const CODE = "0123456789abcdef0123456789abcdef";

describe("QR round trip", () => {
  it("decodes the exact payload we print", async () => {
    const payload = `dd1.${CODE}`; // đúng định dạng Task 16 sẽ chuẩn hóa thành formatQrPayload
    const [hit] = await readBarcodes(toImageData(payload), { formats: ["QRCode"] });
    expect(hit?.text).toBe(payload);
  });

  it("still decodes at a small on-screen size (4px per module)", async () => {
    const payload = `dd1.${CODE}`; // đúng định dạng Task 16 sẽ chuẩn hóa thành formatQrPayload
    const [hit] = await readBarcodes(toImageData(payload, 4), { formats: ["QRCode"] });
    expect(hit?.text).toBe(payload);
  });
});
```

Đây là test **kiểm chứng tương thích thư viện** (không phải TDD cho mã sản phẩm): thư viện đã cài ở Step 1 nên test phải **PASS ngay**.

Run: `pnpm test src/lib/qr/qr-roundtrip.test.ts`
Expected: PASS (2 test). Nếu FAIL vì `zxing-wasm/reader` không chạy được trong Vitest/Node (ví dụ không nạp được `.wasm`), đọc README của `zxing-wasm` để cấu hình đúng cách nạp trong Node; nếu vẫn không được, ghi rõ lý do vào `qr-baseline.md`, bỏ file test này và thay bằng kiểm tra thủ công ở Step 6 (in một mã ra màn hình, quét bằng decoder trong trình duyệt). Nếu FAIL vì nội dung giải mã khác payload, đó là lỗi tương thích thật: dừng và xử lý trước khi làm tiếp.

- [ ] **Step 3: Xác nhận phiên bản thư viện đã khóa**

Run: `pnpm list barcode-detector zxing-wasm qrcode`
Expected: in ra phiên bản; ghi chúng vào `qr-baseline.md` ở Step 7.

- [ ] **Step 4: Cài đặt decoder và bộ sinh**

`src/lib/qr/decoder.ts`

```ts
export interface QrDecoder {
  /** Trả chuỗi của mã QR đầu tiên trong khung hình hiện tại, hoặc null. */
  decodeVideo(video: HTMLVideoElement): Promise<string | null>;
}

const WASM_URL = "/zxing_reader.wasm";

export async function createQrDecoder(): Promise<QrDecoder> {
  // Nạp lười: không đưa WASM vào bundle chính; file .wasm tự host (không phụ thuộc CDN, chạy được khi mạng yếu).
  const { BarcodeDetector, prepareZXingModule } = await import("barcode-detector/ponyfill");
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? WASM_URL : prefix + path) },
    fireImmediately: true,
  });
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  return {
    async decodeVideo(video) {
      const found = await detector.detect(video);
      return found[0]?.rawValue ?? null;
    },
  };
}
```

`src/lib/qr/generate.ts`

```ts
import QRCode from "qrcode";

export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
}
```

`scripts/copy-qr-wasm.mjs`

```js
import { copyFileSync, existsSync } from "node:fs";

const candidates = [
  "node_modules/zxing-wasm/dist/reader/zxing_reader.wasm",
  "node_modules/zxing-wasm/dist/zxing_reader.wasm",
];
const src = candidates.find((p) => existsSync(p));
if (!src) throw new Error("Không tìm thấy zxing_reader.wasm trong node_modules/zxing-wasm; xem README của thư viện");
copyFileSync(src, "public/zxing_reader.wasm");
console.log(`Đã chép ${src} -> public/zxing_reader.wasm`);
```

Thêm vào `package.json` scripts: `"qr:wasm": "node scripts/copy-qr-wasm.mjs"`. Chạy `pnpm qr:wasm` và commit file `public/zxing_reader.wasm` (đúng phiên bản đã khóa trong lockfile; chạy lại lệnh khi nâng cấp thư viện).

- [ ] **Step 5: Đo cơ sở của đường ghi hiện tại** — `scripts/bench-baseline.ts`

```ts
import { performance } from "node:perf_hooks";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../src/db/schema";
import type { Db } from "../src/db/types";
import { setStatus } from "../src/server/services/attendance";

const url = process.env.E2E_DATABASE_URL;
if (!url) throw new Error("Thiếu E2E_DATABASE_URL");
if (!/e2e/i.test(new URL(url).pathname)) throw new Error("Tên database phải chứa 'e2e'");

const N = 200;
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

async function main() {
  let queries = 0;
  const sql = postgres(url!, { max: 5 });
  const db = drizzle(sql, { schema: s, logger: { logQuery: () => { queries++; } } }) as unknown as Db;

  const [user] = await sql`select id, email, name, grade_id, is_grade_head from users where email = 'glv-a@e2e.vn'`;
  const [cls] = await sql`select c.id from classes c join class_catechists cc on cc.class_id = c.id where cc.user_id = ${user.id} limit 1`;
  const kids = await sql`select id from students where class_id = ${cls.id} and active limit 4`;
  const [term] = await sql`select id from terms limit 1`;
  const [session] = await sql`insert into sessions (class_id, term_id, held_on) values (${cls.id}, ${term.id}, '2026-01-01') on conflict (class_id, held_on) do update set cancelled = false returning id`;
  const appUser = { id: user.id, email: user.email, name: user.name, isGradeHead: user.is_grade_head, gradeId: user.grade_id };

  const rtt: number[] = [];
  for (let i = 0; i < 50; i++) { const t = performance.now(); await sql`select 1`; rtt.push(performance.now() - t); }

  const times: number[] = [];
  queries = 0;
  for (let i = 0; i < N; i++) {
    const t = performance.now();
    await setStatus(db, appUser, { sessionId: session.id, studentId: kids[i % kids.length].id, status: i % 2 ? "present" : "absent_unexcused", reason: null });
    times.push(performance.now() - t);
  }
  console.log(JSON.stringify({
    selectOneRttMs: { p50: pct(rtt, 50), p95: pct(rtt, 95) },
    setStatus: { n: N, queriesPerCall: queries / N, p50: pct(times, 50), p95: pct(times, 95) },
  }, null, 2));
  await sql`delete from sessions where id = ${session.id}`;
  await sql.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
```

Chạy trên Postgres Docker cục bộ (xem README: container `diemdanh-e2e`, `E2E_DATABASE_URL`, đã seed bằng `e2e/global-setup.ts`):

```bash
node --import tsx scripts/bench-baseline.ts
```

Chạy thêm một lần với database hosted thật (Neon/Supabase) **từ máy chạy app** (hoặc từ Vercel function) để thấy số vòng mạng thực: đó là số quan trọng nhất. Ghi vào `qr-baseline.md`: `select 1` p50/p95, số truy vấn mỗi lượt `setStatus`, p50/p95, **vùng của Vercel project và vùng của database** (đặt cùng vùng; nếu lệch, đổi vùng function trong cài đặt Vercel hoặc vùng DB trước khi làm tiếp).

- [ ] **Step 6: Kiểm tra thủ công decoder trong trình duyệt**

Chạy `pnpm dev`, mở `http://localhost:3000` (camera cần `localhost` hoặc HTTPS), dùng một trang tạm hoặc console để gọi `createQrDecoder()` rồi `decodeVideo(video)` với camera trỏ vào một mã `dd1.<token>` hiển thị trên màn hình khác. Ghi vào `qr-baseline.md`: thiết bị/trình duyệt đã thử (ít nhất Chrome Android hoặc desktop; nếu có iPhone thì Safari), thời gian giải mã trung bình, kích thước file wasm. Xóa trang tạm.

- [ ] **Step 7: Viết `docs/superpowers/qr-baseline.md`** gồm: bảng số đo, vùng app/DB, thư viện đã chọn + phiên bản + lý do, và **ngưỡng quyết định** (đặt từ số đo; mặc định: p95 xử lý máy chủ của đường quét ≤ 100ms khi app và DB cùng vùng; nếu sau Task 18 vượt ngưỡng thì gộp truy vấn bằng join/CTE trước, chỉ cân nhắc hàng chờ trên Postgres khi vẫn không đạt).

- [ ] **Step 8: Cổng chất lượng và commit**

Run: `pnpm test --maxWorkers=2 && pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: pass.

```bash
git add package.json pnpm-lock.yaml scripts public/zxing_reader.wasm src/lib/qr docs/superpowers/qr-baseline.md
git commit -m "feat: add QR decoder/generator contract and latency baseline"
```

---

### Task 16: Schema thẻ QR, nhật ký quét và quy tắc quét (hàm thuần)

**Files:**
- Create: `src/lib/qr/payload.ts`, `src/lib/qr/payload.test.ts`, `src/lib/attendance/scan-rules.ts`, `src/lib/attendance/scan-rules.test.ts`, `src/test/migration.ts`, `src/db/qr-schema.test.ts`, `drizzle/*` (sinh ra)
- Modify: `src/db/schema.ts`, `src/server/services/attendance.ts`, `src/server/services/attendance.test.ts`

**Interfaces:**
- Produces:
  - `formatQrPayload(token: string): string`, `parseQrPayload(text: string): string | null` (trả `token` hoặc `null`)
  - `type ScanMode = "present" | "late"`; `interface CurrentMark { status: AttendanceStatus; reason: string | null }`
  - `type ScanDecision = { kind: "apply"; status: "present" | "late" } | { kind: "noop"; reason: "already_present" | "already_late" } | { kind: "confirm"; defaultStatus: "present" | "late"; current: "absent_excused" | "absent_unexcused" }`
  - `decideScan(current: CurrentMark | null, mode: ScanMode, confirmStatus?: "present" | "late"): ScanDecision`
  - Bảng: `students.qrToken`, `attendance.lastEventId`, `attendanceScans` (`eventId` khóa chính, `kind`, `sessionId`, `studentId`, `actorId`, `mode`, `payloadHash`, `prevStatus`, `prevReason`, `newStatus`, `result` (`applied` | `noop`), `errorCode`, `targetEventId`, `capturedAt`, `receivedAt`)
  - `createTestDbBeforeLastMigration(): Promise<{ db: Db; client: PGlite; applyLast(): Promise<void> }>` (`src/test/migration.ts`, dùng để kiểm tra backfill)

- [ ] **Step 1: Viết test lỗi cho hàm thuần**

`src/lib/qr/payload.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { formatQrPayload, parseQrPayload } from "./payload";

const CODE = "0123456789abcdef0123456789abcdef";

describe("QR payload", () => {
  it("round-trips a token", () => {
    expect(parseQrPayload(formatQrPayload(CODE))).toBe(CODE);
    expect(formatQrPayload(CODE)).toBe(`dd1.${CODE}`);
  });
  it("trims surrounding whitespace", () => {
    expect(parseQrPayload(`  dd1.${CODE}\n`)).toBe(CODE);
  });
  it("rejects anything that is not our payload (never treats it as a URL)", () => {
    for (const bad of ["", "dd1.", `dd2.${CODE}`, `https://example.com/dd1.${CODE}`, `dd1.${CODE}x`, `dd1.${CODE.slice(1)}`, `dd1.${CODE.toUpperCase()}`, `dd1.${"g".repeat(32)}`, "javascript:alert(1)"]) {
      expect(parseQrPayload(bad)).toBeNull();
    }
  });
  it("refuses to format a malformed token", () => {
    expect(() => formatQrPayload("short")).toThrow();
  });
});
```

`src/lib/attendance/scan-rules.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { decideScan } from "./scan-rules";

const mark = (status: "present" | "late" | "absent_excused" | "absent_unexcused") => ({ status, reason: null });

describe("decideScan", () => {
  it("unmarked: records the scan mode", () => {
    expect(decideScan(null, "present")).toEqual({ kind: "apply", status: "present" });
    expect(decideScan(null, "late")).toEqual({ kind: "apply", status: "late" });
  });
  it("already present: never changes, even in late mode", () => {
    expect(decideScan(mark("present"), "present")).toEqual({ kind: "noop", reason: "already_present" });
    expect(decideScan(mark("present"), "late")).toEqual({ kind: "noop", reason: "already_present" });
  });
  it("already late: never changes and never asks", () => {
    expect(decideScan(mark("late"), "present")).toEqual({ kind: "noop", reason: "already_late" });
    expect(decideScan(mark("late"), "late")).toEqual({ kind: "noop", reason: "already_late" });
  });
  it("absent: asks to confirm, defaulting to the scan mode", () => {
    expect(decideScan(mark("absent_excused"), "present")).toEqual({ kind: "confirm", defaultStatus: "present", current: "absent_excused" });
    expect(decideScan(mark("absent_unexcused"), "late")).toEqual({ kind: "confirm", defaultStatus: "late", current: "absent_unexcused" });
  });
  it("absent + an explicit confirmation: applies the chosen status", () => {
    expect(decideScan(mark("absent_unexcused"), "present", "late")).toEqual({ kind: "apply", status: "late" });
    expect(decideScan(mark("absent_excused"), "late", "present")).toEqual({ kind: "apply", status: "present" });
  });
  it("a confirmation never overrides a non-absent mark", () => {
    expect(decideScan(mark("present"), "present", "late")).toEqual({ kind: "noop", reason: "already_present" });
    expect(decideScan(null, "present", "late")).toEqual({ kind: "apply", status: "present" });
  });
});
```

- [ ] **Step 2: Chạy để thấy lỗi**

Run: `pnpm test src/lib/qr/payload.test.ts src/lib/attendance/scan-rules.test.ts`
Expected: FAIL — thiếu module.

- [ ] **Step 3: Cài đặt hàm thuần**

`src/lib/qr/payload.ts`

```ts
const PREFIX = "dd1.";
const TOKEN_RE = /^[0-9a-f]{32}$/;

export function formatQrPayload(token: string): string {
  if (!TOKEN_RE.test(token)) throw new Error("Mã thẻ không hợp lệ");
  return PREFIX + token;
}

/** Trả token nếu chuỗi đúng định dạng `dd1.<32 hex thường>`, ngược lại null. Không bao giờ coi chuỗi là URL. */
export function parseQrPayload(text: string): string | null {
  const t = text.trim();
  if (!t.startsWith(PREFIX)) return null;
  const token = t.slice(PREFIX.length);
  return TOKEN_RE.test(token) ? token : null;
}
```

`src/lib/attendance/scan-rules.ts`

```ts
import type { AttendanceStatus } from "./warning";

export type ScanMode = "present" | "late";
export interface CurrentMark { status: AttendanceStatus; reason: string | null }

export type ScanDecision =
  | { kind: "apply"; status: "present" | "late" }
  | { kind: "noop"; reason: "already_present" | "already_late" }
  | { kind: "confirm"; defaultStatus: "present" | "late"; current: "absent_excused" | "absent_unexcused" };

/**
 * Bảng quy tắc §4.2 của spec. Dùng cho cả giao diện (lạc quan) lẫn máy chủ (quyết định thật).
 * `confirmStatus` chỉ có tác dụng khi em đang ở một trạng thái vắng.
 */
export function decideScan(
  current: CurrentMark | null,
  mode: ScanMode,
  confirmStatus?: "present" | "late",
): ScanDecision {
  if (current === null) return { kind: "apply", status: mode };
  switch (current.status) {
    case "present": return { kind: "noop", reason: "already_present" };
    case "late": return { kind: "noop", reason: "already_late" };
    default:
      return confirmStatus
        ? { kind: "apply", status: confirmStatus }
        : { kind: "confirm", defaultStatus: mode, current: current.status };
  }
}
```

- [ ] **Step 4: Chạy test**

Run: `pnpm test src/lib/qr/payload.test.ts src/lib/attendance/scan-rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Viết test lỗi cho schema và migration**

`src/test/migration.ts` — dựng DB ở trạng thái **trước migration cuối** để kiểm tra backfill dữ liệu có sẵn:

```ts
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";

interface Journal { entries: { tag: string }[] }

const sqlOf = (tag: string) =>
  readFileSync(`./drizzle/${tag}.sql`, "utf8").split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

export async function createTestDbBeforeLastMigration() {
  const journal = JSON.parse(readFileSync("./drizzle/meta/_journal.json", "utf8")) as Journal;
  const tags = journal.entries.map((e) => e.tag);
  const client = new PGlite();
  for (const tag of tags.slice(0, -1)) for (const stmt of sqlOf(tag)) await client.exec(stmt);
  const last = tags[tags.length - 1];
  return {
    db: drizzle(client, { schema }) as unknown as Db,
    client,
    async applyLast() { for (const stmt of sqlOf(last)) await client.exec(stmt); },
  };
}
```

`src/db/qr-schema.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { attendance, attendanceScans, sessions, students } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { createTestDbBeforeLastMigration } from "@/test/migration";
import { seedBasics } from "@/test/fixtures";

const HEX32 = /^[0-9a-f]{32}$/;

describe("QR schema", () => {
  it("gives every new student a unique 32-hex token", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    const rows = await db.insert(students).values([
      { classId: b.classId, fullName: "An" }, { classId: b.classId, fullName: "Bình" },
    ]).returning({ token: students.qrToken });
    expect(rows[0].token).toMatch(HEX32);
    expect(rows[1].token).toMatch(HEX32);
    expect(rows[0].token).not.toBe(rows[1].token);
  });

  it("backfills a distinct token for students that existed before the migration", async () => {
    const { client, applyLast } = await createTestDbBeforeLastMigration();
    await client.exec("insert into grades (name) values ('K')");
    await client.exec("insert into classes (grade_id, name) select id, 'L' from grades");
    await client.exec("insert into students (class_id, full_name) select id, 'A' from classes");
    await client.exec("insert into students (class_id, full_name) select id, 'B' from classes");
    await applyLast();
    const { rows } = await client.query<{ qr_token: string }>("select qr_token from students");
    expect(rows).toHaveLength(2);
    expect(rows[0].qr_token).toMatch(HEX32);
    expect(rows[0].qr_token).not.toBe(rows[1].qr_token);
  });

  it("enforces unique tokens and unique event ids", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    const [kid] = await db.insert(students).values({ classId: b.classId, fullName: "An" }).returning();
    await expect(db.insert(students).values({ classId: b.classId, fullName: "X", qrToken: kid.qrToken })).rejects.toThrow();
    const [session] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn: "2026-10-11" }).returning();
    const row = { eventId: crypto.randomUUID(), kind: "scan" as const, sessionId: session.id, studentId: kid.id, actorId: b.glv.id, payloadHash: "h", result: "applied" as const };
    await db.insert(attendanceScans).values(row);
    await expect(db.insert(attendanceScans).values(row)).rejects.toThrow();
  });

  it("keeps last_event_id empty by default on attendance rows", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    const [kid] = await db.insert(students).values({ classId: b.classId, fullName: "An" }).returning();
    const [session] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn: "2026-10-11" }).returning();
    const [row] = await db.insert(attendance).values({ sessionId: session.id, studentId: kid.id, status: "present" }).returning();
    expect(row.lastEventId).toBeNull();
  });
});
```

- [ ] **Step 6: Sửa schema** — `src/db/schema.ts`

Thêm vào bảng `students`: `qrToken: text("qr_token").notNull().unique().default(sql\`replace(gen_random_uuid()::text, '-', '')\`),`.
Thêm vào bảng `attendance`: `lastEventId: uuid("last_event_id"),`.
Thêm enum và bảng mới (import `index` từ `drizzle-orm/pg-core`):

```ts
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
```

Sinh migration: `pnpm drizzle-kit generate --name qr_cards_and_scans`. Mở file SQL vừa sinh và kiểm tra: `ALTER TABLE "students" ADD COLUMN "qr_token" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL;` (Postgres điền giá trị **khác nhau cho từng dòng cũ** vì hàm volatile) rồi `ADD CONSTRAINT ... UNIQUE`. Nếu drizzle sinh thứ tự khác khiến ràng buộc UNIQUE chạy trước khi điền dữ liệu thì chỉnh thứ tự trong file SQL (ADD COLUMN → ADD CONSTRAINT).

- [ ] **Step 7: Đường ghi tay cũ đặt lại `last_event_id`** (test trước)

Thêm vào `src/server/services/attendance.test.ts`:

```ts
import { attendance } from "@/db/schema";
// ... trong describe("setStatus"), dùng helper setup/open có sẵn của file

it("a manual write clears last_event_id so an older scan can no longer be undone", async () => {
  const { db, b, mk, open } = await setup();
  const an = await mk("An");
  const sessionId = await open("2026-10-11");
  await db.insert(attendance).values({ sessionId, studentId: an.id, status: "present", lastEventId: crypto.randomUUID() }).onConflictDoNothing();
  await setStatus(db, b.glv, { sessionId, studentId: an.id, status: "late", reason: null });
  const [row] = await db.select().from(attendance);
  expect(row.status).toBe("late");
  expect(row.lastEventId).toBeNull();
});
```

Run: `pnpm test src/server/services/attendance.test.ts` — Expected: FAIL (`lastEventId` vẫn còn).
Sửa `setStatus` (`values` thêm `lastEventId: null`):

```ts
const values = { status: p.data.status, reason: p.data.reason || null, updatedBy: user.id, updatedAt: new Date(), lastEventId: null };
```

`markAllPresent` chỉ chèn cho em chưa có bản ghi nên `lastEventId` mặc định `NULL` (không đổi). Chạy lại test — Expected: PASS.

- [ ] **Step 8: Chạy toàn bộ và commit**

Run: `pnpm test --maxWorkers=2 && pnpm exec tsc --noEmit && pnpm lint`
Expected: pass (kể cả test migration backfill).

```bash
git add src drizzle
git commit -m "feat: add QR token, scan log schema and pure scan rules"
```

---

### Task 17: Không để lộ token, in thẻ QR và cấp lại mã

**Files:**
- Create: `src/db/queries/qr-cards.ts`, `src/server/services/qr-cards.ts`, `src/server/services/qr-cards.test.ts`, `src/app/(app)/lop/[classId]/thieu-nhi/the-qr/page.tsx`, `src/app/(app)/lop/[classId]/thieu-nhi/the-qr/actions.ts`, `src/app/(app)/lop/[classId]/thieu-nhi/the-qr/CardTools.tsx`
- Modify: `src/db/queries/students.ts`, `src/db/queries/stats.ts` (`rosterOf`), `src/db/queries/attendance.ts` (`loadBoardData`), `src/server/services/students.ts` (import), `src/app/globals.css` (in), `src/components/nav/BottomNav.tsx` và header trang lớp (`print:hidden`), `src/app/(app)/lop/[classId]/thieu-nhi/page.tsx` (liên kết "In thẻ QR")
- Test: `src/db/queries/students.test.ts`

**Interfaces:**
- Consumes: `students.qrToken`, `guardClass`, `getStudent`, `formatQrPayload`, `qrSvg`, `NOT_FOUND`.
- Produces:
  - `studentColumns` — object cột cho `db.select(studentColumns)`: `id, classId, saintName, fullName, birthDate, parentPhone, note, active` (**không có** `qrToken`)
  - `listQrCards(db, classId): Promise<{ studentId: string; fullName: string; saintName: string | null; token: string }[]>` (chỉ em đang hiện, theo tên)
  - `getQrCards(db, user, classId): Promise<QrCard[] | null>` — `null` nếu không có quyền **ghi** lớp (trưởng khối chỉ đọc cũng `null`)
  - `rotateQrToken(db, user, input: unknown): Promise<ActionResult>` với input `{ studentId }`

- [ ] **Step 1: Viết test lỗi**

`src/db/queries/students.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { students } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { loadBoardData } from "./attendance";
import { getStudent, listStudents } from "./students";
import { rosterOf } from "./stats";
import { sessions } from "@/db/schema";

describe("student queries never expose qrToken", () => {
  it("listStudents, getStudent, rosterOf and loadBoardData omit the token", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    const [kid] = await db.insert(students).values({ classId: b.classId, fullName: "An" }).returning();
    const [session] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn: "2026-10-11" }).returning();

    expect(Object.keys((await listStudents(db, b.classId))[0])).not.toContain("qrToken");
    expect(Object.keys((await getStudent(db, kid.id))!)).not.toContain("qrToken");
    expect(Object.keys((await rosterOf(db, [b.classId]))[0])).not.toContain("qrToken");
    const board = await loadBoardData(db, session);
    expect(JSON.stringify(board)).not.toContain(kid.qrToken);
  });
});
```

`src/server/services/qr-cards.test.ts`

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { students } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { getQrCards, rotateQrToken } from "./qr-cards";

const HEX32 = /^[0-9a-f]{32}$/;

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const kid = async (fullName: string, extra: Partial<typeof students.$inferInsert> = {}, classId = b.classId) =>
    (await db.insert(students).values({ classId, fullName, ...extra }).returning())[0];
  return { db, b, kid };
}

describe("getQrCards", () => {
  it("gives the class catechist the active students with their tokens, ordered by name", async () => {
    const { db, b, kid } = await setup();
    const [binh, an] = [await kid("Bình"), await kid("An")];
    await kid("Ẩn", { active: false });
    const cards = await getQrCards(db, b.glv, b.classId);
    expect(cards?.map((c) => c.fullName)).toEqual(["An", "Bình"]);
    expect(cards?.[0]).toMatchObject({ studentId: an.id, token: an.qrToken });
    expect(cards?.[1].token).toBe(binh.qrToken);
    expect(cards?.[0].token).toMatch(HEX32);
  });

  it("returns null for the read-only grade head, for another class's catechist and for malformed ids", async () => {
    const { db, b } = await setup();
    expect(await getQrCards(db, b.head, b.classId)).toBeNull();
    expect(await getQrCards(db, b.otherGlv, b.classId)).toBeNull();
    expect(await getQrCards(db, b.glv, "not-a-uuid")).toBeNull();
  });
});

describe("rotateQrToken", () => {
  it("replaces only that student's token; the old token stops matching anyone", async () => {
    const { db, b, kid } = await setup();
    const [an, binh] = [await kid("An"), await kid("Bình")];
    expect((await rotateQrToken(db, b.glv, { studentId: an.id })).ok).toBe(true);
    const [after] = await db.select().from(students).where(eq(students.id, an.id));
    expect(after.qrToken).toMatch(HEX32);
    expect(after.qrToken).not.toBe(an.qrToken);
    expect(await db.select().from(students).where(eq(students.qrToken, an.qrToken))).toHaveLength(0);
    const [other] = await db.select().from(students).where(eq(students.id, binh.id));
    expect(other.qrToken).toBe(binh.qrToken);
  });

  it("is refused for the read-only head and other classes' catechists, and leaves the token unchanged", async () => {
    const { db, b, kid } = await setup();
    const an = await kid("An");
    for (const user of [b.head, b.otherGlv]) {
      expect(await rotateQrToken(db, user, { studentId: an.id })).toEqual({ ok: false, error: "Không tìm thấy thiếu nhi" });
    }
    expect((await rotateQrToken(db, b.glv, { studentId: "not-a-uuid" })).ok).toBe(false);
    const [row] = await db.select().from(students).where(eq(students.id, an.id));
    expect(row.qrToken).toBe(an.qrToken);
  });
});
```

- [ ] **Step 2: Chạy để thấy lỗi**

Run: `pnpm test src/db/queries/students.test.ts src/server/services/qr-cards.test.ts`
Expected: FAIL — `qrToken` vẫn lọt vào kết quả; thiếu `qr-cards`.

- [ ] **Step 3: Loại token khỏi mọi truy vấn học sinh**

`src/db/queries/students.ts` (thay toàn bộ)

```ts
import { and, asc, eq } from "drizzle-orm";
import { students } from "../schema";
import type { Db } from "../types";

/** Mọi truy vấn thiếu nhi dùng danh sách cột này; `qrToken` cố ý vắng mặt để không lọt xuống client. */
export const studentColumns = {
  id: students.id,
  classId: students.classId,
  saintName: students.saintName,
  fullName: students.fullName,
  birthDate: students.birthDate,
  parentPhone: students.parentPhone,
  note: students.note,
  active: students.active,
} as const;

export function listStudents(db: Db, classId: string, includeInactive = false) {
  const where = includeInactive ? eq(students.classId, classId) : and(eq(students.classId, classId), eq(students.active, true));
  return db.select(studentColumns).from(students).where(where).orderBy(asc(students.fullName));
}

export async function getStudent(db: Db, id: string) {
  const [row] = await db.select(studentColumns).from(students).where(eq(students.id, id));
  return row ?? null;
}
```

Trong `src/db/queries/stats.ts` (`rosterOf`) và `src/db/queries/attendance.ts` (`loadBoardData`, biến `roster`) đổi `db.select().from(students)` thành `db.select(studentColumns).from(students)` (import `studentColumns` từ `./students`). Trong `src/server/services/students.ts` (`importStudents`) đổi truy vấn các em hiện có thành `tx.select({ fullName: students.fullName, birthDate: students.birthDate }).from(students).where(...)`. Rà soát: `grep -rn "from(students)" src` không còn chỗ nào gọi `.select()` không tham số trừ trong file test.

- [ ] **Step 4: Cài đặt truy vấn, service**

`src/db/queries/qr-cards.ts`

```ts
import { and, asc, eq } from "drizzle-orm";
import { students } from "../schema";
import type { Db } from "../types";

export interface QrCard { studentId: string; fullName: string; saintName: string | null; token: string }

/** Nơi DUY NHẤT (cùng bảng tra của màn quét) đọc `qr_token`. Chỉ gọi sau khi đã kiểm quyền ghi lớp. */
export function listQrCards(db: Db, classId: string): Promise<QrCard[]> {
  return db
    .select({ studentId: students.id, fullName: students.fullName, saintName: students.saintName, token: students.qrToken })
    .from(students)
    .where(and(eq(students.classId, classId), eq(students.active, true)))
    .orderBy(asc(students.fullName));
}
```

`src/server/services/qr-cards.ts`

```ts
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { listQrCards, type QrCard } from "@/db/queries/qr-cards";
import { getStudent } from "@/db/queries/students";
import { students } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { guardClass } from "../guard";
import { fail, ok, type ActionResult } from "../result";

const NOT_FOUND_STUDENT = "Không tìm thấy thiếu nhi";

export async function getQrCards(db: Db, user: AppUser, classId: string): Promise<QrCard[] | null> {
  if (!(await guardClass(db, user, classId, "write"))) return null;
  return listQrCards(db, classId);
}

/** Cấp mã mới cho đúng một em (khi mất thẻ); thẻ cũ vô hiệu ngay. Mã mới do database sinh. */
export async function rotateQrToken(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = z.object({ studentId: z.string() }).safeParse(input);
  if (!p.success || !z.uuid().safeParse(p.data.studentId).success) return fail(NOT_FOUND_STUDENT);
  const student = await getStudent(db, p.data.studentId);
  if (!student || !(await guardClass(db, user, student.classId, "write"))) return fail(NOT_FOUND_STUDENT);
  await db.update(students).set({ qrToken: sql`replace(gen_random_uuid()::text, '-', '')` }).where(eq(students.id, student.id));
  return ok(undefined);
}
```

- [ ] **Step 5: Chạy test**

Run: `pnpm test src/db/queries/students.test.ts src/server/services/qr-cards.test.ts`
Expected: PASS. Chạy cả bộ `pnpm test --maxWorkers=2` để chắc không test cũ nào hỏng vì đổi cột.

- [ ] **Step 6: Trang in thẻ và cấp lại mã**

`the-qr/actions.ts`

```ts
"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { rotateQrToken } from "@/server/services/qr-cards";

export async function rotateQrTokenAction(classId: string, studentId: string) {
  const result = await rotateQrToken(db, await requireUser(), { studentId });
  if (result.ok) revalidatePath(`/lop/${classId}/thieu-nhi/the-qr`);
  return result;
}
```

`the-qr/CardTools.tsx` (Client; **không nhận token**)

```tsx
"use client";
import { Printer, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { rotateQrTokenAction } from "./actions";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn btn-primary btn-lg print:hidden">
      <Printer aria-hidden size={20} /> In thẻ
    </button>
  );
}

export function RotateButton({ classId, studentId, fullName }: { classId: string; studentId: string; fullName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function rotate() {
    if (!window.confirm(`Cấp lại mã cho ${fullName}? Thẻ cũ của em sẽ không dùng được nữa.`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await rotateQrTokenAction(classId, studentId);
      if (!result.ok) setError(result.error); else router.refresh();
    } catch {
      setError("Không cấp lại được, thử lại sau.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="print:hidden">
      <button type="button" onClick={rotate} disabled={busy} aria-label={`Cấp lại mã cho ${fullName}`} className="btn btn-secondary">
        <RefreshCw aria-hidden size={16} /> Cấp lại mã
      </button>
      {error && <p role="alert" className="mt-1 text-sm text-warn-alert">{error}</p>}
    </div>
  );
}
```

`the-qr/page.tsx` (Server Component; mã QR đi vào trang dưới dạng ảnh `data:` sinh ở máy chủ, **không** dùng `dangerouslySetInnerHTML`)

```tsx
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getClassById } from "@/db/queries/classes";
import { requireUser } from "@/lib/auth/dal";
import { qrSvg } from "@/lib/qr/generate";
import { formatQrPayload } from "@/lib/qr/payload";
import { getQrCards } from "@/server/services/qr-cards";
import { PrintButton, RotateButton } from "./CardTools";

export default async function QrCardsPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const user = await requireUser();
  const cards = await getQrCards(db, user, classId); // null nếu không có quyền ghi (kể cả trưởng khối chỉ đọc)
  if (!cards) notFound();
  const cls = await getClassById(db, classId);
  const items = await Promise.all(
    cards.map(async (c) => ({
      studentId: c.studentId,
      fullName: c.fullName,
      saintName: c.saintName,
      src: `data:image/svg+xml;utf8,${encodeURIComponent(await qrSvg(formatQrPayload(c.token)))}`,
    })),
  );
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h2 className="text-xl font-semibold">Thẻ QR · {cls?.name}</h2>
          <p className="text-sm text-ink-soft">{items.length} em. Cắt theo nét đứt, nên ép plastic. Mã chỉ dùng được khi giáo lý viên đăng nhập.</p>
        </div>
        <PrintButton />
      </div>
      {items.length === 0 && <p className="text-ink-soft">Lớp chưa có thiếu nhi nào.</p>}
      <ul className="qr-sheet">
        {items.map((c) => (
          <li key={c.studentId} className="qr-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.src} alt={`Mã QR của ${c.fullName}`} className="qr-img" />
            <div className="min-w-0">
              {c.saintName && <p className="text-sm text-ink-soft">{c.saintName}</p>}
              <p className="font-display text-lg font-semibold leading-tight">{c.fullName}</p>
              <p className="text-sm text-ink-soft">{cls?.name}</p>
              <RotateButton classId={classId} studentId={c.studentId} fullName={c.fullName} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

Thêm vào `src/app/globals.css`:

```css
.qr-sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.qr-card { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px dashed var(--border-strong); border-radius: 10px; background: #fff; break-inside: avoid; }
.qr-img { width: 112px; height: 112px; flex: none; }

@media print {
  @page { size: A4; margin: 10mm; }
  body { background: #fff; }
  .qr-sheet { grid-template-columns: repeat(2, 90mm); gap: 4mm; justify-content: center; }
  .qr-card { width: 90mm; height: 55mm; border: 0.3mm dashed #94a3b8; border-radius: 0; padding: 4mm; }
  .qr-img { width: 34mm; height: 34mm; }
}
```

Thêm `print:hidden` vào `<nav>` của `BottomNav` và vào phần header/tab của layout trang lớp để khi in chỉ còn lưới thẻ. Trong `thieu-nhi/page.tsx`, ở khối chỉ hiện cho người có quyền ghi, thêm liên kết "In thẻ QR" (`<Link href={`/lop/${classId}/thieu-nhi/the-qr`} …>` dùng cùng lớp CSS nút với các nút lân cận trong `RosterTools.tsx`).

- [ ] **Step 7: Kiểm tra và commit**

Run: `pnpm test --maxWorkers=2 && pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: pass. Thủ công (cần DB): đăng nhập GLV → Thiếu nhi → "In thẻ QR" → thấy lưới thẻ; xem trước bản in (Ctrl+P) chỉ còn thẻ; bấm "Cấp lại mã" có hộp xác nhận; đăng nhập trưởng khối chỉ đọc mở URL trang thẻ → 404. Mở "Xem nguồn trang" của `/lop/<id>/thieu-nhi` (danh sách) và tìm chuỗi `dd1.` → **không có**.

```bash
git add src
git commit -m "feat: print QR cards, rotate tokens, keep tokens out of student queries"
```

---

### Task 18: Dịch vụ quét, hoàn tác, bảng tra và route API (ghi đồng bộ)

**Files:**
- Create: `src/db/queries/scan.ts`, `src/server/services/scan.ts`, `src/server/services/scan.test.ts`, `src/server/services/scan-undo.test.ts`, `src/server/services/scan-roster.test.ts`, `src/lib/rate-limit.ts`, `src/lib/rate-limit.test.ts`, `src/server/http/scan-api.ts`, `src/server/http/scan-api.test.ts`, `src/server/http/limiter.ts`, `src/app/api/diem-danh/quet/route.ts`, `src/app/api/diem-danh/hoan-tac/route.ts`, `src/app/api/diem-danh/bang-tra/route.ts`, `src/app/api/diem-danh/ket-qua/route.ts`
- Modify: `src/proxy.ts` (loại `/api` khỏi chuyển hướng), `src/server/services/attendance.ts` (xuất hằng thông báo)

**Interfaces:**
- Consumes: `decideScan`, `ScanMode`, `CurrentMark`, `attendanceScans`, `attendance.lastEventId`, `students.qrToken`, `guardClass`, `getSession`, `loadBoardData`, `unexcusedCount` (không cần), `AppUser`.
- Produces (`src/server/services/scan.ts`):
  - `type ScanErrorCode = "bad_request" | "forbidden" | "invalid_card" | "cancelled" | "event_conflict" | "conflict" | "rate_limited" | "unauthenticated"`
  - `type ScanResponse<T> = { ok: true; data: T } | { ok: false; code: ScanErrorCode; error: string }`
  - `interface ScanOutcome { eventId: string; result: "applied" | "noop" | "needs_confirm"; studentId: string; fullName: string; saintName: string | null; status: AttendanceStatus | null; reason?: "already_present" | "already_late"; current?: "absent_excused" | "absent_unexcused"; defaultStatus?: "present" | "late" }`
  - `applyScan(db, user, input: unknown): Promise<ScanResponse<ScanOutcome>>` — input `{ eventId, sessionId, mode, confirmStatus?, capturedAt?, kind: "scan", token } | { …, kind: "manual", studentId }`
  - `interface UndoOutcome { eventId: string; targetEventId: string; studentId: string; status: AttendanceStatus | null }`; `applyUndo(db, user, input: unknown): Promise<ScanResponse<UndoOutcome>>` — input `{ eventId, sessionId, targetEventId }`
  - `interface ScanRosterEntry { studentId: string; fullName: string; saintName: string | null; token: string; status: AttendanceStatus | null; reason: string | null; priorUnexcused: number }`; `getScanRoster(db, user, sessionId): Promise<{ sessionId: string; classId: string; heldOn: string; cancelled: boolean; students: ScanRosterEntry[] } | null>` (chỉ người có quyền ghi)
  - `getScanResults(db, user, input: unknown): Promise<ScanResponse<{ results: { eventId: string; kind: "scan" | "manual" | "undo"; result: "applied" | "noop"; studentId: string | null; status: AttendanceStatus | null }[] }>>` — input `{ sessionId, eventIds: string[] (≤ 50) }`
- Produces (`src/lib/rate-limit.ts`): `createRateLimiter({ max, windowMs }): { hit(key: string, now?: number): { allowed: boolean; retryAfterMs: number } }`
- Produces (`src/server/http/scan-api.ts`): `isSameOrigin(headers: Headers): boolean`; `handleScanApi(route: "scan" | "undo" | "roster" | "results", request: Request, deps: { db: Db; getUser: () => Promise<AppUser | null>; limiter: RateLimiter }): Promise<Response>`

- [ ] **Step 1: Viết test lỗi cho dịch vụ quét** — `src/server/services/scan.test.ts`

```ts
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { attendance, attendanceScans, classCatechists, sessions, students, users } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { setStatus } from "./attendance";
import { applyScan } from "./scan";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const [session] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn: "2026-10-11" }).returning();
  const kid = async (fullName: string, extra: Partial<typeof students.$inferInsert> = {}, classId = b.classId) =>
    (await db.insert(students).values({ classId, fullName, ...extra }).returning())[0];
  const eid = () => crypto.randomUUID();
  const scan = (user: typeof b.glv, token: string, extra: Record<string, unknown> = {}, sessionId = session.id) =>
    applyScan(db, user, { eventId: eid(), sessionId, kind: "scan", token, mode: "present", ...extra });
  const rows = (studentId: string) => db.select().from(attendance).where(and(eq(attendance.sessionId, session.id), eq(attendance.studentId, studentId)));
  return { db, b, session, kid, eid, scan, rows };
}

describe("applyScan: recording", () => {
  it("records Có mặt for an unmarked student and links the row to the event", async () => {
    const { db, b, kid, scan, rows } = await setup();
    const an = await kid("An");
    const eventId = crypto.randomUUID();
    const r = await scan(b.glv, an.qrToken, { eventId });
    expect(r).toEqual({ ok: true, data: { eventId, result: "applied", studentId: an.id, fullName: "An", saintName: null, status: "present" } });
    expect((await rows(an.id))[0]).toMatchObject({ status: "present", lastEventId: eventId, updatedBy: b.glv.id });
    const [log] = await db.select().from(attendanceScans);
    expect(log).toMatchObject({ eventId, kind: "scan", result: "applied", prevStatus: null, newStatus: "present", actorId: b.glv.id, mode: "present" });
  });

  it("late mode records Đi muộn", async () => {
    const { b, kid, scan, rows } = await setup();
    const an = await kid("An");
    const r = await scan(b.glv, an.qrToken, { mode: "late" });
    expect(r.ok && r.data.status).toBe("late");
    expect((await rows(an.id))[0].status).toBe("late");
  });

  it("scanning an already-present student changes nothing", async () => {
    const { db, b, kid, scan, rows } = await setup();
    const an = await kid("An");
    await scan(b.glv, an.qrToken);
    const again = await scan(b.glv, an.qrToken, { mode: "late" });
    expect(again.ok && again.data).toMatchObject({ result: "noop", reason: "already_present", status: "present" });
    expect((await rows(an.id))[0].status).toBe("present");
    expect((await db.select().from(attendanceScans)).filter((l) => l.result === "noop")).toHaveLength(1);
  });

  it("scanning an already-late student never asks and never changes it", async () => {
    const { b, kid, scan, rows } = await setup();
    const an = await kid("An");
    await scan(b.glv, an.qrToken, { mode: "late" });
    const again = await scan(b.glv, an.qrToken);
    expect(again.ok && again.data).toMatchObject({ result: "noop", reason: "already_late", status: "late" });
    expect((await rows(an.id))[0].status).toBe("late");
  });

  it("an absent student needs confirmation; nothing is written until confirmed", async () => {
    const { db, b, session, kid, scan, rows } = await setup();
    const an = await kid("An");
    await setStatus(db, b.glv, { sessionId: session.id, studentId: an.id, status: "absent_unexcused", reason: "ốm" });
    const asked = await scan(b.glv, an.qrToken, { mode: "late" });
    expect(asked.ok && asked.data).toMatchObject({ result: "needs_confirm", current: "absent_unexcused", defaultStatus: "late", status: "absent_unexcused" });
    expect((await rows(an.id))[0].status).toBe("absent_unexcused");
    expect(await db.select().from(attendanceScans)).toHaveLength(0);

    const confirmed = await scan(b.glv, an.qrToken, { mode: "late", confirmStatus: "present" });
    expect(confirmed.ok && confirmed.data).toMatchObject({ result: "applied", status: "present" });
    const [log] = await db.select().from(attendanceScans);
    expect(log).toMatchObject({ prevStatus: "absent_unexcused", prevReason: "ốm", newStatus: "present" });
  });

  it("manual (find by name) uses the same rules with a studentId", async () => {
    const { b, kid, eid, session, db, rows } = await setup();
    const an = await kid("An");
    const r = await applyScan(db, b.glv, { eventId: eid(), sessionId: session.id, kind: "manual", studentId: an.id, mode: "present" });
    expect(r.ok && r.data.result).toBe("applied");
    expect((await rows(an.id))[0].status).toBe("present");
  });
});

describe("applyScan: rejections (nothing is written)", () => {
  it("unknown, rotated, hidden and other-class cards all get the same message", async () => {
    const { db, b, kid, scan } = await setup();
    const hidden = await kid("Ẩn", { active: false });
    const stranger = await kid("Lạ", {}, b.otherClassId);
    const rotated = await kid("Đổi");
    const oldToken = rotated.qrToken;
    await db.update(students).set({ qrToken: "f".repeat(32) }).where(eq(students.id, rotated.id));
    const messages = new Set<string>();
    for (const token of ["a".repeat(32), hidden.qrToken, stranger.qrToken, oldToken]) {
      const r = await scan(b.glv, token);
      expect(r).toMatchObject({ ok: false, code: "invalid_card" });
      if (!r.ok) messages.add(r.error);
    }
    expect([...messages]).toEqual(["Thẻ không dùng được cho lớp này"]);
    expect(await db.select().from(attendance)).toHaveLength(0);
    expect(await db.select().from(attendanceScans)).toHaveLength(0);
  });

  it("manual with a student of another class is refused", async () => {
    const { db, b, eid, session, kid } = await setup();
    const stranger = await kid("Lạ", {}, b.otherClassId);
    const r = await applyScan(db, b.glv, { eventId: eid(), sessionId: session.id, kind: "manual", studentId: stranger.id, mode: "present" });
    expect(r).toMatchObject({ ok: false, code: "invalid_card" });
  });

  it("read-only head, other catechists and unknown sessions all look like 'not found'", async () => {
    const { b, kid, scan } = await setup();
    const an = await kid("An");
    const forHead = await scan(b.head, an.qrToken);
    const forOther = await scan(b.otherGlv, an.qrToken);
    const unknown = await scan(b.glv, an.qrToken, {}, crypto.randomUUID());
    for (const r of [forHead, forOther, unknown]) expect(r).toMatchObject({ ok: false, code: "forbidden", error: "Không tìm thấy buổi học" });
  });

  it("a catechist removed from the class loses scan access immediately", async () => {
    const { db, b, kid, scan } = await setup();
    const an = await kid("An");
    await db.delete(classCatechists).where(and(eq(classCatechists.classId, b.classId), eq(classCatechists.userId, b.glv.id)));
    expect(await scan(b.glv, an.qrToken)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await db.select().from(attendance)).toHaveLength(0);
  });

  it("a cancelled session rejects scans", async () => {
    const { db, b, session, kid, scan } = await setup();
    const an = await kid("An");
    await db.update(sessions).set({ cancelled: true }).where(eq(sessions.id, session.id));
    expect(await scan(b.glv, an.qrToken)).toMatchObject({ ok: false, code: "cancelled" });
  });

  it("rejects malformed input", async () => {
    const { db, b } = await setup();
    for (const bad of [null, {}, { eventId: "x" }, { eventId: crypto.randomUUID(), sessionId: crypto.randomUUID(), kind: "scan", token: "short", mode: "present" }]) {
      expect(await applyScan(db, b.glv, bad)).toMatchObject({ ok: false, code: "bad_request" });
    }
  });
});

describe("applyScan: idempotency and races", () => {
  it("the same event sent twice returns the same result and logs once", async () => {
    const { db, b, kid, scan } = await setup();
    const an = await kid("An");
    const eventId = crypto.randomUUID();
    const first = await scan(b.glv, an.qrToken, { eventId });
    const second = await scan(b.glv, an.qrToken, { eventId });
    expect(second).toEqual(first);
    expect(await db.select().from(attendanceScans)).toHaveLength(1);
  });

  it("the same event id with a different payload or actor is a conflict", async () => {
    const { db, b, kid, scan } = await setup();
    const an = await kid("An");
    const eventId = crypto.randomUUID();
    await scan(b.glv, an.qrToken, { eventId });
    expect(await scan(b.glv, an.qrToken, { eventId, mode: "late" })).toMatchObject({ ok: false, code: "event_conflict" });
    const [second] = await db.insert(users).values({ email: "glv2@x.vn", name: "G2", passwordHash: "x", gradeId: b.gradeId }).returning();
    await db.insert(classCatechists).values({ classId: b.classId, userId: second.id });
    expect(await scan(second, an.qrToken, { eventId })).toMatchObject({ ok: false, code: "event_conflict" });
  });

  it("five identical concurrent requests leave one row, one log and the same answer", async () => {
    const { db, b, kid, scan, rows } = await setup();
    const an = await kid("An");
    const eventId = crypto.randomUUID();
    const all = await Promise.all([1, 2, 3, 4, 5].map(() => scan(b.glv, an.qrToken, { eventId })));
    for (const r of all) expect(r).toEqual(all[0]);
    expect(all[0]).toMatchObject({ ok: true, data: { result: "applied" } });
    expect(await rows(an.id)).toHaveLength(1);
    expect(await db.select().from(attendanceScans)).toHaveLength(1);
  });

  it("five different events for one student: one applied, four no-ops, one row", async () => {
    const { b, kid, scan, rows } = await setup();
    const an = await kid("An");
    const all = await Promise.all([1, 2, 3, 4, 5].map(() => scan(b.glv, an.qrToken)));
    expect(all.filter((r) => r.ok && r.data.result === "applied")).toHaveLength(1);
    expect(all.filter((r) => r.ok && r.data.result === "noop")).toHaveLength(4);
    expect(await rows(an.id)).toHaveLength(1);
  });

  it("scanning many different students concurrently records them all", async () => {
    const { b, kid, scan, db } = await setup();
    const kids = await Promise.all(Array.from({ length: 30 }, (_, i) => kid(`Em ${i}`)));
    const all = await Promise.all(kids.map((k) => scan(b.glv, k.qrToken)));
    expect(all.every((r) => r.ok && r.data.result === "applied")).toBe(true);
    expect(await db.select().from(attendance)).toHaveLength(30);
  });
});
```

- [ ] **Step 2: Viết test lỗi cho hoàn tác** — `src/server/services/scan-undo.test.ts`

```ts
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { attendance, attendanceScans, sessions, students } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { setStatus } from "./attendance";
import { applyScan, applyUndo } from "./scan";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const [session] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn: "2026-10-11" }).returning();
  const [an] = await db.insert(students).values({ classId: b.classId, fullName: "An" }).returning();
  const scan = async (extra: Record<string, unknown> = {}) => {
    const eventId = crypto.randomUUID();
    const r = await applyScan(db, b.glv, { eventId, sessionId: session.id, kind: "scan", token: an.qrToken, mode: "present", ...extra });
    return { eventId, r };
  };
  const undo = (targetEventId: string, extra: Record<string, unknown> = {}, user = b.glv) =>
    applyUndo(db, user, { eventId: crypto.randomUUID(), sessionId: session.id, targetEventId, ...extra });
  const row = async () => (await db.select().from(attendance).where(and(eq(attendance.sessionId, session.id), eq(attendance.studentId, an.id))))[0];
  return { db, b, session, an, scan, undo, row };
}

describe("applyUndo", () => {
  it("undoing a scan of an unmarked student deletes the row (never makes them absent)", async () => {
    const { scan, undo, row } = await setup();
    const { eventId } = await scan();
    const r = await undo(eventId);
    expect(r).toMatchObject({ ok: true, data: { targetEventId: eventId, status: null } });
    expect(await row()).toBeUndefined();
  });

  it("undoing a confirmed change restores the previous status and reason", async () => {
    const { db, b, session, an, scan, undo, row } = await setup();
    await setStatus(db, b.glv, { sessionId: session.id, studentId: an.id, status: "absent_excused", reason: "ốm" });
    const { eventId } = await scan({ confirmStatus: "present" });
    expect((await row()).status).toBe("present");
    expect((await undo(eventId)).ok).toBe(true);
    expect(await row()).toMatchObject({ status: "absent_excused", reason: "ốm", lastEventId: null });
  });

  it("refuses (conflict) when a newer manual edit exists and leaves it untouched", async () => {
    const { db, b, session, an, scan, undo, row } = await setup();
    const { eventId } = await scan();
    await setStatus(db, b.glv, { sessionId: session.id, studentId: an.id, status: "late", reason: null });
    expect(await undo(eventId)).toMatchObject({ ok: false, code: "conflict" });
    expect((await row()).status).toBe("late");
  });

  it("a second undo of the same scan is a conflict, an undo retry with the same id returns the stored result", async () => {
    const { scan, undo } = await setup();
    const { eventId } = await scan();
    const eventIdOfUndo = crypto.randomUUID();
    const first = await undo(eventId, { eventId: eventIdOfUndo });
    const retry = await undo(eventId, { eventId: eventIdOfUndo });
    expect(retry).toEqual(first);
    expect(await undo(eventId)).toMatchObject({ ok: false, code: "conflict" });
  });

  it("any catechist of the class can undo; the read-only head and other classes cannot", async () => {
    const { b, scan, undo, row } = await setup();
    const { eventId } = await scan();
    expect(await undo(eventId, {}, b.head)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await undo(eventId, {}, b.otherGlv)).toMatchObject({ ok: false, code: "forbidden" });
    expect((await row()).status).toBe("present");
  });

  it("cannot undo an event of another session, a no-op, or an unknown event", async () => {
    const { db, b, scan, undo } = await setup();
    const { eventId } = await scan();
    const noop = await scan();
    const [other] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn: "2026-10-04" }).returning();
    expect(await undo(eventId, { sessionId: other.id })).toMatchObject({ ok: false, code: "conflict" });
    expect(await undo(noop.eventId)).toMatchObject({ ok: false, code: "conflict" });
    expect(await undo(crypto.randomUUID())).toMatchObject({ ok: false, code: "conflict" });
    expect((await db.select().from(attendanceScans)).filter((l) => l.kind === "undo")).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Viết test lỗi cho bảng tra và tra kết quả** — `src/server/services/scan-roster.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { sessions, students } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { setStatus } from "./attendance";
import { applyScan, getScanResults, getScanRoster } from "./scan";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const mk = (heldOn: string) => db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn }).returning().then((r) => r[0]);
  return { db, b, mk };
}

describe("getScanRoster", () => {
  it("gives writers the active students with token, current mark and prior absences", async () => {
    const { db, b, mk } = await setup();
    const [an] = await db.insert(students).values({ classId: b.classId, fullName: "An", saintName: "Phêrô" }).returning();
    await db.insert(students).values({ classId: b.classId, fullName: "Ẩn", active: false });
    const [s1, s2] = [await mk("2026-10-04"), await mk("2026-10-11")];
    await setStatus(db, b.glv, { sessionId: s1.id, studentId: an.id, status: "absent_unexcused", reason: null });
    await setStatus(db, b.glv, { sessionId: s2.id, studentId: an.id, status: "late", reason: null });
    const roster = await getScanRoster(db, b.glv, s2.id);
    expect(roster?.students).toEqual([
      { studentId: an.id, fullName: "An", saintName: "Phêrô", token: an.qrToken, status: "late", reason: null, priorUnexcused: 1 },
    ]);
  });

  it("is null for the read-only head, other classes and malformed ids", async () => {
    const { db, b, mk } = await setup();
    const s = await mk("2026-10-11");
    expect(await getScanRoster(db, b.head, s.id)).toBeNull();
    expect(await getScanRoster(db, b.otherGlv, s.id)).toBeNull();
    expect(await getScanRoster(db, b.glv, "nope")).toBeNull();
  });
});

describe("getScanResults", () => {
  it("returns the stored result of known events and skips unknown ones", async () => {
    const { db, b, mk } = await setup();
    const [an] = await db.insert(students).values({ classId: b.classId, fullName: "An" }).returning();
    const s = await mk("2026-10-11");
    const eventId = crypto.randomUUID();
    await applyScan(db, b.glv, { eventId, sessionId: s.id, kind: "scan", token: an.qrToken, mode: "present" });
    const r = await getScanResults(db, b.glv, { sessionId: s.id, eventIds: [eventId, crypto.randomUUID()] });
    expect(r).toEqual({ ok: true, data: { results: [{ eventId, kind: "scan", result: "applied", studentId: an.id, status: "present" }] } });
  });

  it("is forbidden for non-writers and rejects more than 50 ids", async () => {
    const { db, b, mk } = await setup();
    const s = await mk("2026-10-11");
    expect(await getScanResults(db, b.head, { sessionId: s.id, eventIds: [] })).toMatchObject({ ok: false, code: "forbidden" });
    const many = Array.from({ length: 51 }, () => crypto.randomUUID());
    expect(await getScanResults(db, b.glv, { sessionId: s.id, eventIds: many })).toMatchObject({ ok: false, code: "bad_request" });
  });
});
```

- [ ] **Step 4: Chạy để thấy lỗi**

Run: `pnpm test src/server/services/scan.test.ts src/server/services/scan-undo.test.ts src/server/services/scan-roster.test.ts`
Expected: FAIL — thiếu `./scan`.

- [ ] **Step 5: Cài đặt truy vấn** — `src/db/queries/scan.ts`

```ts
import { and, eq, inArray, sql } from "drizzle-orm";
import { attendance, attendanceScans, classCatechists, sessions, students } from "../schema";
import type { Db } from "../types";

type Reader = Pick<Db, "select">;

/** Một truy vấn: buổi + quyền ghi của người dùng + lượt đã có cùng event_id (nếu là gửi lại). */
export async function loadScanContext(db: Reader, userId: string, sessionId: string, eventId: string) {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      classId: sessions.classId,
      cancelled: sessions.cancelled,
      canWrite: sql<boolean>`exists (select 1 from ${classCatechists} where ${classCatechists.classId} = ${sessions.classId} and ${classCatechists.userId} = ${userId})`,
      event: attendanceScans,
    })
    .from(sessions)
    .leftJoin(attendanceScans, eq(attendanceScans.eventId, eventId))
    .where(eq(sessions.id, sessionId));
  if (!row) return null;
  return { ...row, event: row.event?.eventId ? row.event : null };
}

/** Một truy vấn: em (theo mã thẻ hoặc id) trong đúng lớp, đang hiện, kèm trạng thái hiện có trong buổi. */
export async function findScanTarget(
  db: Reader,
  ctx: { sessionId: string; classId: string },
  by: { token: string } | { studentId: string },
) {
  const match = "token" in by ? eq(students.qrToken, by.token) : eq(students.id, by.studentId);
  const [row] = await db
    .select({
      id: students.id,
      fullName: students.fullName,
      saintName: students.saintName,
      status: attendance.status,
      reason: attendance.reason,
    })
    .from(students)
    .leftJoin(attendance, and(eq(attendance.studentId, students.id), eq(attendance.sessionId, ctx.sessionId)))
    .where(and(match, eq(students.classId, ctx.classId), eq(students.active, true)));
  return row ?? null;
}

export const getScanEvent = async (db: Reader, eventId: string) =>
  (await db.select().from(attendanceScans).where(eq(attendanceScans.eventId, eventId)))[0] ?? null;

export const listScanEvents = (db: Reader, sessionId: string, eventIds: string[]) =>
  eventIds.length === 0
    ? Promise.resolve([])
    : db.select().from(attendanceScans).where(and(eq(attendanceScans.sessionId, sessionId), inArray(attendanceScans.eventId, eventIds)));

export const listClassTokens = (db: Reader, classId: string) =>
  db.select({ id: students.id, token: students.qrToken }).from(students).where(and(eq(students.classId, classId), eq(students.active, true)));
```

- [ ] **Step 6: Cài đặt dịch vụ** — `src/server/services/scan.ts`

Xuất `NOT_FOUND_SESSION` và `CANCELLED` từ `attendance.ts` (đổi `const` thành `export const`) để dùng lại cùng thông báo.

```ts
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getSession, loadBoardData } from "@/db/queries/attendance";
import { findScanTarget, getScanEvent, listClassTokens, listScanEvents, loadScanContext } from "@/db/queries/scan";
import { attendance, attendanceScans, students } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { decideScan, type CurrentMark, type ScanDecision } from "@/lib/attendance/scan-rules";
import type { AttendanceStatus } from "@/lib/attendance/warning";
import { guardClass } from "../guard";
import { CANCELLED, NOT_FOUND_SESSION } from "./attendance";

export type ScanErrorCode =
  | "bad_request" | "forbidden" | "invalid_card" | "cancelled" | "event_conflict" | "conflict" | "rate_limited" | "unauthenticated";
export type ScanResponse<T> = { ok: true; data: T } | { ok: false; code: ScanErrorCode; error: string };

export interface ScanOutcome {
  eventId: string;
  result: "applied" | "noop" | "needs_confirm";
  studentId: string;
  fullName: string;
  saintName: string | null;
  status: AttendanceStatus | null;
  reason?: "already_present" | "already_late";
  current?: "absent_excused" | "absent_unexcused";
  defaultStatus?: "present" | "late";
}
export interface UndoOutcome { eventId: string; targetEventId: string; studentId: string; status: AttendanceStatus | null }

export const INVALID_CARD = "Thẻ không dùng được cho lớp này";
const reject = (code: ScanErrorCode, error: string) => ({ ok: false as const, code, error });
const success = <T,>(data: T): ScanResponse<T> => ({ ok: true, data });

const modeSchema = z.enum(["present", "late"]);
const scanSchema = z.object({
  eventId: z.uuid(),
  sessionId: z.uuid(),
  mode: modeSchema,
  confirmStatus: modeSchema.optional(),
  capturedAt: z.iso.datetime().optional(),
}).and(z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scan"), token: z.string().regex(/^[0-9a-f]{32}$/) }),
  z.object({ kind: z.literal("manual"), studentId: z.uuid() }),
]));
type ScanInput = z.infer<typeof scanSchema>;

const hash = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const scanHash = (i: ScanInput) => hash([i.kind, i.sessionId, i.kind === "scan" ? i.token : i.studentId, i.mode, i.confirmStatus ?? null]);

function uniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
interface Target { id: string; fullName: string; saintName: string | null }

async function replay(db: Db, event: typeof attendanceScans.$inferSelect): Promise<ScanResponse<ScanOutcome>> {
  const [student] = event.studentId
    ? await db.select({ fullName: students.fullName, saintName: students.saintName }).from(students).where(eq(students.id, event.studentId))
    : [];
  return success({
    eventId: event.eventId,
    result: event.result,
    studentId: event.studentId ?? "",
    fullName: student?.fullName ?? "",
    saintName: student?.saintName ?? null,
    status: event.newStatus,
    ...(event.result === "noop" ? { reason: event.newStatus === "late" ? ("already_late" as const) : ("already_present" as const) } : {}),
  });
}

async function writeScan(tx: Tx, ctx: { sessionId: string }, input: ScanInput, user: AppUser, target: Target, current: CurrentMark | null, decision: ScanDecision): Promise<ScanOutcome | null> {
  const base = { eventId: input.eventId, studentId: target.id, fullName: target.fullName, saintName: target.saintName };
  const log = { eventId: input.eventId, kind: input.kind, sessionId: ctx.sessionId, studentId: target.id, actorId: user.id, mode: input.mode, payloadHash: scanHash(input), prevStatus: current?.status ?? null, prevReason: current?.reason ?? null, capturedAt: input.capturedAt ? new Date(input.capturedAt) : null };

  if (decision.kind === "noop") {
    await tx.insert(attendanceScans).values({ ...log, newStatus: current!.status, result: "noop" });
    return { ...base, result: "noop", status: current!.status, reason: decision.reason };
  }
  if (decision.kind !== "apply") return null;

  const values = { status: decision.status, reason: null, updatedBy: user.id, updatedAt: new Date(), lastEventId: input.eventId };
  const written = current === null
    ? await tx.insert(attendance).values({ sessionId: ctx.sessionId, studentId: target.id, ...values }).onConflictDoNothing().returning({ s: attendance.status })
    : await tx.update(attendance).set(values)
        .where(and(eq(attendance.sessionId, ctx.sessionId), eq(attendance.studentId, target.id), eq(attendance.status, current.status)))
        .returning({ s: attendance.status });
  if (written.length === 0) return null; // người khác vừa đổi bản ghi: đọc lại và quyết định lại
  await tx.insert(attendanceScans).values({ ...log, newStatus: decision.status, result: "applied" });
  return { ...base, result: "applied", status: decision.status };
}

export async function applyScan(db: Db, user: AppUser, raw: unknown): Promise<ScanResponse<ScanOutcome>> {
  const parsed = scanSchema.safeParse(raw);
  if (!parsed.success) return reject("bad_request", "Yêu cầu không hợp lệ");
  const input = parsed.data;
  const ctx = await loadScanContext(db, user.id, input.sessionId, input.eventId);
  if (!ctx || !ctx.canWrite) return reject("forbidden", NOT_FOUND_SESSION);

  const sameRequest = (e: typeof attendanceScans.$inferSelect) => e.actorId === user.id && e.payloadHash === scanHash(input);
  if (ctx.event) {
    return sameRequest(ctx.event) ? replay(db, ctx.event) : reject("event_conflict", "Mã lượt đã được dùng cho thao tác khác");
  }
  if (ctx.cancelled) return reject("cancelled", CANCELLED);

  for (let attempt = 0; attempt < 3; attempt++) {
    const target = await findScanTarget(db, ctx, input.kind === "scan" ? { token: input.token } : { studentId: input.studentId });
    if (!target) return reject("invalid_card", INVALID_CARD);
    const current = target.status ? { status: target.status, reason: target.reason } : null;
    const decision = decideScan(current, input.mode, input.confirmStatus);
    if (decision.kind === "confirm") {
      return success({ eventId: input.eventId, result: "needs_confirm", studentId: target.id, fullName: target.fullName, saintName: target.saintName, status: current!.status, current: decision.current, defaultStatus: decision.defaultStatus });
    }
    try {
      const outcome = await db.transaction((tx) => writeScan(tx, ctx, input, user, target, current, decision));
      if (outcome) return success(outcome);
    } catch (e) {
      if (!uniqueViolation(e)) throw e;
      const event = await getScanEvent(db, input.eventId); // yêu cầu trùng chạy song song đã commit trước
      if (!event) throw e;
      return sameRequest(event) ? replay(db, event) : reject("event_conflict", "Mã lượt đã được dùng cho thao tác khác");
    }
  }
  return reject("conflict", "Dữ liệu vừa thay đổi, hãy thử lại");
}

const undoSchema = z.object({ eventId: z.uuid(), sessionId: z.uuid(), targetEventId: z.uuid() });

export async function applyUndo(db: Db, user: AppUser, raw: unknown): Promise<ScanResponse<UndoOutcome>> {
  const parsed = undoSchema.safeParse(raw);
  if (!parsed.success) return reject("bad_request", "Yêu cầu không hợp lệ");
  const { eventId, sessionId, targetEventId } = parsed.data;
  const ctx = await loadScanContext(db, user.id, sessionId, eventId);
  if (!ctx || !ctx.canWrite) return reject("forbidden", NOT_FOUND_SESSION);
  const payloadHash = hash(["undo", sessionId, targetEventId]);
  const stored = (e: typeof attendanceScans.$inferSelect): ScanResponse<UndoOutcome> =>
    e.actorId === user.id && e.payloadHash === payloadHash
      ? success({ eventId, targetEventId, studentId: e.studentId ?? "", status: e.newStatus })
      : reject("event_conflict", "Mã lượt đã được dùng cho thao tác khác");
  if (ctx.event) return stored(ctx.event);
  if (ctx.cancelled) return reject("cancelled", CANCELLED);

  try {
    return await db.transaction(async (tx): Promise<ScanResponse<UndoOutcome>> => {
      const [target] = await tx.select().from(attendanceScans).where(and(eq(attendanceScans.eventId, targetEventId), eq(attendanceScans.sessionId, sessionId)));
      if (!target || target.result !== "applied" || target.kind === "undo" || !target.studentId) return reject("conflict", "Không có gì để hoàn tác");
      const key = and(eq(attendance.sessionId, sessionId), eq(attendance.studentId, target.studentId));
      const [row] = await tx.select().from(attendance).where(key).for("update");
      if (!row || row.lastEventId !== targetEventId) return reject("conflict", "Bản ghi đã thay đổi, hãy kiểm tra lại");
      if (target.prevStatus === null) await tx.delete(attendance).where(key);
      else await tx.update(attendance).set({ status: target.prevStatus, reason: target.prevReason, updatedBy: user.id, updatedAt: new Date(), lastEventId: null }).where(key);
      await tx.insert(attendanceScans).values({
        eventId, kind: "undo", sessionId, studentId: target.studentId, actorId: user.id, payloadHash,
        prevStatus: row.status, prevReason: row.reason, newStatus: target.prevStatus, result: "applied", targetEventId,
      });
      return success({ eventId, targetEventId, studentId: target.studentId, status: target.prevStatus });
    });
  } catch (e) {
    if (!uniqueViolation(e)) throw e;
    const event = await getScanEvent(db, eventId);
    if (!event) throw e;
    return stored(event);
  }
}

export interface ScanRosterEntry {
  studentId: string; fullName: string; saintName: string | null; token: string;
  status: AttendanceStatus | null; reason: string | null; priorUnexcused: number;
}

/** Bảng tra cho màn quét: chỉ người có quyền ghi; có token nên TUYỆT ĐỐI không đưa vào trang/props khác. */
export async function getScanRoster(db: Db, user: AppUser, sessionId: string) {
  if (!z.uuid().safeParse(sessionId).success) return null;
  const session = await getSession(db, sessionId);
  if (!session || !(await guardClass(db, user, session.classId, "write"))) return null;
  const [board, tokens] = await Promise.all([loadBoardData(db, session), listClassTokens(db, session.classId)]);
  const tokenOf = new Map(tokens.map((t) => [t.id, t.token]));
  const students: ScanRosterEntry[] = board.students.map((s) => ({
    studentId: s.id, fullName: s.fullName, saintName: s.saintName, token: tokenOf.get(s.id) ?? "",
    status: s.status, reason: s.reason, priorUnexcused: s.priorUnexcused,
  }));
  return { sessionId: session.id, classId: session.classId, heldOn: session.heldOn, cancelled: session.cancelled, students };
}

const resultsSchema = z.object({ sessionId: z.uuid(), eventIds: z.array(z.uuid()).max(50) });

export async function getScanResults(db: Db, user: AppUser, raw: unknown) {
  const parsed = resultsSchema.safeParse(raw);
  if (!parsed.success) return reject("bad_request", "Yêu cầu không hợp lệ");
  const session = await getSession(db, parsed.data.sessionId);
  if (!session || !(await guardClass(db, user, session.classId, "write"))) return reject("forbidden", NOT_FOUND_SESSION);
  const events = await listScanEvents(db, session.id, parsed.data.eventIds);
  return success({
    results: events.map((e) => ({ eventId: e.eventId, kind: e.kind, result: e.result, studentId: e.studentId, status: e.newStatus })),
  });
}
```

- [ ] **Step 7: Chạy test dịch vụ**

Run: `pnpm test src/server/services/scan.test.ts src/server/services/scan-undo.test.ts src/server/services/scan-roster.test.ts`
Expected: PASS. Nếu một test đồng thời thất bại, đọc lỗi trước khi sửa: các ca "5 yêu cầu giống hệt" và "5 lượt khác nhau cho một em" kiểm tra đúng cơ chế `ON CONFLICT DO NOTHING` + vòng đọc lại + bắt lỗi trùng khóa; không nới lỏng assertion.

- [ ] **Step 8: Giới hạn tốc độ** — test trước

`src/lib/rate-limit.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to max hits per window, then blocks with a retry hint", () => {
    const l = createRateLimiter({ max: 3, windowMs: 1000 });
    expect([1, 2, 3].map((i) => l.hit("u", i * 10).allowed)).toEqual([true, true, true]);
    expect(l.hit("u", 40)).toEqual({ allowed: false, retryAfterMs: 970 });
  });
  it("lets traffic through again once old hits leave the window", () => {
    const l = createRateLimiter({ max: 2, windowMs: 1000 });
    l.hit("u", 0); l.hit("u", 100);
    expect(l.hit("u", 500).allowed).toBe(false);
    expect(l.hit("u", 1001).allowed).toBe(true);
  });
  it("tracks keys independently", () => {
    const l = createRateLimiter({ max: 1, windowMs: 1000 });
    expect(l.hit("a", 0).allowed).toBe(true);
    expect(l.hit("b", 0).allowed).toBe(true);
    expect(l.hit("a", 1).allowed).toBe(false);
  });
});
```

`src/lib/rate-limit.ts`

```ts
export interface RateLimiter { hit(key: string, now?: number): { allowed: boolean; retryAfterMs: number } }

/** Cửa sổ trượt trong bộ nhớ của từng instance (đủ để chặn lạm dụng đơn giản; không phải hạn mức toàn hệ thống). */
export function createRateLimiter(opts: { max: number; windowMs: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    hit(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => t > now - opts.windowMs);
      if (recent.length >= opts.max) {
        hits.set(key, recent);
        return { allowed: false, retryAfterMs: recent[0] + opts.windowMs - now };
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => t <= now - opts.windowMs)) hits.delete(k);
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}
```

Run: `pnpm test src/lib/rate-limit.test.ts` — Expected: FAIL trước khi có file, PASS sau.

- [ ] **Step 9: Test lỗi cho lớp HTTP** — `src/server/http/scan-api.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { sessions, students } from "@/db/schema";
import { createRateLimiter } from "@/lib/rate-limit";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { handleScanApi, isSameOrigin } from "./scan-api";

const HOST = "app.example.com";
const goodHeaders = { "content-type": "application/json", origin: `https://${HOST}`, host: HOST };

async function setup(max = 1000) {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const [session] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn: "2026-10-11" }).returning();
  const [an] = await db.insert(students).values({ classId: b.classId, fullName: "An" }).returning();
  const deps = (user: typeof b.glv | null) => ({ db, getUser: async () => user, limiter: createRateLimiter({ max, windowMs: 60_000 }) });
  const post = (body: unknown, headers: Record<string, string> = goodHeaders) =>
    new Request(`https://${HOST}/api/diem-danh/quet`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  const scanBody = (token = an.qrToken) => ({ eventId: crypto.randomUUID(), sessionId: session.id, kind: "scan", token, mode: "present" });
  return { db, b, session, an, deps, post, scanBody };
}

describe("isSameOrigin", () => {
  it("accepts only an Origin whose host equals the request host", () => {
    expect(isSameOrigin(new Headers({ origin: `https://${HOST}`, host: HOST }))).toBe(true);
    expect(isSameOrigin(new Headers({ origin: "https://evil.example", host: HOST }))).toBe(false);
    expect(isSameOrigin(new Headers({ host: HOST }))).toBe(false);
    expect(isSameOrigin(new Headers({ origin: "not a url", host: HOST }))).toBe(false);
    expect(isSameOrigin(new Headers({ origin: `https://${HOST}`, "x-forwarded-host": HOST, host: "internal:3000" }))).toBe(true);
  });
});

describe("handleScanApi POST", () => {
  it("scans for a logged-in catechist and sets no-store", async () => {
    const { b, deps, post, scanBody } = await setup();
    const res = await handleScanApi("scan", post(scanBody()), deps(b.glv));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({ ok: true, data: { result: "applied", status: "present" } });
  });

  it("rejects anonymous callers (401), foreign origins (403), non-JSON (415), oversized (413), bad JSON (400)", async () => {
    const { b, deps, post, scanBody } = await setup();
    expect((await handleScanApi("scan", post(scanBody()), deps(null))).status).toBe(401);
    expect((await handleScanApi("scan", post(scanBody(), { ...goodHeaders, origin: "https://evil.example" }), deps(b.glv))).status).toBe(403);
    expect((await handleScanApi("scan", post(scanBody(), { ...goodHeaders, "content-type": "text/plain" }), deps(b.glv))).status).toBe(415);
    expect((await handleScanApi("scan", post("x".repeat(5000)), deps(b.glv))).status).toBe(413);
    expect((await handleScanApi("scan", post("{not json"), deps(b.glv))).status).toBe(400);
  });

  it("maps business outcomes: forbidden -> 404, invalid card -> 200 ok:false, event conflict -> 409", async () => {
    const { b, deps, post, scanBody } = await setup();
    const forHead = await handleScanApi("scan", post(scanBody()), deps(b.head));
    expect(forHead.status).toBe(404);
    const bad = await handleScanApi("scan", post(scanBody("a".repeat(32))), deps(b.glv));
    expect(bad.status).toBe(200);
    expect(await bad.json()).toMatchObject({ ok: false, code: "invalid_card" });
    const body = scanBody();
    await handleScanApi("scan", post(body), deps(b.glv));
    const conflict = await handleScanApi("scan", post({ ...body, mode: "late" }), deps(b.glv));
    expect(conflict.status).toBe(409);
  });

  it("rate limits per user with 429 and Retry-After", async () => {
    const { b, post, scanBody, db } = await setup();
    const d = { db, getUser: async () => b.glv, limiter: createRateLimiter({ max: 2, windowMs: 60_000 }) };
    await handleScanApi("scan", post(scanBody()), d);
    await handleScanApi("scan", post(scanBody()), d);
    const res = await handleScanApi("scan", post(scanBody()), d);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("undo goes through the same guards", async () => {
    const { b, session, deps, post, scanBody } = await setup();
    const body = scanBody();
    await handleScanApi("scan", post(body), deps(b.glv));
    const ok = await handleScanApi("undo", post({ eventId: crypto.randomUUID(), sessionId: session.id, targetEventId: body.eventId }), deps(b.glv));
    expect(await ok.json()).toMatchObject({ ok: true, data: { status: null } });
    const anon = await handleScanApi("undo", post({}), deps(null));
    expect(anon.status).toBe(401);
  });
});

describe("handleScanApi GET roster", () => {
  const get = (sessionId: string, headers: Record<string, string> = {}) =>
    new Request(`https://${HOST}/api/diem-danh/bang-tra?sessionId=${sessionId}`, { headers: { host: HOST, ...headers } });

  it("returns tokens only to writers, with no-store, and 404 to everyone else", async () => {
    const { b, an, session, deps } = await setup();
    const res = await handleScanApi("roster", get(session.id), deps(b.glv));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const json = await res.json();
    expect(json.data.students[0]).toMatchObject({ fullName: "An", token: an.qrToken });
    expect((await handleScanApi("roster", get(session.id), deps(b.head))).status).toBe(404);
    expect((await handleScanApi("roster", get(session.id), deps(b.otherGlv))).status).toBe(404);
    expect((await handleScanApi("roster", get(session.id), deps(null))).status).toBe(401);
  });

  it("refuses cross-site fetches", async () => {
    const { b, session, deps } = await setup();
    const res = await handleScanApi("roster", get(session.id, { "sec-fetch-site": "cross-site" }), deps(b.glv));
    expect(res.status).toBe(403);
  });
});
```

Run: `pnpm test src/server/http` — Expected: FAIL (thiếu `scan-api`).

- [ ] **Step 10: Cài đặt lớp HTTP** — `src/server/http/scan-api.ts`

```ts
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import type { RateLimiter } from "@/lib/rate-limit";
import { applyScan, applyUndo, getScanResults, getScanRoster, type ScanErrorCode } from "../services/scan";

export type ScanRoute = "scan" | "undo" | "roster" | "results";
export interface ScanApiDeps { db: Db; getUser: () => Promise<AppUser | null>; limiter: RateLimiter }

const MAX_BODY = 4096;
const HEADERS = { "Cache-Control": "private, no-store" };
const STATUS: Record<ScanErrorCode, number> = {
  bad_request: 400, forbidden: 404, invalid_card: 200, cancelled: 200, conflict: 200,
  event_conflict: 409, rate_limited: 429, unauthenticated: 401,
};

export function isSameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

const respond = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...HEADERS, "Content-Type": "application/json", ...extra } });
const error = (code: ScanErrorCode, message: string, extra?: Record<string, string>) =>
  respond({ ok: false, code, error: message }, STATUS[code], extra);

async function readBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  if (!request.headers.get("content-type")?.includes("application/json")) return { ok: false, response: respond({ ok: false, code: "bad_request", error: "Kiểu dữ liệu không hợp lệ" }, 415) };
  const text = await request.text();
  if (text.length > MAX_BODY) return { ok: false, response: respond({ ok: false, code: "bad_request", error: "Yêu cầu quá lớn" }, 413) };
  try { return { ok: true, body: JSON.parse(text) }; } catch { return { ok: false, response: error("bad_request", "Yêu cầu không hợp lệ") }; }
}

export async function handleScanApi(route: ScanRoute, request: Request, deps: ScanApiDeps): Promise<Response> {
  const user = await deps.getUser();
  if (!user) return error("unauthenticated", "Bạn cần đăng nhập");

  if (route === "roster") {
    if (request.headers.get("sec-fetch-site") === "cross-site") return error("forbidden", "Không tìm thấy buổi học");
    const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
    const roster = await getScanRoster(deps.db, user, sessionId);
    return roster ? respond({ ok: true, data: roster }) : error("forbidden", "Không tìm thấy buổi học");
  }

  if (!isSameOrigin(request.headers)) return error("forbidden", "Yêu cầu không hợp lệ");
  const limit = deps.limiter.hit(user.id);
  if (!limit.allowed) return error("rate_limited", "Quá nhiều lượt, thử lại sau giây lát", { "Retry-After": String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))) });
  const body = await readBody(request);
  if (!body.ok) return body.response;

  const result = route === "scan" ? await applyScan(deps.db, user, body.body)
    : route === "undo" ? await applyUndo(deps.db, user, body.body)
    : await getScanResults(deps.db, user, body.body);
  return result.ok ? respond(result) : respond(result, STATUS[result.code]);
}
```

`src/server/http/limiter.ts`

```ts
import { createRateLimiter } from "@/lib/rate-limit";

/** Quét liên tục ≈ 1 lượt/giây; 180/phút còn dư chỗ cho gửi lại, hoàn tác và tìm tên. */
export const scanLimiter = createRateLimiter({ max: 180, windowMs: 60_000 });
```

Bốn route (mỗi file như sau; đổi tên route và phương thức):

```ts
// src/app/api/diem-danh/quet/route.ts
import { db } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/dal";
import { handleScanApi } from "@/server/http/scan-api";
import { scanLimiter } from "@/server/http/limiter";

export const POST = (request: Request) => handleScanApi("scan", request, { db, getUser: getCurrentUser, limiter: scanLimiter });
```

`hoan-tac/route.ts` → `POST` với `"undo"`; `ket-qua/route.ts` → `POST` với `"results"`; `bang-tra/route.ts` → `export const GET = (request: Request) => handleScanApi("roster", request, {…})`.

Trong `src/proxy.ts` đổi matcher thành `"/((?!api/|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon-.*|apple-icon.*).*)"` — API tự trả 401 JSON, không chuyển hướng HTML.

- [ ] **Step 11: Chạy toàn bộ**

Run: `pnpm test --maxWorkers=2 && pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: pass. Thủ công (cần DB): `curl` không cookie tới `/api/diem-danh/quet` → 401 JSON; đăng nhập rồi gọi bằng trình duyệt trong console `fetch("/api/diem-danh/bang-tra?sessionId=…")` → trả danh sách có token (chỉ khi là GLV của lớp).

- [ ] **Step 12: Cổng chất lượng Task 18**

Chạy agent **security-reviewer** trên toàn bộ diff của Task 17–18 (token, route handler, CSRF/Origin, rate limit, quyền) và **code-reviewer**; sửa mọi CRITICAL/HIGH. Đặc biệt kiểm tra: mọi nơi đọc `qrToken`; response không bao giờ chứa token của lớp khác; lỗi 5xx không lộ chi tiết.

- [ ] **Step 13: Commit**

```bash
git add src
git commit -m "feat: add synchronous scan, undo and roster services with guarded API routes"
```

---

### Task 19: Màn quét liên tục (hàng gửi nền, công tắc Có mặt/Đi muộn, tìm tên, hoàn tác)

**Files:**
- Create: `src/lib/attendance/scan-queue.ts`, `src/lib/attendance/scan-queue.test.ts`, `src/lib/qr/frame-deduper.ts`, `src/lib/qr/frame-deduper.test.ts`, `src/lib/attendance/roster-search.ts`, `src/lib/attendance/roster-search.test.ts`, `src/components/scan/api.ts`, `src/components/scan/QrCamera.tsx`, `src/components/scan/useScanSession.ts`, `src/components/scan/ScanScreen.tsx`, `src/app/(app)/lop/[classId]/diem-danh/[date]/quet/page.tsx`
- Modify: `src/app/(app)/lop/[classId]/diem-danh/[date]/AttendanceBoard.tsx` (nút "Quét QR")

**Interfaces:**
- Consumes: `decideScan`, `ScanMode`, `CurrentMark`, `parseQrPayload`, `createQrDecoder`, `ScanRosterEntry`, `ScanOutcome`, `UndoOutcome`, `Sheet`, `Pill`/`StatusPill`, `Notice`, `EmptyState`, `STATUS_META`, các route `/api/diem-danh/{quet,hoan-tac,bang-tra,ket-qua}`.
- Produces (thuần, có test):
  - `type EventState = "sending" | "saved" | "needs_confirm" | "rejected" | "failed" | "undone"`
  - `interface QueuedEvent { eventId; kind: "scan" | "manual"; studentId; fullName; saintName: string | null; mode: ScanMode; token?: string; confirmStatus?: "present" | "late"; optimisticStatus: "present" | "late"; prev: CurrentMark | null; capturedAt: string; state: EventState; inFlight: boolean; attempts: number; notBefore?: number; result?: "applied" | "noop"; serverStatus?: AttendanceStatus | null; message?: string; undoBusy: boolean; undoError?: string }`
  - `interface ScanQueueState { events: QueuedEvent[] }`; `initialQueue`; `queueReducer(state, action: ScanAction): ScanQueueState`
  - `summarizeQueue(state): { saved: number; sending: number; needsAction: number }`; `sendable(state, now?: number): QueuedEvent[]` (bỏ qua lượt có `notBefore > now`); `pendingCount(state): number`; `canEnqueue(state, limit?: number): boolean`; `recentEvents(state, n: number): QueuedEvent[]` (mới nhất trước); `backoffMs(attempt: number): number | null` (0,5s / 1,5s / 4s rồi `null`)
  - `createFrameDeduper(gapMs?: number): { accept(code: string, nowMs: number): boolean }`
  - `filterRoster<T extends { fullName: string; saintName: string | null }>(roster: T[], query: string, limit?: number): T[]`

- [ ] **Step 0: Đối chiếu lớp CSS thật**

Run: `grep -E "^\s*\.(btn|input|card|label|switch)" src/app/globals.css | head -30`
Mã mẫu bên dưới dùng `btn btn-primary|btn-secondary|btn-lg`, `card`, `input`: đổi cho khớp tên lớp thật nếu khác. Mở `ScanScreen` cạnh `AttendanceBoard.tsx` để giữ cùng nhịp spacing/typography.

- [ ] **Step 1: Viết test lỗi cho các hàm thuần**

`src/lib/attendance/scan-queue.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { backoffMs, canEnqueue, initialQueue, pendingCount, queueReducer, recentEvents, sendable, summarizeQueue, type QueuedEvent, type ScanQueueState } from "./scan-queue";

const ev = (id: string, studentId = "s1", extra: Partial<QueuedEvent> = {}) => ({
  eventId: id, kind: "scan" as const, studentId, fullName: "An", saintName: null, mode: "present" as const,
  token: "t", optimisticStatus: "present" as const, prev: null, capturedAt: "2026-10-11T08:00:00.000Z", undoBusy: false, ...extra,
});
const enqueue = (s: ScanQueueState, ...evs: ReturnType<typeof ev>[]) => evs.reduce((acc, e) => queueReducer(acc, { type: "enqueue", event: e }), s);

describe("queueReducer", () => {
  it("enqueues as sending and offers it for sending once", () => {
    let s = enqueue(initialQueue, ev("e1"));
    expect(sendable(s).map((e) => e.eventId)).toEqual(["e1"]);
    s = queueReducer(s, { type: "started", eventId: "e1" });
    expect(sendable(s)).toEqual([]);
  });

  it("sends one event per student at a time, in order; other students go in parallel", () => {
    const s = enqueue(initialQueue, ev("a1", "A"), ev("a2", "A"), ev("b1", "B"));
    expect(sendable(s).map((e) => e.eventId)).toEqual(["a1", "b1"]);
    const afterA1 = queueReducer(queueReducer(s, { type: "started", eventId: "a1" }), { type: "resolved", eventId: "a1", result: "applied", status: "present" });
    expect(sendable(afterA1).map((e) => e.eventId)).toEqual(["a2", "b1"]);
  });

  it("resolved applied/noop become saved; needs_confirm and rejected need action", () => {
    let s = enqueue(initialQueue, ev("e1", "A"), ev("e2", "B"), ev("e3", "C"));
    s = queueReducer(s, { type: "resolved", eventId: "e1", result: "applied", status: "present" });
    s = queueReducer(s, { type: "needs_confirm", eventId: "e2", status: "absent_unexcused" });
    s = queueReducer(s, { type: "rejected", eventId: "e3", message: "Thẻ không dùng được cho lớp này" });
    expect(summarizeQueue(s)).toEqual({ saved: 1, sending: 0, needsAction: 2 });
    expect(s.events.find((e) => e.eventId === "e3")?.message).toBe("Thẻ không dùng được cho lớp này");
  });

  it("noop results are saved but do not count as newly recorded students", () => {
    const s = queueReducer(enqueue(initialQueue, ev("e1")), { type: "resolved", eventId: "e1", result: "noop", status: "present" });
    expect(summarizeQueue(s)).toEqual({ saved: 0, sending: 0, needsAction: 0 });
    expect(s.events[0].state).toBe("saved");
  });

  it("network errors retry with the same event until attempts run out, then need action", () => {
    let s = enqueue(initialQueue, ev("e1"));
    for (let i = 0; i < 2; i++) {
      s = queueReducer(queueReducer(s, { type: "started", eventId: "e1" }), { type: "network_error", eventId: "e1", maxAttempts: 3, now: 0, waitMs: 0 });
      expect(s.events[0]).toMatchObject({ state: "sending", inFlight: false, attempts: i + 1 });
    }
    s = queueReducer(queueReducer(s, { type: "started", eventId: "e1" }), { type: "network_error", eventId: "e1", maxAttempts: 3, now: 0, waitMs: null });
    expect(s.events[0]).toMatchObject({ state: "failed", attempts: 3 });
    expect(summarizeQueue(s).needsAction).toBe(1);
    s = queueReducer(s, { type: "retry", eventId: "e1" });
    expect(s.events[0]).toMatchObject({ state: "sending", attempts: 0, inFlight: false, notBefore: undefined });
  });

  it("does not offer a retried event again before its back-off has passed", () => {
    let s = enqueue(initialQueue, ev("e1"));
    s = queueReducer(queueReducer(s, { type: "started", eventId: "e1" }), { type: "network_error", eventId: "e1", maxAttempts: 3, now: 1000, waitMs: 500 });
    expect(sendable(s, 1200)).toEqual([]);
    expect(sendable(s, 1500).map((e) => e.eventId)).toEqual(["e1"]);
  });

  it("undone events no longer count as saved", () => {
    let s = queueReducer(enqueue(initialQueue, ev("e1")), { type: "resolved", eventId: "e1", result: "applied", status: "present" });
    s = queueReducer(s, { type: "undone", eventId: "e1" });
    expect(s.events[0].state).toBe("undone");
    expect(summarizeQueue(s).saved).toBe(0);
  });

  it("tracks undo progress and errors per event", () => {
    let s = queueReducer(enqueue(initialQueue, ev("e1")), { type: "resolved", eventId: "e1", result: "applied", status: "present" });
    s = queueReducer(s, { type: "undo_started", eventId: "e1" });
    expect(s.events[0].undoBusy).toBe(true);
    expect(pendingCount(s)).toBe(1);
    s = queueReducer(s, { type: "undo_failed", eventId: "e1", message: "Bản ghi đã thay đổi" });
    expect(s.events[0]).toMatchObject({ undoBusy: false, undoError: "Bản ghi đã thay đổi", state: "saved" });
  });

  it("limits the number of events still waiting to be sent", () => {
    let s = initialQueue;
    for (let i = 0; i < 50; i++) s = enqueue(s, ev(`e${i}`, `s${i}`));
    expect(canEnqueue(s)).toBe(false);
    expect(canEnqueue(s, 51)).toBe(true);
    expect(pendingCount(s)).toBe(50);
  });

  it("lists recent events newest first", () => {
    const s = enqueue(initialQueue, ev("e1", "A"), ev("e2", "B"), ev("e3", "C"));
    expect(recentEvents(s, 2).map((e) => e.eventId)).toEqual(["e3", "e2"]);
  });
});

describe("backoffMs", () => {
  it("waits 0.5s, 1.5s, 4s and then gives up", () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([500, 1500, 4000]);
    expect(backoffMs(4)).toBeNull();
  });
});
```

`src/lib/qr/frame-deduper.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createFrameDeduper } from "./frame-deduper";

describe("createFrameDeduper", () => {
  it("accepts the first sighting and ignores the same code while it stays in view", () => {
    const d = createFrameDeduper(600);
    expect(d.accept("A", 0)).toBe(true);
    expect([100, 200, 400, 800, 1200].map((t) => d.accept("A", t))).toEqual([false, false, false, false, false]);
  });
  it("accepts a different code immediately, even right after another", () => {
    const d = createFrameDeduper(600);
    d.accept("A", 0);
    expect(d.accept("B", 50)).toBe(true);
    expect(d.accept("A", 100)).toBe(true);
  });
  it("accepts the same code again after it left the frame for longer than the gap", () => {
    const d = createFrameDeduper(600);
    d.accept("A", 0);
    expect(d.accept("A", 100)).toBe(false);
    expect(d.accept("A", 100 + 601)).toBe(true);
  });
});
```

`src/lib/attendance/roster-search.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { filterRoster } from "./roster-search";

const roster = [
  { fullName: "Nguyễn Văn An", saintName: "Phêrô" },
  { fullName: "Trần Thị Dũng", saintName: null },
  { fullName: "Lê Đức Bình", saintName: "Maria" },
];

describe("filterRoster", () => {
  it("ignores accents, case and đ", () => {
    expect(filterRoster(roster, "nguyen").map((r) => r.fullName)).toEqual(["Nguyễn Văn An"]);
    expect(filterRoster(roster, "DUNG").map((r) => r.fullName)).toEqual(["Trần Thị Dũng"]);
    expect(filterRoster(roster, "duc").map((r) => r.fullName)).toEqual(["Lê Đức Bình"]);
  });
  it("matches words in any order and the saint name", () => {
    expect(filterRoster(roster, "an nguyen")).toHaveLength(1);
    expect(filterRoster(roster, "maria")[0].fullName).toBe("Lê Đức Bình");
  });
  it("returns nothing for an empty query and honours the limit", () => {
    expect(filterRoster(roster, "  ")).toEqual([]);
    expect(filterRoster(roster, "a", 2)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Chạy để thấy lỗi**

Run: `pnpm test src/lib/attendance/scan-queue.test.ts src/lib/qr/frame-deduper.test.ts src/lib/attendance/roster-search.test.ts`
Expected: FAIL — thiếu module.

- [ ] **Step 3: Cài đặt hàm thuần**

`src/lib/attendance/scan-queue.ts`

```ts
import type { CurrentMark, ScanMode } from "./scan-rules";
import type { AttendanceStatus } from "./warning";

export type EventState = "sending" | "saved" | "needs_confirm" | "rejected" | "failed" | "undone";

export interface QueuedEvent {
  eventId: string;
  kind: "scan" | "manual";
  studentId: string;
  fullName: string;
  saintName: string | null;
  mode: ScanMode;
  token?: string;
  confirmStatus?: "present" | "late";
  optimisticStatus: "present" | "late";
  prev: CurrentMark | null;
  capturedAt: string;
  state: EventState;
  inFlight: boolean;
  attempts: number;
  /** Không gửi lại trước mốc này (thời gian chờ giữa các lần thử). */
  notBefore?: number;
  result?: "applied" | "noop";
  serverStatus?: AttendanceStatus | null;
  message?: string;
  undoBusy: boolean;
  undoError?: string;
}
export interface ScanQueueState { events: QueuedEvent[] }
export const initialQueue: ScanQueueState = { events: [] };

export type ScanAction =
  | { type: "enqueue"; event: Omit<QueuedEvent, "state" | "inFlight" | "attempts"> }
  | { type: "started"; eventId: string }
  | { type: "resolved"; eventId: string; result: "applied" | "noop"; status: AttendanceStatus | null }
  | { type: "needs_confirm"; eventId: string; status: AttendanceStatus | null }
  | { type: "rejected"; eventId: string; message: string }
  | { type: "network_error"; eventId: string; maxAttempts: number; now: number; waitMs: number | null }
  | { type: "retry"; eventId: string }
  | { type: "undo_started"; eventId: string }
  | { type: "undone"; eventId: string }
  | { type: "undo_failed"; eventId: string; message: string };

const patch = (s: ScanQueueState, id: string, change: (e: QueuedEvent) => Partial<QueuedEvent>): ScanQueueState => ({
  events: s.events.map((e) => (e.eventId === id ? { ...e, ...change(e) } : e)),
});

export function queueReducer(s: ScanQueueState, a: ScanAction): ScanQueueState {
  switch (a.type) {
    case "enqueue": return { events: [...s.events, { ...a.event, state: "sending", inFlight: false, attempts: 0 }] };
    case "started": return patch(s, a.eventId, () => ({ inFlight: true }));
    case "resolved": return patch(s, a.eventId, () => ({ state: "saved", inFlight: false, result: a.result, serverStatus: a.status, message: undefined }));
    case "needs_confirm": return patch(s, a.eventId, () => ({ state: "needs_confirm", inFlight: false, serverStatus: a.status }));
    case "rejected": return patch(s, a.eventId, () => ({ state: "rejected", inFlight: false, message: a.message }));
    case "network_error": return patch(s, a.eventId, (e) => {
      const attempts = e.attempts + 1;
      return { inFlight: false, attempts, state: attempts >= a.maxAttempts ? "failed" : "sending", notBefore: a.now + (a.waitMs ?? 0) };
    });
    case "retry": return patch(s, a.eventId, () => ({ state: "sending", attempts: 0, inFlight: false, notBefore: undefined }));
    case "undo_started": return patch(s, a.eventId, () => ({ undoBusy: true, undoError: undefined }));
    case "undone": return patch(s, a.eventId, () => ({ state: "undone", undoBusy: false }));
    case "undo_failed": return patch(s, a.eventId, () => ({ undoBusy: false, undoError: a.message }));
  }
}

export function summarizeQueue(s: ScanQueueState) {
  return {
    saved: s.events.filter((e) => e.state === "saved" && e.result === "applied").length,
    sending: s.events.filter((e) => e.state === "sending").length,
    needsAction: s.events.filter((e) => e.state === "rejected" || e.state === "failed" || e.state === "needs_confirm").length,
  };
}

/** Lượt chờ gửi, mỗi em tối đa một lượt tại một thời điểm và theo đúng thứ tự quét. */
export function sendable(s: ScanQueueState, now: number = Date.now()): QueuedEvent[] {
  const busy = new Set(s.events.filter((e) => e.state === "sending" && e.inFlight).map((e) => e.studentId));
  const out: QueuedEvent[] = [];
  for (const e of s.events) {
    if (e.state !== "sending" || e.inFlight || busy.has(e.studentId)) continue;
    if ((e.notBefore ?? 0) > now) { busy.add(e.studentId); continue; } // đang chờ thử lại: không cho lượt sau của cùng em chen lên
    busy.add(e.studentId);
    out.push(e);
  }
  return out;
}

export const pendingCount = (s: ScanQueueState): number =>
  s.events.filter((e) => e.state === "sending" || e.undoBusy).length;

export const canEnqueue = (s: ScanQueueState, limit = 50): boolean =>
  s.events.filter((e) => e.state === "sending").length < limit;

export const recentEvents = (s: ScanQueueState, n: number): QueuedEvent[] => [...s.events].reverse().slice(0, n);

const BACKOFF = [500, 1500, 4000];
export const backoffMs = (attempt: number): number | null => BACKOFF[attempt - 1] ?? null;
```

`src/lib/qr/frame-deduper.ts`

```ts
/**
 * Chống phát hiện lặp: cùng một mã còn nằm trong khung (được thấy liên tục, cách nhau ≤ gapMs) chỉ tính một lần;
 * mã khác luôn được nhận ngay; cùng mã quay lại sau khi rời khung quá gapMs thì nhận lại.
 */
export function createFrameDeduper(gapMs = 600) {
  let last: { code: string; seenAt: number } | null = null;
  return {
    accept(code: string, nowMs: number): boolean {
      const fresh = !last || last.code !== code || nowMs - last.seenAt > gapMs;
      last = { code, seenAt: nowMs };
      return fresh;
    },
  };
}
```

`src/lib/attendance/roster-search.ts`

```ts
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase().trim();

/** Tìm theo họ tên hoặc tên thánh, không phân biệt dấu/hoa thường, các từ theo thứ tự bất kỳ. */
export function filterRoster<T extends { fullName: string; saintName: string | null }>(roster: T[], query: string, limit = 8): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return roster.filter((r) => {
    const hay = fold(`${r.saintName ?? ""} ${r.fullName}`);
    return words.every((w) => hay.includes(w));
  }).slice(0, limit);
}
```

- [ ] **Step 4: Chạy test**

Run: `pnpm test src/lib/attendance/scan-queue.test.ts src/lib/qr/frame-deduper.test.ts src/lib/attendance/roster-search.test.ts`
Expected: PASS.

- [ ] **Step 5: Lớp gọi mạng của máy khách** — `src/components/scan/api.ts`

```ts
import type { ScanOutcome, UndoOutcome, ScanRosterEntry } from "@/server/services/scan";

export type Transport<T> =
  | { kind: "response"; status: number; body: { ok: true; data: T } | { ok: false; code: string; error: string } }
  | { kind: "network" };

/** Lỗi mạng, timeout, 5xx và 429 coi là "chưa rõ kết quả" (gửi lại cùng event_id). Mọi phản hồi khác là kết quả cuối. */
export async function postJson<T>(url: string, body: unknown, timeoutMs = 8000): Promise<Transport<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal, credentials: "same-origin" });
    if (res.status >= 500 || res.status === 429) return { kind: "network" };
    const json = await res.json().catch(() => null);
    return json ? { kind: "response", status: res.status, body: json } : { kind: "network" };
  } catch {
    return { kind: "network" };
  } finally {
    clearTimeout(timer);
  }
}

export const sendScan = (payload: unknown) => postJson<ScanOutcome>("/api/diem-danh/quet", payload);
export const sendUndo = (payload: unknown) => postJson<UndoOutcome>("/api/diem-danh/hoan-tac", payload);

export interface RosterResponse { sessionId: string; classId: string; heldOn: string; cancelled: boolean; students: ScanRosterEntry[] }

export async function fetchRoster(sessionId: string): Promise<RosterResponse | null> {
  try {
    const res = await fetch(`/api/diem-danh/bang-tra?sessionId=${encodeURIComponent(sessionId)}`, { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.ok ? (json.data as RosterResponse) : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Camera** — `src/components/scan/QrCamera.tsx`

```tsx
"use client";
import { Flashlight, FlashlightOff } from "lucide-react";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { createQrDecoder } from "@/lib/qr/decoder";
import { createFrameDeduper } from "@/lib/qr/frame-deduper";

export type CameraState = "starting" | "on" | "denied" | "unavailable";

const DENIED = new Set(["NotAllowedError", "PermissionDeniedError", "SecurityError"]);
const TICK_MS = 60;

export function QrCamera({ onCode, onState, paused }: {
  onCode: (text: string) => void;
  onState: (state: CameraState) => void;
  paused: MutableRefObject<boolean>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const latest = useRef({ onCode, onState });
  latest.current = { onCode, onState };
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false });

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let stream: MediaStream | null = null;
    const deduper = createFrameDeduper();

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        latest.current.onState(DENIED.has((e as DOMException).name) ? "denied" : "unavailable");
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      track.current = stream.getVideoTracks()[0] ?? null;
      const caps = (track.current?.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorch({ supported: !!caps.torch, on: false });
      await video.play().catch(() => undefined);
      const decoder = await createQrDecoder().catch(() => null);
      if (!decoder) { latest.current.onState("unavailable"); return; }
      latest.current.onState("on");

      const tick = async () => {
        if (stopped) return;
        if (!paused.current && video.readyState >= 2) {
          const code = await decoder.decodeVideo(video).catch(() => null);
          if (code && deduper.accept(code, performance.now())) latest.current.onCode(code);
        }
        timer = window.setTimeout(tick, TICK_MS);
      };
      void tick();
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [paused]);

  async function toggleTorch() {
    const next = !torch.on;
    try {
      await track.current?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch({ supported: true, on: next });
    } catch { /* thiết bị không hỗ trợ: giữ nguyên */ }
  }

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-card bg-ink">
      <video ref={videoRef} muted playsInline aria-label="Hình từ camera" className="h-full w-full object-cover" />
      <div aria-hidden className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-white/80" />
      {torch.supported && (
        <button type="button" onClick={toggleTorch} aria-pressed={torch.on} aria-label="Bật đèn"
          className="absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface text-ink">
          {torch.on ? <FlashlightOff aria-hidden size={20} /> : <Flashlight aria-hidden size={20} />}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Hook điều phối** — `src/components/scan/useScanSession.ts`

```ts
"use client";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { filterRoster } from "@/lib/attendance/roster-search";
import { backoffMs, canEnqueue, initialQueue, pendingCount, queueReducer, recentEvents, sendable, summarizeQueue, type QueuedEvent } from "@/lib/attendance/scan-queue";
import { decideScan, type CurrentMark, type ScanMode } from "@/lib/attendance/scan-rules";
import type { AttendanceStatus } from "@/lib/attendance/warning";
import { parseQrPayload } from "@/lib/qr/payload";
import type { ScanRosterEntry } from "@/server/services/scan";
import { fetchRoster, sendScan, sendUndo } from "./api";

export const INVALID_CARD = "Thẻ không dùng được cho lớp này";
const MAX_ATTEMPTS = 3;
const ROSTER_COOLDOWN_MS = 10_000;

export interface Banner { tone: "applied" | "noop" | "error" | "info"; fullName?: string; saintName?: string | null; status?: AttendanceStatus | null; text: string }
export interface PendingConfirm { entry: ScanRosterEntry; current: "absent_excused" | "absent_unexcused"; defaultStatus: "present" | "late"; kind: "scan" | "manual" }

export function useScanSession({ sessionId }: { sessionId: string }) {
  const [roster, setRoster] = useState<ScanRosterEntry[] | null>(null);
  const [rosterError, setRosterError] = useState(false);
  const [mode, setMode] = useState<ScanMode>("present");
  const [queue, dispatch] = useReducer(queueReducer, initialQueue);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [tick, setTick] = useState(0); // đánh thức hàm gửi khi hết thời gian chờ thử lại
  const marks = useRef(new Map<string, CurrentMark | null>());
  const byToken = useRef(new Map<string, ScanRosterEntry>());
  const byId = useRef(new Map<string, ScanRosterEntry>());
  const lastReload = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const queueRef = useRef(queue);
  queueRef.current = queue;

  const loadRoster = useCallback(async () => {
    lastReload.current = Date.now();
    const data = await fetchRoster(sessionId);
    if (!data) { setRosterError(true); return false; }
    setRosterError(false);
    byToken.current = new Map(data.students.map((s) => [s.token, s]));
    byId.current = new Map(data.students.map((s) => [s.studentId, s]));
    for (const s of data.students) {
      // Giữ trạng thái lạc quan của lượt còn đang gửi; còn lại theo máy chủ.
      const inQueue = queueRef.current.events.some((e) => e.studentId === s.studentId && e.state === "sending");
      if (!inQueue) marks.current.set(s.studentId, s.status ? { status: s.status, reason: s.reason } : null);
    }
    setRoster(data.students);
    return true;
  }, [sessionId]);

  useEffect(() => { void loadRoster(); }, [loadRoster]);

  const enqueueApply = useCallback((entry: ScanRosterEntry, kind: "scan" | "manual", status: "present" | "late", confirmStatus?: "present" | "late") => {
    if (!canEnqueue(queueRef.current)) { setBanner({ tone: "error", text: "Đang gửi quá nhiều lượt, đợi một chút rồi quét tiếp." }); return; }
    const prev = marks.current.get(entry.studentId) ?? null;
    marks.current.set(entry.studentId, { status, reason: null });
    dispatch({
      type: "enqueue",
      event: {
        eventId: crypto.randomUUID(), kind, studentId: entry.studentId, fullName: entry.fullName, saintName: entry.saintName,
        mode: modeRef.current, token: kind === "scan" ? entry.token : undefined, confirmStatus, optimisticStatus: status,
        prev, capturedAt: new Date().toISOString(), undoBusy: false,
      },
    });
    setBanner({ tone: "applied", fullName: entry.fullName, saintName: entry.saintName, status, text: status === "late" ? "Đã ghi Đi muộn" : "Đã ghi Có mặt" });
    try { navigator.vibrate?.(30); } catch { /* không hỗ trợ */ }
  }, []);

  const handleEntry = useCallback((entry: ScanRosterEntry, kind: "scan" | "manual") => {
    const decision = decideScan(marks.current.get(entry.studentId) ?? null, modeRef.current);
    if (decision.kind === "apply") return enqueueApply(entry, kind, decision.status);
    if (decision.kind === "noop") {
      return setBanner({ tone: "noop", fullName: entry.fullName, saintName: entry.saintName, status: marks.current.get(entry.studentId)?.status ?? null, text: decision.reason === "already_late" ? "Đã ghi đi muộn" : "Đã điểm danh" });
    }
    setConfirm({ entry, current: decision.current, defaultStatus: decision.defaultStatus, kind });
  }, [enqueueApply]);

  const handleCode = useCallback(async (text: string) => {
    const token = parseQrPayload(text);
    let entry = token ? byToken.current.get(token) : undefined;
    if (token && !entry && Date.now() - lastReload.current > ROSTER_COOLDOWN_MS) {
      await loadRoster(); // vừa thêm em hoặc cấp lại thẻ: tải lại bảng tra một lần
      entry = byToken.current.get(token);
    }
    if (!entry) return setBanner({ tone: "error", text: INVALID_CARD });
    handleEntry(entry, "scan");
  }, [handleEntry, loadRoster]);

  const chooseStudent = useCallback((studentId: string) => {
    const entry = byId.current.get(studentId);
    if (entry) handleEntry(entry, "manual");
  }, [handleEntry]);

  const confirmChoice = useCallback((status: "present" | "late") => {
    if (!confirm) return;
    enqueueApply(confirm.entry, confirm.kind, status, status);
    setConfirm(null);
  }, [confirm, enqueueApply]);

  // Gửi nền: mỗi em một lượt tại một thời điểm, các em khác song song.
  useEffect(() => {
    for (const ev of sendable(queue, Date.now())) {
      dispatch({ type: "started", eventId: ev.eventId });
      void deliver(ev);
    }
    async function deliver(ev: QueuedEvent) {
      const res = await sendScan({
        eventId: ev.eventId, sessionId, kind: ev.kind, mode: ev.mode, confirmStatus: ev.confirmStatus, capturedAt: ev.capturedAt,
        ...(ev.kind === "scan" ? { token: ev.token } : { studentId: ev.studentId }),
      });
      if (res.kind === "network") {
        const attempt = (queueRef.current.events.find((e) => e.eventId === ev.eventId)?.attempts ?? 0) + 1;
        const wait = backoffMs(attempt);
        dispatch({ type: "network_error", eventId: ev.eventId, maxAttempts: MAX_ATTEMPTS, now: Date.now(), waitMs: wait });
        if (wait !== null) setTimeout(() => setTick((n) => n + 1), wait);
        return;
      }
      const body = res.body;
      if (!body.ok) {
        marks.current.set(ev.studentId, ev.prev);
        dispatch({ type: "rejected", eventId: ev.eventId, message: body.code === "invalid_card" ? INVALID_CARD : body.error });
        return;
      }
      const out = body.data;
      if (out.result === "needs_confirm") {
        marks.current.set(ev.studentId, out.status ? { status: out.status, reason: null } : null);
        dispatch({ type: "needs_confirm", eventId: ev.eventId, status: out.status });
        const entry = byId.current.get(ev.studentId);
        if (entry && out.current && out.defaultStatus) setConfirm({ entry, current: out.current, defaultStatus: out.defaultStatus, kind: ev.kind });
        return;
      }
      marks.current.set(ev.studentId, out.status ? { status: out.status, reason: null } : null);
      dispatch({ type: "resolved", eventId: ev.eventId, result: out.result, status: out.status });
    }
  }, [queue, sessionId, tick]);

  const undo = useCallback(async (ev: QueuedEvent) => {
    dispatch({ type: "undo_started", eventId: ev.eventId });
    const res = await sendUndo({ eventId: crypto.randomUUID(), sessionId, targetEventId: ev.eventId });
    if (res.kind === "network") return dispatch({ type: "undo_failed", eventId: ev.eventId, message: "Chưa hoàn tác được, thử lại." });
    if (!res.body.ok) {
      dispatch({ type: "undo_failed", eventId: ev.eventId, message: res.body.error });
      if (res.body.code === "conflict") void loadRoster();
      return;
    }
    marks.current.set(ev.studentId, res.body.data.status ? { status: res.body.data.status, reason: null } : null);
    dispatch({ type: "undone", eventId: ev.eventId });
  }, [sessionId, loadRoster]);

  const retry = useCallback((eventId: string) => dispatch({ type: "retry", eventId }), []);

  const pending = pendingCount(queue);
  useEffect(() => {
    if (pending === 0) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  // Cầu nối chỉ bật khi build E2E (NEXT_PUBLIC_E2E_SCAN_BRIDGE=1): cho kiểm thử đưa mã đã giải vào mà không cần camera.
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_E2E_SCAN_BRIDGE !== "1") return;
    (window as unknown as { __scanFeed?: (t: string) => Promise<void> }).__scanFeed = handleCode;
  }, [handleCode]);

  const unmarked = useMemo(
    () => (roster ?? []).filter((s) => !marks.current.get(s.studentId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roster, queue],
  );
  const search = useCallback((q: string) => filterRoster(roster ?? [], q), [roster]);

  return { roster, rosterError, loadRoster, mode, setMode, queue, summary: summarizeQueue(queue), pending, recent: recentEvents(queue, 8), banner, setBanner, confirm, setConfirm, handleCode, chooseStudent, confirmChoice, undo, retry, unmarked, search };
}
```

- [ ] **Step 8: Màn hình quét** — `src/components/scan/ScanScreen.tsx`

```tsx
"use client";
import { ArrowLeft, CircleAlert, Clock, Search, Undo2, UserCheck, VideoOff } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { Pill, StatusPill } from "@/components/ui/Pill";
import { Sheet } from "@/components/ui/Sheet";
import { QrCamera, type CameraState } from "./QrCamera";
import { useScanSession } from "./useScanSession";
import { dateLabel } from "@/lib/date-label";

export function ScanScreen({ sessionId, classId, className, heldOn }: { sessionId: string; classId: string; className: string; heldOn: string }) {
  const s = useScanSession({ sessionId });
  const [camera, setCamera] = useState<CameraState>("starting");
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [review, setReview] = useState(false);
  const [leave, setLeave] = useState(false);
  const paused = useRef(false);
  paused.current = !!s.confirm || finding || review || leave;
  const boardHref = `/lop/${classId}/diem-danh/${heldOn}`;
  const late = s.mode === "late";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        {s.pending > 0
          ? <button type="button" onClick={() => setLeave(true)} className="btn btn-secondary"><ArrowLeft aria-hidden size={18} /> Xong</button>
          : <Link href={boardHref} className="btn btn-secondary"><ArrowLeft aria-hidden size={18} /> Xong</Link>}
        <p className="min-w-0 truncate font-display text-sm text-ink-soft">{className} · {dateLabel(heldOn)}</p>
      </div>

      <div role="radiogroup" aria-label="Chế độ quét" className="grid grid-cols-2 gap-1 rounded-control border border-border bg-surface-muted p-1">
        {(["present", "late"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={s.mode === m} onClick={() => s.setMode(m)}
            className={`flex h-12 items-center justify-center gap-2 rounded-control font-display text-base font-medium ${s.mode === m ? (m === "late" ? "bg-st-late text-white" : "bg-st-present text-white") : "text-ink-soft"}`}>
            {m === "late" ? <Clock aria-hidden size={18} /> : <UserCheck aria-hidden size={18} />}
            {m === "late" ? "Đi muộn" : "Có mặt"}
          </button>
        ))}
      </div>
      {late && <Notice tone="warning" role="status">Đang quét ở chế độ <b>Đi muộn</b>: các thẻ quét sau sẽ ghi Đi muộn.</Notice>}

      {camera === "denied" || camera === "unavailable" ? (
        <EmptyState icon={VideoOff} title={camera === "denied" ? "Chưa cho phép dùng camera" : "Không mở được camera"}
          action={<button type="button" onClick={() => setFinding(true)} className="btn btn-primary">Tìm bằng tên</button>}>
          {camera === "denied" ? "Vào cài đặt trình duyệt, cho trang này dùng camera rồi tải lại. Trong lúc đó vẫn điểm danh được bằng cách tìm tên." : "Thiết bị không có camera hoặc đang bị ứng dụng khác dùng. Bạn vẫn có thể tìm tên để điểm danh."}
        </EmptyState>
      ) : (
        <QrCamera onCode={s.handleCode} onState={setCamera} paused={paused} />
      )}
      {camera === "starting" && <p className="text-sm text-ink-soft" role="status">Đang mở camera…</p>}
      {s.rosterError && (
        <Notice tone="error" role="alert">
          Chưa tải được danh sách lớp. <button type="button" onClick={() => void s.loadRoster()} className="underline">Thử lại</button>
        </Notice>
      )}

      <div aria-live="polite" className="min-h-[88px] rounded-card border border-border bg-surface p-3">
        {s.banner ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              {s.banner.saintName && <p className="text-sm text-ink-soft">{s.banner.saintName}</p>}
              <p className="font-display text-2xl font-semibold leading-tight">{s.banner.fullName ?? ""}</p>
              <p className={`text-sm font-medium ${s.banner.tone === "error" ? "text-warn-alert" : "text-ink-soft"}`}>{s.banner.text}</p>
            </div>
            {s.banner.status && <StatusPill status={s.banner.status} />}
          </div>
        ) : <p className="text-ink-soft">Đưa thẻ QR của em vào khung hình.</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-label="Tổng kết lượt quét">
        <Pill tone="neutral">Đã lưu {s.summary.saved}</Pill>
        <Pill tone="action">Đang gửi {s.summary.sending}</Pill>
        <Pill tone={s.summary.needsAction ? "alert" : "neutral"}>Cần xử lý {s.summary.needsAction}</Pill>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => setFinding(true)} className="btn btn-secondary"><Search aria-hidden size={18} /> Tìm bằng tên</button>
          <button type="button" onClick={() => setReview(true)} className="btn btn-secondary">Kiểm tra cuối buổi</button>
        </div>
      </div>

      <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
        {s.recent.length === 0 && <li className="p-3 text-sm text-ink-soft">Chưa quét thẻ nào.</li>}
        {s.recent.map((e) => (
          <li key={e.eventId} className="flex flex-wrap items-center gap-2 p-3">
            <span className="min-w-0 flex-1 font-medium">{e.fullName}</span>
            {e.state === "saved" && <StatusPill status={e.serverStatus ?? e.optimisticStatus} label={e.result === "noop" ? "Đã có" : undefined} />}
            {e.state === "sending" && <Pill tone="action">Đang gửi</Pill>}
            {e.state === "needs_confirm" && <Pill tone="watch">Cần chọn</Pill>}
            {e.state === "rejected" && <Pill tone="alert" icon={CircleAlert}>{e.message ?? "Bị từ chối"}</Pill>}
            {e.state === "failed" && <button type="button" onClick={() => s.retry(e.eventId)} className="btn btn-secondary">Thử lại</button>}
            {e.state === "undone" && <Pill>Đã hoàn tác</Pill>}
            {e.state === "saved" && e.result === "applied" && (
              <button type="button" disabled={e.undoBusy} onClick={() => void s.undo(e)} aria-label={`Hoàn tác lượt của ${e.fullName}`} className="btn btn-secondary">
                <Undo2 aria-hidden size={16} /> Hoàn tác
              </button>
            )}
            {e.undoError && <p role="alert" className="w-full text-sm text-warn-alert">{e.undoError}</p>}
          </li>
        ))}
      </ul>

      {finding && (
        <Sheet label="Tìm bằng tên" onClose={() => { setFinding(false); setQuery(""); }}>
          <label className="flex flex-col gap-1 text-sm font-medium">Tìm tên
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} className="input" inputMode="search" />
          </label>
          <ul className="flex flex-col gap-1">
            {s.search(query).map((r) => (
              <li key={r.studentId}>
                <button type="button" className="btn btn-secondary w-full justify-start" onClick={() => { s.chooseStudent(r.studentId); setFinding(false); setQuery(""); }}>
                  {r.saintName ? `${r.saintName} ` : ""}{r.fullName}
                </button>
              </li>
            ))}
            {query.trim() && s.search(query).length === 0 && <li className="text-sm text-ink-soft">Không thấy em nào khớp.</li>}
          </ul>
        </Sheet>
      )}

      {s.confirm && (
        <Sheet label={`Chọn trạng thái cho ${s.confirm.entry.fullName}`} onClose={() => s.setConfirm(null)}>
          <p className="font-display text-xl font-semibold">{s.confirm.entry.fullName}</p>
          <p className="text-ink-soft">Đang được ghi: <b>{s.confirm.current === "absent_excused" ? "Vắng có phép" : "Vắng không phép"}</b>. Em vừa đến, đổi thành:</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => s.confirmChoice("present")}>Có mặt</button>
            <button type="button" className="btn btn-secondary btn-lg" onClick={() => s.confirmChoice("late")}>Đi muộn</button>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => s.setConfirm(null)}>Giữ nguyên</button>
        </Sheet>
      )}

      {review && (
        <Sheet label="Kiểm tra cuối buổi" onClose={() => setReview(false)}>
          <h2 className="font-display text-lg font-semibold">Em chưa điểm danh ({s.unmarked.length})</h2>
          <ul className="text-sm">{s.unmarked.map((r) => <li key={r.studentId} className="py-1">{r.fullName}</li>)}{s.unmarked.length === 0 && <li className="text-ink-soft">Tất cả đã được điểm danh.</li>}</ul>
          <h2 className="font-display text-lg font-semibold">Lượt cần xử lý ({s.summary.needsAction + s.summary.sending})</h2>
          <p className="text-sm text-ink-soft">Không tự chuyển em chưa điểm danh thành vắng. Muốn đánh vắng, mở bảng điểm danh.</p>
          <Link href={boardHref} className="btn btn-primary btn-lg">Mở bảng điểm danh</Link>
        </Sheet>
      )}

      {leave && (
        <Sheet label="Còn lượt chưa lưu" onClose={() => setLeave(false)}>
          <p className="font-display text-lg font-semibold">Còn {s.pending} lượt đang gửi</p>
          <p className="text-ink-soft">Thoát bây giờ có thể làm mất các lượt chưa gửi xong. Nên ở lại vài giây.</p>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => setLeave(false)}>Ở lại</button>
          <Link href={boardHref} className="btn btn-secondary">Vẫn thoát</Link>
        </Sheet>
      )}
    </section>
  );
}
```

- [ ] **Step 9: Trang quét và nút "Quét QR"** — `src/app/(app)/lop/[classId]/diem-danh/[date]/quet/page.tsx`

```tsx
import { notFound } from "next/navigation";
import { z } from "zod";
import { Notice } from "@/components/ui/Notice";
import { ScanScreen } from "@/components/scan/ScanScreen";
import { db } from "@/db/client";
import { getClassById } from "@/db/queries/classes";
import { requireUser } from "@/lib/auth/dal";
import { classPermissions } from "@/server/guard";
import { openSession } from "@/server/services/attendance";

export default async function ScanPage({ params }: { params: Promise<{ classId: string; date: string }> }) {
  const { classId, date } = await params;
  if (!z.iso.date().safeParse(date).success) notFound();
  const user = await requireUser();
  const perms = await classPermissions(db, user, classId);
  if (!perms.canWrite) notFound();
  const opened = await openSession(db, user, { classId, heldOn: date }); // idempotent
  if (!opened.ok) return <Notice tone="error" role="alert">{opened.error}</Notice>;
  const cls = await getClassById(db, classId);
  return <ScanScreen sessionId={opened.data.id} classId={classId} className={cls?.name ?? ""} heldOn={date} />;
}
```

Trong `AttendanceBoard.tsx`, cạnh nút "Tất cả có mặt" (chỉ khi `board.canWrite && !cancelled`) thêm:

```tsx
<Link prefetch={false} href={`/lop/${board.classId}/diem-danh/${board.heldOn}/quet`} className="btn btn-secondary btn-lg">
  <ScanLine aria-hidden size={20} /> Quét QR
</Link>
```

(`import Link from "next/link"` và `ScanLine` từ `lucide-react`; `prefetch={false}` vì trang quét mở buổi khi render.) Trang quét nhận **không** token qua props: bảng tra được tải riêng qua `/api/diem-danh/bang-tra` sau khi mở.

- [ ] **Step 10: Kiểm tra và commit**

Run: `pnpm test --maxWorkers=2 && pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: pass; `grep -rn "as never" src/components/scan src/lib/attendance` không còn kết quả. Thủ công (cần DB + điện thoại hoặc laptop có webcam, qua `localhost`): mở màn quét, quét thẻ in từ Task 17 → hiện tên và "Đã ghi Có mặt", tổng "Đã lưu" tăng, quét lại cùng thẻ → "Đã điểm danh"; gạt "Đi muộn" rồi quét thẻ mới → ghi Đi muộn; thẻ lớp khác → "Thẻ không dùng được cho lớp này"; "Hoàn tác" xóa lượt; ngắt mạng rồi quét → "Đang gửi", bật mạng → tự lưu.

```bash
git add src
git commit -m "feat: continuous QR scanner with background sending, late mode, name search and undo"
```

---

### Task 20: E2E, đua và đo hiệu năng QR

**Files:**
- Create: `e2e/qr.spec.ts`, `scripts/bench-scan.ts`
- Modify: `e2e/global-setup.ts` (thêm lớp "Lớp Q" 30 em), `playwright.config.ts` (biến môi trường cầu nối), `package.json` (script `bench:scan`), `docs/superpowers/qr-baseline.md` (số đo cuối)

**Interfaces:**
- Consumes: toàn bộ Task 15–19; biến `NEXT_PUBLIC_E2E_SCAN_BRIDGE=1` (chỉ trong `webServer.env` của Playwright); `E2E_DATABASE_URL` để đọc token trực tiếp từ DB.
- Produces: bộ E2E QR (điện thoại 375px và tablet 768px), kịch bản đo `pnpm bench:scan` in p50/p95 qua HTTP thật.

- [ ] **Step 1: Mở rộng dữ liệu E2E** — trong `e2e/global-setup.ts`, sau khi tạo `classA`:

```ts
const [classQ] = await db.insert(s.classes).values({ gradeId: gradeA.id, name: "Lớp Q" }).returning();
await db.insert(s.classCatechists).values({ classId: classQ.id, userId: glvA.id });
await db.insert(s.students).values(Array.from({ length: 30 }, (_, i) => ({ classId: classQ.id, fullName: `Em Q${String(i + 1).padStart(2, "0")}` })));
```

và thêm `classQ: classQ.id` vào nội dung ghi ra `e2e/.state.json`. Trong `playwright.config.ts`, `webServer.env` thêm `NEXT_PUBLIC_E2E_SCAN_BRIDGE: "1"`. **Chỉ** E2E bật biến này; xác nhận ở Task 21 rằng bản build thường không chứa `__scanFeed`.

- [ ] **Step 2: Viết kịch bản E2E** — `e2e/qr.spec.ts`

```ts
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const state = () => JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { classA: string; classQ: string };
const LOGIN_PW = "e2e-password-1";
const sql = () => postgres(process.env.E2E_DATABASE_URL!, { max: 1 });

async function login(page: Page, email = "glv-a@e2e.vn") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(LOGIN_PW);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeVisible();
}

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
const tokenOf = async (name: string) => { const db = sql(); try { return (await db`select qr_token from students where full_name = ${name}`)[0].qr_token as string; } finally { await db.end(); } };
const feed = (page: Page, token: string) => page.evaluate((t) => (window as unknown as { __scanFeed: (p: string) => Promise<void> }).__scanFeed(`dd1.${t}`), token);

async function openScanner(page: Page, classId: string) {
  await page.goto(`/lop/${classId}/diem-danh/${today()}/quet`);
  await expect(page.getByRole("radiogroup", { name: "Chế độ quét" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __scanFeed?: unknown }).__scanFeed)).toBe("function");
}

test.beforeEach(async () => {
  const db = sql();
  try { await db`delete from sessions where held_on = ${today()}`; await db`delete from attendance_scans`; } finally { await db.end(); }
});

test("in thẻ QR: mỗi em một thẻ có mã và nút cấp lại; trang danh sách không chứa mã", async ({ page }) => {
  await login(page);
  await page.goto(`/lop/${state().classA}/thieu-nhi`);
  expect(await page.content()).not.toContain("dd1.");
  await page.goto(`/lop/${state().classA}/thieu-nhi/the-qr`);
  await expect(page.getByRole("img", { name: /Mã QR của Nguyễn An/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Cấp lại mã cho Nguyễn An/ })).toBeVisible();
});

test("quét liên tục: tên hiện ngay, đếm đã lưu, quét lại báo đã điểm danh", async ({ page }) => {
  await login(page);
  await openScanner(page, state().classA);
  await feed(page, await tokenOf("Nguyễn An"));
  await expect(page.getByText("Nguyễn An").first()).toBeVisible();
  await expect(page.getByLabel("Tổng kết lượt quét").getByText("Đã lưu 1")).toBeVisible();
  await feed(page, await tokenOf("Nguyễn An"));
  await expect(page.getByText("Đã điểm danh").first()).toBeVisible();
  await expect(page.getByLabel("Tổng kết lượt quét").getByText("Đã lưu 1")).toBeVisible();
});

test("chế độ Đi muộn ghi Đi muộn và không hạ Có mặt", async ({ page }) => {
  await login(page);
  await openScanner(page, state().classA);
  await feed(page, await tokenOf("Nguyễn Bình"));
  await page.getByRole("radio", { name: "Đi muộn" }).click();
  await feed(page, await tokenOf("Nguyễn Chi"));
  await feed(page, await tokenOf("Nguyễn Bình")); // đã Có mặt: không đổi thành Đi muộn
  await expect(page.getByText("Đã điểm danh").first()).toBeVisible();
  const db = sql();
  try {
    const rows = await db`select s.full_name, a.status from attendance a join students s on s.id = a.student_id order by s.full_name`;
    expect(rows.map((r) => [r.full_name, r.status])).toEqual([["Nguyễn Bình", "present"], ["Nguyễn Chi", "late"]]);
  } finally { await db.end(); }
});

test("thẻ lớp khác và thẻ mã lạ bị từ chối, không ghi gì", async ({ page }) => {
  await login(page);
  await openScanner(page, state().classA);
  await feed(page, await tokenOf("Em Q01"));
  await expect(page.getByText("Thẻ không dùng được cho lớp này").first()).toBeVisible();
  const db = sql();
  try { expect(await db`select 1 from attendance`).toHaveLength(0); } finally { await db.end(); }
});

test("em đang vắng: hỏi xác nhận rồi mới đổi; hoàn tác trả về vắng", async ({ page }) => {
  const db = sql();
  try {
    const [session] = await db`insert into sessions (class_id, term_id, held_on) select ${state().classA}, id, ${today()} from terms limit 1 returning id`;
    await db`insert into attendance (session_id, student_id, status) select ${session.id}, id, 'absent_unexcused' from students where full_name = 'Nguyễn An'`;
  } finally { await db.end(); }
  await login(page);
  await openScanner(page, state().classA);
  await feed(page, await tokenOf("Nguyễn An"));
  await expect(page.getByRole("dialog", { name: /Chọn trạng thái cho Nguyễn An/ })).toBeVisible();
  await page.getByRole("button", { name: "Có mặt" }).click();
  await expect(page.getByLabel("Tổng kết lượt quét").getByText("Đã lưu 1")).toBeVisible();
  await page.getByRole("button", { name: /Hoàn tác lượt của Nguyễn An/ }).click();
  await expect(page.getByText("Đã hoàn tác")).toBeVisible();
  const db2 = sql();
  try { expect((await db2`select status from attendance`)[0].status).toBe("absent_unexcused"); } finally { await db2.end(); }
});

test("phản hồi thất lạc: gửi lại cùng mã lượt không tạo lượt thứ hai", async ({ page }) => {
  await login(page);
  await openScanner(page, state().classA);
  let dropped = false;
  await page.route("**/api/diem-danh/quet", async (route) => {
    if (!dropped) { dropped = true; await route.fetch(); await route.abort("failed"); } else await route.continue();
  });
  await feed(page, await tokenOf("Nguyễn Dũng"));
  await expect(page.getByLabel("Tổng kết lượt quét").getByText("Đã lưu 1")).toBeVisible({ timeout: 10_000 });
  const db = sql();
  try {
    expect(await db`select 1 from attendance`).toHaveLength(1);
    expect(await db`select 1 from attendance_scans where kind = 'scan'`).toHaveLength(1);
  } finally { await db.end(); }
});

test("tìm bằng tên điểm danh được khi camera bị từ chối", async ({ page }) => {
  await login(page);
  await page.goto(`/lop/${state().classA}/diem-danh/${today()}/quet`);
  await expect(page.getByText(/Chưa cho phép dùng camera|Không mở được camera/)).toBeVisible();
  await page.getByRole("button", { name: "Tìm bằng tên" }).first().click();
  await page.getByLabel("Tìm tên").fill("nguyen chi");
  await page.getByRole("button", { name: /Nguyễn Chi/ }).click();
  await expect(page.getByLabel("Tổng kết lượt quét").getByText("Đã lưu 1")).toBeVisible();
});

test("30 thẻ liên tục đều được lưu", async ({ page }) => {
  await login(page);
  await openScanner(page, state().classQ);
  const db = sql();
  let tokens: string[];
  try { tokens = (await db`select qr_token from students where full_name like 'Em Q%' order by full_name`).map((r) => r.qr_token as string); } finally { await db.end(); }
  const t0 = Date.now();
  for (const t of tokens) await feed(page, t);
  await expect(page.getByLabel("Tổng kết lượt quét").getByText("Đã lưu 30")).toBeVisible({ timeout: 20_000 });
  console.log(`30 lượt lưu xong sau ${Date.now() - t0}ms`);
});

test("người chỉ đọc không mở được màn quét hay trang in thẻ", async ({ page }) => {
  await login(page, "head-a@e2e.vn");
  for (const path of [`/lop/${state().classA}/diem-danh/${today()}/quet`, `/lop/${state().classA}/thieu-nhi/the-qr`]) {
    expect((await page.goto(path))?.status()).toBe(404);
  }
});
```

- [ ] **Step 3: Chạy E2E**

Run: `pnpm test:e2e` (cần `E2E_DATABASE_URL`, xem README).
Expected: toàn bộ test cũ và mới pass trên cả hai viewport. Nếu test "tìm bằng tên khi camera bị từ chối" không thấy trạng thái từ chối vì Playwright cấp quyền camera mặc định, thêm `test.use({ permissions: [] })` cho riêng test đó và, nếu cần, đặt `launchOptions` không có cờ thiết bị giả. Test cầu nối không phụ thuộc camera.

- [ ] **Step 4: Thử camera thật với thiết bị giả (khói)**

Thêm test cuối `e2e/qr.spec.ts`, **chỉ chạy trên Chromium**, bật thiết bị camera giả để kiểm tra decoder và wasm tự host tải được:

```ts
test.describe("camera giả", () => {
  test.use({ permissions: ["camera"], launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });
  test("camera bật được và wasm giải mã tải không lỗi", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const wasm = page.waitForResponse((r) => r.url().endsWith("/zxing_reader.wasm") && r.ok());
    await login(page);
    await page.goto(`/lop/${state().classA}/diem-danh/${today()}/quet`);
    await wasm;
    await expect(page.getByLabel("Hình từ camera")).toBeVisible();
    expect(errors).toEqual([]);
  });
});
```

Run lại `pnpm test:e2e`. Expected: pass.

- [ ] **Step 5: Đo qua HTTP thật** — `scripts/bench-scan.ts`

```ts
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { encryptSession } from "../src/lib/auth/session";

const base = process.env.BENCH_BASE_URL ?? "http://localhost:3100";
const dbUrl = process.env.E2E_DATABASE_URL;
const secret = process.env.AUTH_SECRET;
if (!dbUrl || !secret) throw new Error("Cần E2E_DATABASE_URL và AUTH_SECRET (đúng giá trị của server đang chạy)");
if (!/e2e/i.test(new URL(dbUrl).pathname)) throw new Error("Tên database phải chứa 'e2e'");
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

async function main() {
  const sql = postgres(dbUrl!, { max: 1 });
  const [user] = await sql`select id from users where email = 'glv-a@e2e.vn'`;
  const [cls] = await sql`select id from classes where name = 'Lớp Q'`;
  const [term] = await sql`select id from terms limit 1`;
  const [session] = await sql`insert into sessions (class_id, term_id, held_on) values (${cls.id}, ${term.id}, '2026-01-02') on conflict (class_id, held_on) do update set cancelled = false returning id`;
  const tokens = (await sql`select qr_token from students where class_id = ${cls.id} order by full_name`).map((r) => r.qr_token as string);
  const cookie = `session=${await encryptSession({ userId: user.id }, secret!)}`;
  const headers = { "Content-Type": "application/json", Origin: base, Cookie: cookie };
  const post = async (token: string) => {
    const t = performance.now();
    const res = await fetch(`${base}/api/diem-danh/quet`, { method: "POST", headers, body: JSON.stringify({ eventId: crypto.randomUUID(), sessionId: session.id, kind: "scan", token, mode: "present" }) });
    await res.json();
    return { ms: performance.now() - t, status: res.status };
  };
  const reset = () => sql`delete from attendance where session_id = ${session.id}`;

  await reset();
  const sequential: number[] = [];
  for (const t of tokens) { const r = await post(t); if (r.status !== 200) throw new Error(`HTTP ${r.status}`); sequential.push(r.ms); }
  await reset();
  const t0 = performance.now();
  const parallel: number[] = [];
  const queue = [...tokens];
  await Promise.all(Array.from({ length: 5 }, async () => { for (let t = queue.shift(); t; t = queue.shift()) parallel.push((await post(t)).ms); }));
  const wall = performance.now() - t0;

  console.log(JSON.stringify({
    base, scans: tokens.length,
    sequentialMs: { p50: pct(sequential, 50), p95: pct(sequential, 95) },
    parallel5Ms: { p50: pct(parallel, 50), p95: pct(parallel, 95), wallMs: wall },
  }, null, 2));
  await sql`delete from sessions where id = ${session.id}`;
  await sql.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
```

Thêm vào `package.json`: `"bench:scan": "node --import tsx scripts/bench-scan.ts"`. Chạy `pnpm build && pnpm start -p 3100` (hoặc `next dev -p 3100`, kém chính xác hơn) với `DATABASE_URL`/`AUTH_SECRET` cùng giá trị, rồi `pnpm bench:scan`. Ghi số đo vào `docs/superpowers/qr-baseline.md` (mục "Sau khi làm Task 18"), so với số cơ sở của Task 15 và **ngưỡng quyết định**:
- Đạt ngưỡng (p95 máy chủ ≤ 100ms khi app/DB cùng vùng) → giữ nguyên thiết kế đồng bộ, ghi kết luận.
- Không đạt → thử theo thứ tự: (1) kiểm tra vùng app/DB, (2) gộp `loadScanContext` + `findScanTarget` thành một truy vấn, (3) bỏ truy vấn người dùng của `getCurrentUser` khỏi đường quét bằng cách đọc quyền trong cùng câu SQL; đo lại sau từng bước. Chỉ khi vẫn không đạt mới mở một ADR về hàng chờ trên Postgres.

- [ ] **Step 6: Cổng chất lượng và commit**

Run: `pnpm test:cov && pnpm exec tsc --noEmit && pnpm lint && pnpm build && pnpm test:e2e`
Expected: pass; coverage ≥ ngưỡng đang có.

```bash
git add e2e playwright.config.ts scripts package.json docs/superpowers/qr-baseline.md
git commit -m "test: add QR e2e flows, camera smoke test and scan benchmark"
```

---

### Task 21: Vận hành, rà soát bảo mật và cổng phát hành QR

**Files:**
- Modify: `README.md`, `docs/superpowers/qr-baseline.md`
- Create: `docs/superpowers/qr-release-checklist.md`

- [ ] **Step 1: Cập nhật README (tiếng Việt)** — thêm mục "Điểm danh bằng thẻ QR" gồm:
  - In thẻ: Thiếu nhi → "In thẻ QR" → in A4 (mỗi trang 10 thẻ 90×55mm) hoặc lưu PDF; nên ép plastic; mất thẻ thì "Cấp lại mã" cho riêng em đó; **in lại được bất cứ lúc nào** vì mã lưu trong database.
  - Quét: mở buổi → "Quét QR"; chế độ Có mặt/Đi muộn; quét em đang vắng thì app hỏi xác nhận; "Hoàn tác" trên từng lượt; tìm bằng tên khi thẻ hỏng.
  - **Camera cần HTTPS** (Vercel đã có; chạy máy cá nhân dùng `localhost`); cách cấp quyền camera trên iPhone/Android.
  - Vận hành: app và database **cùng vùng**; tải 30 lượt đo được ở `qr-baseline.md`; giới hạn hiện có (không offline; hàng gửi chỉ sống trong phiên đang mở; giới hạn tốc độ 180 lượt/phút/tài khoản theo từng instance).
  - Bảo mật: mã thẻ là bí mật nhẹ (chỉ hữu ích khi đã đăng nhập đúng lớp); không chia sẻ ảnh chụp thẻ; `NEXT_PUBLIC_E2E_SCAN_BRIDGE` **chỉ** dùng cho E2E, tuyệt đối không đặt trên Vercel.

- [ ] **Step 2: Kiểm tra cầu nối không lọt vào bản thường**

Run: `pnpm build && grep -rl "__scanFeed" .next/static 2>/dev/null | head`
Expected: **không có kết quả** (bản build không đặt `NEXT_PUBLIC_E2E_SCAN_BRIDGE=1` thì mã cầu nối bị loại khỏi bundle client). Nếu còn, sửa điều kiện để bundler loại được (đặt `process.env.NEXT_PUBLIC_E2E_SCAN_BRIDGE` trực tiếp trong biểu thức `if`, không qua biến trung gian).

- [ ] **Step 3: Rà soát lần cuối**

1. Chạy agent **security-reviewer** trên toàn bộ diff của nhánh `feat/qr-attendance` (token, route handler, Origin/CSRF, rate limit, quyền, rò rỉ trong props/HTML/log, camera). Sửa mọi CRITICAL/HIGH.
2. Chạy agent **code-reviewer** trên toàn bộ diff, kèm danh sách "Review Focus (Mốc 7)" ở trên để đối chiếu từng mục với test tương ứng.
3. Tìm token trong mọi nơi không được phép: `grep -rn "qrToken\|qr_token" src --include=*.ts --include=*.tsx | grep -v "\.test\."` — chỉ được xuất hiện ở: schema, migration, `queries/qr-cards.ts`, `queries/scan.ts`, `services/scan.ts`, `services/qr-cards.ts`. Kiểm tra bằng "Xem nguồn trang" các trang danh sách thiếu nhi, điểm danh, sơ đồ, thống kê: không có chuỗi `dd1.`.

- [ ] **Step 4: Danh sách kiểm phát hành** — `docs/superpowers/qr-release-checklist.md`, mỗi mục đánh dấu bằng kết quả thật:
  - [ ] `pnpm test:cov` (số test, % coverage) · `pnpm exec tsc --noEmit` · `pnpm lint` · `pnpm build` · `pnpm test:e2e` (số kịch bản, hai viewport)
  - [ ] Migration chạy sạch trên database đã có dữ liệu (đã thử bản sao): mọi em cũ có `qr_token` khác nhau
  - [ ] Số đo: thời gian xử lý máy chủ p50/p95, vùng app/DB, quyết định không dùng queue (hoặc ADR nếu đổi)
  - [ ] Thử trên điện thoại thật: Android Chrome và iPhone Safari (quét 10 thẻ in thật: ánh sáng yếu, thẻ nghiêng, thẻ ép plastic bóng)
  - [ ] Thẻ in ra quét được ở khoảng cách tay (ghi cỡ thẻ/độ phân giải đã thử)
  - [ ] Rà soát bảo mật: không CRITICAL/HIGH; token không lộ ở nơi nào ngoài hai chỗ cho phép
  - [ ] README đã cập nhật; ghi những gì **chưa** làm (offline, giờ bắt đầu lớp tự nhắc muộn)

- [ ] **Step 5: Commit và hoàn tất nhánh**

```bash
git add README.md docs
git commit -m "docs: QR operations guide, security review notes and release checklist"
```

Sau đó dùng skill `superpowers:finishing-a-development-branch` để chọn cách tích hợp.
