import { eq } from "drizzle-orm";
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
  const gradeName = process.env.SEED_GRADE ?? "Khối 1";
  const yearName = process.env.SEED_YEAR ?? "2026-2027";
  const passwordHash = await hashPassword(password);

  try {
    const created = await db.transaction(async (tx) => {
      const [grade] = await tx.insert(schema.grades)
        .values({ name: gradeName })
        .onConflictDoUpdate({ target: schema.grades.name, set: { name: gradeName } })
        .returning();
      const inserted = await tx.insert(schema.users).values({
        email, name: process.env.SEED_NAME ?? "Trưởng khối", passwordHash,
        isGradeHead: true, gradeId: grade.id,
      }).onConflictDoNothing().returning({ id: schema.users.id });

      const [existingYear] = await tx.select().from(schema.schoolYears).where(eq(schema.schoolYears.name, yearName));
      if (!existingYear) {
        const [year] = await tx.insert(schema.schoolYears).values({ name: yearName }).returning();
        await tx.insert(schema.terms).values([
          { schoolYearId: year.id, name: "Học kỳ 1", startsOn: process.env.SEED_T1_START ?? "2026-09-01", endsOn: process.env.SEED_T1_END ?? "2027-01-15" },
          { schoolYearId: year.id, name: "Học kỳ 2", startsOn: process.env.SEED_T2_START ?? "2027-01-16", endsOn: process.env.SEED_T2_END ?? "2027-05-31" },
        ]);
      }
      return { userInserted: inserted.length > 0, gradeName: grade.name };
    });
    console.log(
      created.userInserted
        ? `Đã tạo trưởng khối ${email} cho ${created.gradeName}, năm học ${yearName}.`
        : `Tài khoản ${email} đã tồn tại, giữ nguyên.`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : "Lỗi không xác định"); process.exit(1); });
