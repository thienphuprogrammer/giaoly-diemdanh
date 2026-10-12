"use client";
import { LogOut } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { clearUserQueues, countUnsentForUser, localStore } from "@/lib/attendance/persist-queue";

/**
 * Đăng xuất: nếu máy còn lượt quét chưa gửi của người này thì hỏi trước (đăng xuất sẽ xóa chúng).
 * Khi đăng xuất, xóa mọi hàng quét của người này khỏi máy (cùng mã thẻ trong đó).
 */
export function LogoutButton({ userId, action }: { userId: string; action: () => Promise<void> }) {
  const form = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  const [unsent, setUnsent] = useState(0);
  const close = useCallback(() => setUnsent(0), []);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (!confirmed.current) {
      const n = countUnsentForUser(localStore(), userId, Date.now());
      if (n > 0) {
        e.preventDefault();
        setUnsent(n);
        return;
      }
    }
    clearUserQueues(localStore(), userId);
  };
  const logoutAnyway = () => {
    confirmed.current = true;
    setUnsent(0);
    form.current?.requestSubmit();
  };

  return (
    <>
      <form ref={form} action={action} onSubmit={onSubmit}>
        <button className="btn btn-secondary btn-lg w-full">
          <LogOut aria-hidden size={20} />Đăng xuất
        </button>
      </form>
      {unsent > 0 && (
        <Sheet label="Còn lượt quét chưa gửi" onClose={close}>
          <h2 className="font-display text-lg font-semibold">Còn {unsent} lượt quét chưa gửi</h2>
          <p className="text-ink-soft">Các lượt này đang chờ có mạng để gửi lên. Đăng xuất bây giờ sẽ xóa chúng khỏi máy, phải quét lại.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-primary btn-lg" onClick={close}>Ở lại</button>
            <button type="button" className="btn btn-danger btn-lg" onClick={logoutAnyway}>Vẫn đăng xuất</button>
          </div>
        </Sheet>
      )}
    </>
  );
}
