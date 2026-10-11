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
