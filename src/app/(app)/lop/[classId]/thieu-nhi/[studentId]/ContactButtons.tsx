import { MessageCircle, MessageSquareText, Phone, PhoneOff } from "lucide-react";
import { phoneLinks } from "@/lib/phone";

const BTN = "btn btn-secondary min-h-11 flex-1 basis-[6.5rem]";

/** Nút liên hệ phụ huynh. Không có số (hoặc số cũ sai định dạng) thì ẩn nút và nhắc người dùng. */
export function ContactButtons({ phone, canWrite }: { phone: string | null; canWrite: boolean }) {
  const links = phoneLinks(phone);
  if (!links) {
    return (
      <p className="flex items-start gap-2 text-sm text-ink-soft">
        <PhoneOff aria-hidden size={18} className="mt-0.5 shrink-0" />
        <span>
          {phone
            ? `Số "${phone}" chưa đúng định dạng.${canWrite ? ' Bấm "Sửa ghi chú và SĐT" để nhập lại.' : " Nhờ giáo lý viên phụ trách cập nhật."}`
            : `Chưa có số phụ huynh.${canWrite ? ' Bấm "Sửa ghi chú và SĐT" để thêm.' : ""}`}
        </span>
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <a href={links.tel} className={`${BTN} btn-primary`}><Phone aria-hidden size={20} />Gọi</a>
      <a href={links.zalo} target="_blank" rel="noopener noreferrer" className={BTN}><MessageCircle aria-hidden size={20} />Nhắn Zalo</a>
      <a href={links.sms} className={BTN}><MessageSquareText aria-hidden size={20} />SMS</a>
    </div>
  );
}
