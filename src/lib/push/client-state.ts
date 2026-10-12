/**
 * Trạng thái nút "Bật thông báo" (trang Tài khoản). Thuần, test được; component chỉ đọc môi trường trình duyệt rồi gọi
 * `pushUiState`. iPhone/iPad: Web Push chỉ có khi app đã "Thêm vào Màn hình chính" (iOS/iPadOS 16.4+).
 */
export type PushUiState = "loading" | "unconfigured" | "ios_install" | "unsupported" | "blocked" | "off" | "on";

export interface PushEnv {
  /** Máy chủ có đủ cấu hình VAPID (có khoá công khai để đăng ký). */
  configured: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  isIos: boolean;
  /** Đang chạy như app đã cài (display-mode: standalone hoặc `navigator.standalone` của iOS). */
  standalone: boolean;
  permission: "default" | "granted" | "denied" | null;
  subscribed: boolean;
}

export const PUSH_STATE_LABEL: Record<PushUiState, string> = {
  loading: "Đang kiểm tra…",
  unconfigured: "Chưa sẵn sàng",
  ios_install: "Cần thêm vào Màn hình chính",
  unsupported: "Không hỗ trợ",
  blocked: "Bị chặn trong cài đặt",
  off: "Chưa bật",
  on: "Đang bật",
};

export function pushUiState(env: PushEnv): PushUiState {
  if (!env.configured) return "unconfigured";
  if (env.isIos && !env.standalone) return "ios_install";
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return "unsupported";
  if (env.permission === "denied") return "blocked";
  return env.permission === "granted" && env.subscribed ? "on" : "off";
}

/** iPhone/iPod/iPad; iPadOS 13+ tự nhận là "MacIntel" nhưng có màn cảm ứng. */
export function isIosDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}

/** Khoá base64url -> byte cho `applicationServerKey`. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Đăng ký hiện có dùng đúng khoá công khai hiện tại chưa (đổi khoá VAPID thì phải đăng ký lại). */
export function sameKey(current: ArrayBuffer | null | undefined, expected: Uint8Array): boolean {
  if (!current) return false;
  const a = new Uint8Array(current);
  return a.length === expected.length && a.every((v, i) => v === expected[i]);
}

/** Kho lưu kiểu localStorage (có thể null hoặc ném lỗi ở chế độ riêng tư/chặn dữ liệu trang). */
export type OptOutStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;

/** Cờ "đã tự tắt thông báo trên thiết bị này" theo từng tài khoản: trang không tự đăng ký lại khi cờ còn. */
export const pushOptOutKey = (userId: string) => `dd-push-optout:${userId}`;

export function readOptOut(storage: OptOutStorage, userId: string): boolean {
  try {
    return storage?.getItem(pushOptOutKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function writeOptOut(storage: OptOutStorage, userId: string, optedOut: boolean): void {
  try {
    if (optedOut) storage?.setItem(pushOptOutKey(userId), "1");
    else storage?.removeItem(pushOptOutKey(userId));
  } catch {
    // Không lưu được cờ: lần mở sau có thể tự bật lại; không chặn thao tác.
  }
}

export interface SyncInput { optedOut: boolean; hasSubscription: boolean; keyMatches: boolean }
export interface SyncPlan { dropStale: boolean; subscribe: boolean; resend: boolean }

/**
 * Đồng bộ lặng lẽ khi mở trang (quyền đã cấp): đăng ký đang có (đúng khoá) luôn được gửi lại máy chủ (dọn 410, đổi tài
 * khoản); đăng ký khoá cũ thì bỏ; chỉ TỰ đăng ký mới khi người dùng chưa bấm "Tắt thông báo" trên thiết bị này.
 */
export function planSync({ optedOut, hasSubscription, keyMatches }: SyncInput): SyncPlan {
  if (hasSubscription && keyMatches) return { dropStale: false, subscribe: false, resend: true };
  return { dropStale: hasSubscription, subscribe: !optedOut, resend: !optedOut };
}
