import { isSunday } from "./mass-week";
import { MASS_CANCELLED_SCAN, SESSION_CANCELLED, type ScanKind, type ScanMode } from "./scan-rules";
import type { AttendanceStatus } from "./warning";

type Absence = "absent_excused" | "absent_unexcused";

/**
 * Khác biệt giữa máy quét buổi học và máy quét đi lễ (tại nhà thờ). Cùng một màn hình/hàng đợi/hoàn tác; chỉ chữ và các
 * lựa chọn đổi. Đi lễ: không có "Đi muộn" (ẩn công tắc, chỉ xác nhận "Đi lễ"), không có "Đánh vắng các em còn lại"
 * (em chưa quét = chưa ghi nhận, không bao giờ tự thành vắng).
 */
export interface ScanVariant {
  kind: ScanKind;
  modes: readonly ScanMode[];
  showModeSwitch: boolean;
  /** Lựa chọn khi em đang vắng mà được quét. */
  confirmChoices: readonly ("present" | "late")[];
  offersRemainingAbsent: boolean;
  presentLabel: string;
  title: (heldOn: string) => string;
  appliedText: (status: "present" | "late") => string;
  noopText: (reason: "already_present" | "already_late") => string;
  unmarkedHeading: (count: number) => string;
  allMarkedText: string;
  needsConfirmText: string;
  cancelledText: string;
  /** Hướng dẫn kèm thông báo buổi bị huỷ. */
  cancelledHint: string;
  exitLabel: string;
  /** Nơi "Xong" đưa về (dùng trong câu chữ của hộp hỏi khi rời màn). */
  exitPlace: string;
  /** Nút chọn trong bảng xác nhận khi em đang vắng. */
  confirmLabel: (status: "present" | "late") => string;
  /** Trạng thái vắng hiện có, đọc trong bảng xác nhận. */
  absentLabel: (current: Absence) => string;
  arrivedText: string;
  /** Nhãn riêng cho thẻ trạng thái (undefined = nhãn mặc định của trạng thái). */
  statusLabel: (status: AttendanceStatus | null | undefined) => string | undefined;
}

const dayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const CLASS: ScanVariant = {
  kind: "class",
  modes: ["present", "late"],
  showModeSwitch: true,
  confirmChoices: ["present", "late"],
  offersRemainingAbsent: true,
  presentLabel: "Có mặt",
  title: () => "Quét thẻ QR",
  appliedText: (status) => (status === "late" ? "Đã ghi Đi muộn" : "Đã ghi Có mặt"),
  noopText: (reason) => (reason === "already_late" ? "Đã ghi đi muộn" : "Đã điểm danh"),
  unmarkedHeading: (n) => `Em chưa điểm danh (${n})`,
  allMarkedText: "Tất cả đã được điểm danh.",
  needsConfirmText: "cần chọn Có mặt/Đi muộn",
  cancelledText: SESSION_CANCELLED,
  cancelledHint: "Tắt “Buổi nghỉ lễ” trên bảng điểm danh nếu buổi này vẫn học.",
  exitLabel: "Mở bảng điểm danh",
  exitPlace: "bảng điểm danh",
  confirmLabel: (status) => (status === "late" ? "Đi muộn" : "Có mặt"),
  absentLabel: (current) => (current === "absent_excused" ? "Vắng có phép" : "Vắng không phép"),
  arrivedText: "Em vừa đến, đổi thành:",
  statusLabel: () => undefined,
};

const MASS: ScanVariant = {
  kind: "mass",
  modes: ["present"],
  showModeSwitch: false,
  confirmChoices: ["present"],
  offersRemainingAbsent: false,
  presentLabel: "Đi lễ",
  title: (heldOn) => `Điểm danh đi lễ — ${isSunday(heldOn) ? "Chúa nhật" : "Ngày lễ"} ${dayMonth(heldOn)}`,
  appliedText: () => "Đã ghi Đi lễ",
  noopText: () => "Đã ghi đi lễ",
  unmarkedHeading: (n) => `Em chưa ghi nhận đi lễ (${n})`,
  allMarkedText: "Tất cả đã được ghi nhận đi lễ.",
  needsConfirmText: "cần xác nhận Có đi lễ",
  cancelledText: MASS_CANCELLED_SCAN,
  cancelledHint: "Bấm “Mở lại tuần đi lễ” nếu tuần này vẫn có lễ.",
  exitLabel: "Về trang lớp",
  exitPlace: "trang trước",
  confirmLabel: () => "Có đi lễ",
  absentLabel: (current) => (current === "absent_excused" ? "Không đi lễ có phép" : "Không đi lễ không phép"),
  arrivedText: "Em có mặt ở nhà thờ, đổi thành:",
  statusLabel: (status) => (status === "present" ? "Đi lễ" : status === "absent_excused" || status === "absent_unexcused" ? "Không đi lễ" : undefined),
};

export const scanVariant = (kind: ScanKind): ScanVariant => (kind === "mass" ? MASS : CLASS);

/** Chế độ quét thật sự dùng: buổi đi lễ luôn "present" (không bao giờ gửi `late`), buổi học theo chế độ đã nhớ. */
export const scanModeFor = (kind: ScanKind, remembered: ScanMode): ScanMode => (kind === "mass" ? "present" : remembered);
