"use client";
import { RefreshCw, TriangleAlert } from "lucide-react";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-warn-alert-tint text-warn-alert">
        <TriangleAlert aria-hidden size={28} />
      </span>
      <h1 className="text-2xl font-semibold">Có lỗi xảy ra. Thử lại.</h1>
      <p className="text-ink-soft">Nếu lỗi lặp lại, kiểm tra kết nối mạng rồi tải lại trang.</p>
      <button type="button" onClick={() => reset()} className="btn btn-primary btn-lg mt-2 w-full">
        <RefreshCw aria-hidden size={20} />
        Thử lại
      </button>
    </main>
  );
}
