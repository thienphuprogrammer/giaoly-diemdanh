# Độ tin cậy lưu dữ liệu và UX điểm danh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Không mất dữ liệu điểm danh khi mạng chậm/rớt/khoá máy/đóng tab, bảng luôn đúng trạng thái, và giảm số thao tác cho giáo lý viên (GLV) trên điện thoại.

**Architecture:** Giữ nguyên services/API hiện có (idempotent theo `eventId`). Thêm hàng đợi lưu bền phía client (localStorage/IndexedDB) dùng chung cho màn quét; thêm lớp "trạng thái lưu" cho bảng điểm danh; thêm service `markRemainingAbsent`; gia hạn phiên đăng nhập và `?next=`.

**Tech Stack:** Next.js 16 App Router, React 19.3, Drizzle + Postgres, Vitest + PGlite, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-11-diemdanh-giaoly-design.md`; nguồn yêu cầu: `.superpowers/sdd/2026-10-11-diemdanh-giaoly/audit-save-ux.md` (mục A1–A7, B1–B12). Người dùng đã duyệt danh sách này ("OK làm giúp tôi đi").

## Global Constraints

- Tiếng Việt cho mọi chuỗi giao diện; chỉ giao diện sáng; mobile-first, vùng chạm ≥ 44px.
- Mọi lần gửi lại dùng cùng `eventId` (đã idempotent phía server); không đổi hợp đồng API đã có (`/api/diem-danh/*`).
- Token QR không vào log/DOM/localStorage dưới dạng dễ đọc ngoài hàng đợi quét (hàng đợi chỉ lưu payload gửi đi; xóa khi đã lưu xong).
- TDD; không `--no-verify`; không hằng số giống bí mật trong test; bất biến (không mutate).
- Thao tác phá hủy/hàng loạt (đánh vắng hàng loạt, tất cả có mặt, nghỉ lễ) phải xác nhận hoặc hoàn tác được.

## Rulings

- "Kết thúc buổi": KHÔNG tự động. Nút "Đánh vắng N em còn lại" hiện danh sách + xác nhận, ghi trạng thái `absent_unexcused`, có hoàn tác bằng cách sửa từng em. (Người dùng chưa chọn giữa tự động/danh sách; chọn phương án an toàn hơn.)
- Phiên đăng nhập: trượt (gia hạn khi còn < 3 ngày) với thời hạn 30 ngày.

## Review Focus

- Mất mạng giữa lúc quét rồi đóng/mở lại tab: lượt quét còn lại được gửi, không trùng.
- Hai thiết bị cùng điểm danh một buổi: bảng làm mới không ghi đè kết quả mới hơn.
- Bấm Back từ màn quét về bảng: bảng hiện dữ liệu mới nhất.
- Phiên hết hạn giữa buổi: không mất lượt chưa gửi, đăng nhập xong quay lại đúng trang.

---

### Task 22: Bảng điểm danh đáng tin (A3, A4, A7, B5–B7, B10, B11)

**Files:** `src/components/AttendanceBoard.tsx` (+ tách `useBoardSaves.ts`, `SaveStatus.tsx`, `OfflineBanner.tsx`), `src/lib/*` logic thuần có test, `src/server/services/attendance.ts` nếu cần, copy ("Checklist"→"Danh sách", "Thêm"→"Khác"), nút "…" của ghế ≥ 44px.

- Hàng đợi lưu có trạng thái: "Đang lưu N…" / "Đã lưu ✓" / lỗi kèm tên em + "Thử lại"; timeout mỗi lần gửi; cảnh báo khi rời trang còn lần lưu chưa xong (beforeunload + chặn điều hướng nội bộ).
- Bảng lấy dữ liệu mới từ server khi quay lại bằng Back/forward và khi tab trở lại `visible` (không chỉ `router.refresh()` — bảng đọc dữ liệu một lần; phải đồng bộ state từ props mới nhưng giữ các thay đổi đang chờ lưu).
- "Tất cả có mặt": snackbar hoàn tác 8 giây (khôi phục trạng thái trước đó); "Buổi nghỉ lễ": xác nhận khi đã có dấu điểm danh.
- Banner offline (`navigator.onLine` + sự kiện) trên bảng.
- Test: logic hàng đợi/đồng bộ thuần (reducer), E2E cập nhật.

### Task 23: Màn quét bền vững (A1, A6, B1–B3, B12)

**Files:** `src/components/scan/*` (hàng đợi bền: `persistQueue.ts` + test; `useScanSession.ts`; `QrCamera.tsx`; `ScanScreen.tsx`), layout class để ẩn tab/nav ở route quét.

- Lưu hàng đợi (các sự kiện chưa `saved`) vào localStorage (try/catch; khóa theo sessionId+userId); nạp lại khi mở lại, gửi lại khi `online`, `visibilitychange→visible`, và mở lại màn quét; xóa mục khi đã lưu/từ chối.
- Wake Lock khi quét (xin lại khi tab visible); tự khởi động lại camera khi stream kết thúc/tab quay lại, hiện thông báo khi không mở được.
- Màn quét toàn màn hình (ẩn BottomNav/tab lớp), "Xong" và công tắc Có mặt/Đi muộn ở cuối màn hình; chặn Back khi còn lượt chưa lưu (history guard + xác nhận); "Mở bảng điểm danh" dùng `router.replace` và bảng làm mới.
- Nhớ chế độ quét trong buổi; tự về bảng khi đã lưu hết và người dùng bấm Xong.
- Test: persistQueue (round-trip, hỏng JSON, quota), reducer nạp lại; E2E: đóng/mở tab giữa chừng không mất/không trùng.

### Task 24: Kết thúc buổi — đánh vắng các em còn lại (A2)

**Files:** `src/server/services/attendance.ts` (`markRemainingAbsent(db,user,input)`), test PGlite, server action, nút + sheet xác nhận ở bảng và ở sheet "Xong" của màn quét.

- Service: chỉ cho người có quyền ghi; chỉ chèn dòng cho em đang hoạt động chưa có dòng (không đụng dòng có sẵn); trạng thái `absent_unexcused`, `last_event_id` null; idempotent; trả số em đã đánh. Buổi nghỉ lễ → từ chối.
- UI: nút "Đánh vắng N em còn lại" (chỉ khi N>0), sheet liệt kê tên, xác nhận; sau đó thống kê/cảnh báo cập nhật (revalidate).
- Test: service (quyền, không ghi đè, nghỉ lễ, lặp lại), ảnh hưởng `stats` (cảnh báo ≥2 vắng không phép).

### Task 25: Phiên đăng nhập và lối vào nhanh (A5, B8, B9)

**Files:** `src/lib/auth/*`, `src/proxy.ts`, trang login/action, trang chủ (thẻ lớp).

- JWT 30 ngày, gia hạn khi còn < 3 ngày (cookie được đặt lại ở request hợp lệ); `?next=` (chỉ đường dẫn nội bộ bắt đầu bằng `/`, không `//`, không scheme) sau đăng nhập; proxy chuyển hướng giữ `next`.
- Phiên hết hạn khi gửi API → màn quét giữ hàng đợi (Task 23) và hiện "Cần đăng nhập lại" thay vì mất dữ liệu.
- Thẻ lớp ở trang chủ có nút "Điểm danh hôm nay" và "Quét QR".
- Test: chống open redirect, gia hạn phiên, thẻ lớp; E2E cập nhật.

### Task 26: Phát hành (thay Task 21 cũ)

Thực hiện Task 21 của plan `2026-10-11-diemdanh-giaoly.md` (README/vận hành/bảo mật/checklist, `X-Forwarded-Host`, limiter theo instance, lưu ý `__scanFeed` còn trong bundle) cộng review toàn nhánh. Thêm: `pnpm test:pg` vào quality gate đã tài liệu hóa (README); tiêu chí `__scanFeed` là "inert" chứ không "vắng mặt trong bundle"; E2E `openScanner` chờ tín hiệu UI roster sẵn sàng (không chỉ response); thêm ca E2E mã lạ/sai định dạng.
