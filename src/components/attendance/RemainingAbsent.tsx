"use client";
import { UserX } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";

export interface RemainingStudent { id: string; fullName: string; saintName?: string | null }

/** Nút mở bảng xác nhận. Khi `blockedReason` có giá trị: vô hiệu hoá và nói rõ lý do ngay dưới nút. */
export function RemainingAbsentButton({ count, blockedReason, onOpen, className = "btn btn-secondary btn-lg w-full" }: {
  count: number; blockedReason: string | null; onOpen: () => void; className?: string;
}) {
  if (count <= 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={onOpen} disabled={blockedReason !== null} className={className}>
        <UserX aria-hidden size={20} />
        Đánh vắng {count} em còn lại
      </button>
      {blockedReason && <p role="status" className="text-sm text-ink-soft">{blockedReason}</p>}
    </div>
  );
}

/**
 * Bảng xác nhận kết thúc buổi: liệt kê tên các em sẽ được ghi "vắng không phép" và nói rõ hệ quả (cảnh báo từ 2 buổi
 * trong học kỳ). Dùng chung cho bảng điểm danh và màn quét. `onConfirm` do bên gọi xử lý lưu (đếm lượt đang lưu, báo lỗi).
 */
export function RemainingAbsentSheet({ students, blockedReason, onConfirm, onClose }: {
  students: readonly RemainingStudent[]; blockedReason: string | null; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Sheet label="Đánh vắng các em còn lại" onClose={onClose}>
      <h2 className="font-display text-lg font-semibold">Đánh vắng {students.length} em còn lại?</h2>
      <p className="text-ink-soft">
        Các em dưới đây chưa được điểm danh. Bấm “Đánh vắng” sẽ ghi <b>vắng không phép</b> cho từng em, và được tính vào cảnh báo
        (từ 2 buổi vắng không phép trong học kỳ). Không đụng tới các em đã có dấu điểm danh.
      </p>
      <ul aria-label="Các em sẽ bị đánh vắng" className="max-h-[38dvh] overflow-y-auto rounded-control border border-border bg-surface-muted px-3 py-1 text-sm">
        {students.map((s) => (
          <li key={s.id} className="py-1.5 font-medium">{s.saintName ? <span className="font-normal text-ink-soft">{s.saintName} </span> : null}{s.fullName}</li>
        ))}
      </ul>
      <p className="text-sm text-ink-soft">Em nào vắng có lý do, chạm vào em đó trên bảng điểm danh rồi đổi thành “Vắng có phép”.</p>
      {blockedReason && <p role="status" className="text-sm font-medium text-warn-alert">{blockedReason}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-secondary btn-lg" onClick={onClose}>Huỷ</button>
        <button type="button" className="btn btn-primary btn-lg" disabled={blockedReason !== null || students.length === 0} onClick={onConfirm}>Đánh vắng</button>
      </div>
    </Sheet>
  );
}
