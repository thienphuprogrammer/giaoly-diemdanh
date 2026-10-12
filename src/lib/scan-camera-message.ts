/** Trạng thái camera của máy quét. `decoder-failed`: camera mở được nhưng không nạp được bộ đọc mã QR (WASM). */
export type CameraState = "starting" | "on" | "restarting" | "denied" | "unavailable" | "decoder-failed";

export interface CameraProblem { title: string; body: string; canReopen: boolean }

/** Thông báo cho người dùng khi máy quét không dùng camera được (null khi camera đang chạy/đang mở). */
export function cameraProblem(state: CameraState): CameraProblem | null {
  switch (state) {
    case "denied":
      return {
        title: "Chưa cho phép dùng camera",
        body: "Vào cài đặt trình duyệt, cho trang này dùng camera rồi tải lại. iPhone: Cài đặt > Safari > Camera > Hỏi hoặc Cho phép; nếu mở từ biểu tượng ngoài Màn hình chính thì vuốt tắt hẳn app rồi mở lại để được hỏi lại. Trong lúc đó vẫn điểm danh được bằng cách tìm tên.",
        canReopen: false,
      };
    case "unavailable":
      return {
        title: "Không mở được camera",
        body: "Camera đang bị ứng dụng khác dùng, vừa bị tắt khi khóa máy, hoặc thiết bị không có camera. Bấm “Mở lại camera”, hoặc tìm tên để điểm danh.",
        canReopen: true,
      };
    case "decoder-failed":
      // Hay gặp nhất: iPhone iOS 15 trở xuống (CSP mặc định chặn WebAssembly ở đó) hoặc mạng yếu khi tải bộ đọc.
      return {
        title: "Máy này chưa đọc được mã QR",
        body: "Không tải được bộ đọc mã QR. Nếu mạng yếu, bấm “Mở lại camera” để thử lại. iPhone cần iOS 16 trở lên (Cài đặt > Cài đặt chung > Cập nhật phần mềm). Trong lúc đó vẫn điểm danh được bằng “Tìm bằng tên”.",
        canReopen: true,
      };
    default:
      return null;
  }
}
