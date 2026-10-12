"use client";
import { ChevronLeft, Printer } from "lucide-react";
import Link from "next/link";

/** Thanh công cụ của báo cáo in được: ẩn khi in. "In / Lưu PDF" dùng hộp thoại in của trình duyệt (không thêm thư viện PDF). */
export function ReportToolbar({ backHref, backLabel, hint }: { backHref: string; backLabel: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
      <div className="min-w-0">
        <Link href={backHref} className="btn btn-secondary">
          <ChevronLeft aria-hidden size={20} />{backLabel}
        </Link>
        {hint && <p className="mt-2 text-sm text-ink-soft">{hint}</p>}
      </div>
      <button type="button" onClick={() => window.print()} className="btn btn-primary btn-lg">
        <Printer aria-hidden size={20} /> In / Lưu PDF
      </button>
    </div>
  );
}
