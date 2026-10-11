import { requireUser } from "@/lib/auth/dal";

/**
 * Bố cục toàn màn hình cho máy quét: không có BottomNav, header lớp hay tab lớp (tránh lối thoát làm mất lượt
 * chưa lưu, khung camera to hơn). Quyền với lớp do từng trang kiểm tra.
 */
export default async function ScanLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <main className="mx-auto min-h-dvh w-full max-w-3xl">{children}</main>;
}
