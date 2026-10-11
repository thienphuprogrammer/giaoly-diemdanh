import { House, SearchX } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-action-tint text-action">
        <SearchX aria-hidden size={28} />
      </span>
      <h1 className="text-2xl font-semibold">Không tìm thấy trang</h1>
      <p className="text-ink-soft">Trang này không tồn tại hoặc bạn không có quyền xem.</p>
      <Link href="/" className="btn btn-primary btn-lg mt-2 w-full">
        <House aria-hidden size={20} />
        Về trang chủ
      </Link>
    </main>
  );
}
