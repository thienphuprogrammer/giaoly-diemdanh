import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getClassById } from "@/db/queries/classes";
import { requireUser } from "@/lib/auth/dal";
import { qrSvg } from "@/lib/qr/generate";
import { formatQrPayload } from "@/lib/qr/payload";
import { getQrCards } from "@/server/services/qr-cards";
import { PrintButton, RotateButton } from "./CardTools";

export default async function QrCardsPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const user = await requireUser();
  const cards = await getQrCards(db, user, classId); // null nếu không có quyền ghi (kể cả trưởng khối chỉ đọc)
  if (!cards) notFound();
  const cls = await getClassById(db, classId);
  const items = await Promise.all(
    cards.map(async (c) => ({
      studentId: c.studentId,
      fullName: c.fullName,
      saintName: c.saintName,
      src: `data:image/svg+xml;utf8,${encodeURIComponent(await qrSvg(formatQrPayload(c.token)))}`,
    })),
  );
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h2 className="text-xl font-semibold">Thẻ QR · {cls?.name}</h2>
          <p className="mt-0.5 text-sm text-ink-soft">{items.length} em. Cắt theo nét đứt, nên ép plastic. Mã chỉ dùng được khi giáo lý viên đăng nhập.</p>
        </div>
        <PrintButton />
      </div>
      {items.length === 0 && <p className="text-ink-soft">Lớp chưa có thiếu nhi nào.</p>}
      <ul className="qr-sheet">
        {items.map((c) => (
          <li key={c.studentId} className="qr-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.src} alt={`Mã QR của ${c.fullName}`} className="qr-img" />
            <div className="min-w-0">
              {c.saintName && <p className="text-sm text-ink-soft">{c.saintName}</p>}
              <p className="font-display text-lg font-semibold leading-tight">{c.fullName}</p>
              <p className="text-sm text-ink-soft">{cls?.name}</p>
              <RotateButton classId={classId} studentId={c.studentId} fullName={c.fullName} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
