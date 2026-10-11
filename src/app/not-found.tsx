import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">Không tìm thấy trang</h1>
      <Link href="/" className="inline-flex h-12 items-center rounded-xl bg-brand px-6 font-semibold text-white">
        Về trang chủ
      </Link>
    </main>
  );
}
