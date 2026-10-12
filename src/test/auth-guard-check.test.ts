import { describe, expect, it } from "vitest";
import { checkRouteSource, checkServerActionSource } from "./auth-guard-check";

const F = "src/app/x/actions.ts";

describe("checkServerActionSource: tệp có directive đầu tệp", () => {
  it("chấp nhận action gọi requireUser hoặc getCurrentUser", () => {
    const src = `"use server";
import { requireUser } from "@/lib/auth/dal";
export async function a(input: unknown) { return doIt(await requireUser(), input); }
export const b = async (input: unknown) => { const u = await getCurrentUser(); return u; };
export const c = async (input: unknown) => doIt(await requireUser(), input);
export default async function d() { await requireUser(); }
`;
    expect(checkServerActionSource(F, src)).toEqual([]);
  });

  it("bắt action không xác thực", () => {
    const src = `"use server";
export async function open(input: unknown) { return doIt(input); }
export async function ok() { await requireUser(); }
`;
    const v = checkServerActionSource(F, src);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ file: F, name: "open" });
  });

  it("chỉ tính thân hàm của chính nó, không lấy requireUser của hàm khác", () => {
    const src = `"use server";
export async function a() { return 1; }
export async function b() { await requireUser(); }
`;
    expect(checkServerActionSource(F, src).map((x) => x.name)).toEqual(["a"]);
  });

  it("không bị lừa bởi chú thích hoặc chuỗi chứa requireUser(", () => {
    const src = `"use server";
export async function a() {
  // await requireUser();
  const s = "requireUser(";
  /* getCurrentUser( */
  return s;
}`;
    expect(checkServerActionSource(F, src).map((x) => x.name)).toEqual(["a"]);
  });

  it("xử lý chữ ký có kiểu trả về và tham số dạng object", () => {
    const src = `"use server";
export async function a(input: { x: number }): Promise<{ ok: boolean }> { return { ok: !!input.x }; }
export async function b({ x }: { x: number }): Promise<{ ok: boolean }> { await requireUser(); return { ok: !!x }; }
`;
    expect(checkServerActionSource(F, src).map((x) => x.name)).toEqual(["a"]);
  });

  it("chấp nhận action đi qua hàm trợ giúp cùng tệp có gọi requireUser", () => {
    const src = `"use server";
async function run(fn: Fn, fd: FormData) { return fn(await requireUser(), fd); }
async function leakyRun(fn: Fn, fd: FormData) { return fn(null, fd); }
export async function good(_: S, fd: FormData) { return run(svc, fd); }
export async function bad(_: S, fd: FormData) { return leakyRun(svc, fd); }
`;
    expect(checkServerActionSource(F, src).map((x) => x.name)).toEqual(["bad"]);
  });

  it("bắt export không nhận dạng được (không thể chứng minh có xác thực)", () => {
    const src = `"use server";
export const wrapped = withAuth(async () => 1);
export type T = string;
`;
    const v = checkServerActionSource(F, src);
    expect(v).toHaveLength(1);
    expect(v[0].name).toBe("wrapped");
  });

  it("danh sách cho phép theo tệp::tên", () => {
    const src = `"use server";
export async function login() { return 1; }
export async function other() { return 2; }
`;
    const v = checkServerActionSource(F, src, [`${F}::login`]);
    expect(v.map((x) => x.name)).toEqual(["other"]);
  });
});

describe("checkServerActionSource: action nội tuyến", () => {
  it("bắt action nội tuyến thiếu xác thực", () => {
    const src = `export default async function Page() {
  async function logout() {
    "use server";
    await deleteSession();
  }
  return null;
}`;
    const v = checkServerActionSource("src/app/p/page.tsx", src);
    expect(v).toHaveLength(1);
    expect(v[0].name).toBe("logout");
  });

  it("chấp nhận action nội tuyến có requireUser trong thân và không lấy requireUser của trang bên ngoài", () => {
    const ok = `export default async function Page() {
  async function save() { "use server"; await requireUser(); }
  return null;
}`;
    expect(checkServerActionSource("src/app/p/page.tsx", ok)).toEqual([]);
    const outside = `export default async function Page() {
  const user = await requireUser();
  async function save() { "use server"; await write(user); }
  return null;
}`;
    expect(checkServerActionSource("src/app/p/page.tsx", outside).map((x) => x.name)).toEqual(["save"]);
  });

  it("cho phép action nội tuyến trong danh sách", () => {
    const src = `async function logout() { "use server"; await deleteSession(); }`;
    expect(checkServerActionSource("src/app/p/page.tsx", src, ["src/app/p/page.tsx::logout"])).toEqual([]);
  });

  it("tệp không có directive thì bỏ qua", () => {
    expect(checkServerActionSource(F, `export async function a() { return 1; }`)).toEqual([]);
  });
});

describe("checkRouteSource", () => {
  it("chấp nhận getCurrentUser hoặc handleScanApi", () => {
    expect(checkRouteSource("r.ts", `const u = await getCurrentUser();`)).toBeNull();
    expect(checkRouteSource("r.ts", `export const POST = (r: Request) => handleScanApi("scan", r, deps);`)).toBeNull();
  });
  it("bắt route không xác thực và không bị lừa bởi chú thích", () => {
    expect(checkRouteSource("r.ts", `export async function GET() { return new Response("x"); }`)).not.toBeNull();
    expect(checkRouteSource("r.ts", `// getCurrentUser()\nexport async function GET() { return new Response("x"); }`)).not.toBeNull();
  });
});
