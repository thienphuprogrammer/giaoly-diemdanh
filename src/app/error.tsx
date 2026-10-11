"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">Có lỗi xảy ra. Thử lại.</h1>
      <button type="button" onClick={() => reset()} className="h-12 rounded-xl bg-brand px-6 font-semibold text-white">
        Thử lại
      </button>
    </main>
  );
}
