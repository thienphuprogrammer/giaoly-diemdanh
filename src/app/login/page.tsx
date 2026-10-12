import { safeNextPath } from "@/lib/auth/next-path";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { next } = await searchParams;
  return <LoginForm next={safeNextPath(next)} />;
}
