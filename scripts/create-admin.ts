import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { users } from "../src/db/schema";
import type { Db } from "../src/db/types";
import { databaseUrlFromEnv, postgresOptionsFromEnv, sanitizeDatabaseUrl } from "../src/db/connection-options";
import { bootstrapAdmin } from "../src/server/services/system-admin-bootstrap";

/** Bounded, credential-free messages from validation or the bootstrap service; safe to show the operator. */
class OperatorError extends Error {}

async function hiddenPassword(): Promise<string> {
  if (!process.stdin.isTTY) throw new OperatorError("Đặt ADMIN_PASSWORD qua biến môi trường khi không có terminal tương tác");
  const mutedOutput = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const rl = createInterface({ input: process.stdin, output: mutedOutput, terminal: true });
  try {
    process.stdout.write("Mật khẩu mới (ẩn khi nhập): ");
    const password = await rl.question("");
    process.stdout.write("\nNhập lại mật khẩu (ẩn khi nhập): ");
    const confirm = await rl.question("");
    process.stdout.write("\n");
    if (password !== confirm) throw new OperatorError("Mật khẩu xác nhận không khớp");
    return password;
  } finally { rl.close(); }
}

const PROMOTE_FLAG = "--promote-existing";

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const name = process.env.ADMIN_NAME;
  if (!email || !name) throw new OperatorError("Đặt ADMIN_EMAIL và ADMIN_NAME trước khi chạy");
  // Promoting an existing non-admin account needs an explicit flag, so a typo cannot silently grant admin (L2).
  const promoteExisting = process.argv.slice(2).includes(PROMOTE_FLAG);
  const url = databaseUrlFromEnv(process.env);
  if (!url) throw new OperatorError("Thiếu DATABASE_URL hoặc DATABASE_URL_UNPOOLED");
  const connection = postgres(sanitizeDatabaseUrl(url), postgresOptionsFromEnv(process.env));
  try {
    const db = drizzle(connection, { schema }) as unknown as Db;
    // Case-insensitive, like the service (L3): a legacy "Foo@x.vn" row is the same identity as "foo@x.vn".
    const [existing] = await db.select({ id: users.id, isAdmin: users.isAdmin }).from(users).where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`).limit(1);
    if (existing && !existing.isAdmin && !promoteExisting) {
      throw new OperatorError(`Email này đã thuộc một tài khoản không phải admin. Kiểm tra lại email; nếu thật sự muốn nâng quyền, chạy lại với ${PROMOTE_FLAG}`);
    }
    const password = process.env.ADMIN_PASSWORD ?? (!existing ? await hiddenPassword() : undefined);
    const result = await bootstrapAdmin(db, { email, name, password, ...(promoteExisting ? { promoteExisting: true } : {}) });
    if (!result.ok) throw new OperatorError(result.error);
    console.log(`${result.data.created ? "Đã tạo" : "Đã thiết lập"} admin: ${result.data.email}`);
    console.log(result.data.credentialsChanged ? "Mật khẩu đã được đặt. Giá trị mật khẩu không được in hoặc lưu vào mã nguồn." : "Mật khẩu hiện có được giữ nguyên.");
  } finally { await connection.end(); }
}

main().catch((error: unknown) => {
  // Only our own bounded messages are printed; driver errors may contain the database URL or query parameters.
  if (error instanceof OperatorError) console.error(error.message);
  console.error("Không hoàn tất tạo admin. Kiểm tra ADMIN_EMAIL, ADMIN_NAME, mật khẩu và migration mới nhất.");
  process.exitCode = 1;
});
