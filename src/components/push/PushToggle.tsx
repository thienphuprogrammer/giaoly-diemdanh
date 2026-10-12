"use client";
import { Bell, BellOff, BellRing, Send, Share, SquarePlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Notice } from "@/components/ui/Notice";
import { Pill } from "@/components/ui/Pill";
import {
  PUSH_STATE_LABEL, base64UrlToBytes, isIosDevice, planSync, pushUiState, readOptOut, sameKey, writeOptOut,
  type OptOutStorage, type PushEnv, type PushUiState,
} from "@/lib/push/client-state";
import type { ActionResult } from "@/server/result";

interface Props {
  /** Cờ "đã tắt trên thiết bị này" lưu theo tài khoản. */
  userId: string;
  /** Khoá VAPID công khai do server đọc từ biến môi trường lúc chạy; null = máy chủ chưa cấu hình thông báo đẩy. */
  publicKey: string | null;
  subscribe: (subscription: unknown) => Promise<ActionResult>;
  unsubscribe: (endpoint: unknown) => Promise<ActionResult>;
  sendTest: () => Promise<ActionResult<{ sent: number }>>;
}

type Message = { tone: "success" | "error" | "info"; text: string } | null;

const SW_URL = "/sw.js";

function readEnv(configured: boolean): Omit<PushEnv, "subscribed"> {
  const nav = navigator as Navigator & { standalone?: boolean };
  const hasNotification = "Notification" in window;
  return {
    configured,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification,
    isIos: isIosDevice(navigator.userAgent, navigator.platform ?? "", navigator.maxTouchPoints ?? 0),
    standalone: window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true,
    permission: hasNotification ? Notification.permission : null,
  };
}

function optOutStore(): OptOutStorage {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

async function subscribeDevice(publicKey: string): Promise<PushSubscription> {
  await navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" });
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
}

/**
 * Nút "Bật thông báo" (spec §4). Chỉ xin quyền khi người dùng bấm. Khi mở trang mà quyền đã cấp: gửi lại đăng ký đang có
 * lên máy chủ (thiết bị đổi tài khoản, hoặc máy chủ đã xoá vì hết hạn), bỏ đăng ký khoá cũ, và chỉ TỰ đăng ký mới khi người
 * dùng chưa bấm "Tắt thông báo" trên thiết bị này (cờ theo tài khoản trong localStorage).
 */
export function PushToggle({ userId, publicKey, subscribe, unsubscribe, sendTest }: Props) {
  const [state, setState] = useState<PushUiState>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const synced = useRef(false);

  const sync = useCallback(async () => {
    const env = readEnv(publicKey !== null);
    const base = pushUiState({ ...env, subscribed: false });
    if (!publicKey || base === "unconfigured" || base === "ios_install" || base === "unsupported" || env.permission !== "granted") {
      setState(base);
      return;
    }
    let sub = await currentSubscription().catch(() => null);
    const key = base64UrlToBytes(publicKey);
    const plan = planSync({ optedOut: readOptOut(optOutStore(), userId), hasSubscription: sub !== null, keyMatches: sameKey(sub?.options.applicationServerKey, key) });
    try {
      if (plan.dropStale && sub) {
        await sub.unsubscribe();
        sub = null;
      }
      if (plan.subscribe) sub = await subscribeDevice(publicKey);
      if (plan.resend && sub) {
        const saved = await subscribe(sub.toJSON());
        if (!saved.ok) sub = null;
      }
    } catch {
      // Lặng lẽ với người dùng (hiện "Chưa bật", bấm lại để thử); ghi lại cho người hỗ trợ, không kèm endpoint/khoá.
      console.warn("push: silent resync failed");
      sub = null;
    }
    setState(pushUiState({ ...env, subscribed: sub !== null }));
  }, [publicKey, subscribe, userId]);

  useEffect(() => {
    if (synced.current) return;
    synced.current = true;
    void sync();
  }, [sync]);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        setMessage({ tone: "info", text: "Chưa được cấp quyền thông báo." });
        return;
      }
      const sub = await subscribeDevice(publicKey);
      const saved = await subscribe(sub.toJSON());
      if (!saved.ok) {
        await sub.unsubscribe().catch(() => undefined);
        setState("off");
        setMessage({ tone: "error", text: saved.error });
        return;
      }
      writeOptOut(optOutStore(), userId, false);
      setState("on");
      setMessage({ tone: "success", text: "Đã bật thông báo trên thiết bị này." });
    } catch {
      setState("off");
      setMessage({ tone: "error", text: "Không bật được thông báo. Kiểm tra kết nối mạng rồi thử lại." });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    // Đặt cờ trước: dù gỡ đăng ký có lỗi, lần mở trang sau cũng không tự bật lại.
    writeOptOut(optOutStore(), userId, true);
    try {
      const sub = await currentSubscription();
      if (sub) {
        const { endpoint } = sub;
        await sub.unsubscribe();
        await unsubscribe(endpoint);
      }
      setState("off");
      setMessage({ tone: "info", text: "Đã tắt thông báo trên thiết bị này." });
    } catch {
      setMessage({ tone: "error", text: "Không tắt được thông báo. Hãy thử lại." });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await sendTest();
      setMessage(r.ok ? { tone: "success", text: "Đã gửi thông báo thử. Nếu không thấy, kiểm tra chế độ Tập trung/Không làm phiền." } : { tone: "error", text: r.error });
    } catch {
      setMessage({ tone: "error", text: "Không gửi được thông báo thử. Hãy thử lại." });
    } finally {
      setBusy(false);
    }
  }

  const on = state === "on";
  return (
    <section aria-labelledby="push-heading" className="card grid gap-4 p-4" data-push-state={state}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-action-tint text-action">
          {on ? <BellRing aria-hidden size={20} /> : <Bell aria-hidden size={20} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="push-heading" className="text-lg font-semibold">Thông báo</h2>
            <Pill tone={on ? "action" : state === "blocked" ? "alert" : "neutral"}>{PUSH_STATE_LABEL[state]}</Pill>
          </div>
          <p className="mt-0.5 text-sm text-ink-soft">Nhắc mở buổi điểm danh và báo khi một em chạm ngưỡng cảnh báo. Thông báo không ghi tên đầy đủ của em.</p>
        </div>
      </div>
      <StateHelp state={state} />
      {message && <Notice tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>{message.text}</Notice>}
      {state === "off" && (
        <button type="button" onClick={enable} disabled={busy} className="btn btn-lg btn-primary w-full">
          <Bell aria-hidden size={20} />
          Bật thông báo
        </button>
      )}
      {on && (
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={test} disabled={busy} className="btn btn-lg btn-secondary w-full">
            <Send aria-hidden size={18} />
            Gửi thử
          </button>
          <button type="button" onClick={disable} disabled={busy} className="btn btn-lg btn-ghost w-full">
            <BellOff aria-hidden size={18} />
            Tắt thông báo
          </button>
        </div>
      )}
    </section>
  );
}

function StateHelp({ state }: { state: PushUiState }) {
  if (state === "ios_install") {
    return (
      <div className="grid gap-2 rounded-control border border-border bg-surface-muted p-3 text-sm text-ink">
        <p className="font-medium">Trên iPhone/iPad, thông báo chỉ hoạt động khi đã thêm app vào Màn hình chính (iOS 16.4 trở lên):</p>
        <ol className="grid gap-1.5 pl-1">
          <li className="flex items-center gap-2"><span className="tabular-nums">1.</span> Mở trang này bằng Safari, bấm <Share aria-label="Chia sẻ" size={16} className="inline" /> (Chia sẻ).</li>
          <li className="flex items-center gap-2"><span className="tabular-nums">2.</span> Chọn <SquarePlus aria-hidden size={16} className="inline" /> “Thêm vào Màn hình chính”.</li>
          <li className="flex items-center gap-2"><span className="tabular-nums">3.</span> Mở app từ biểu tượng mới, vào Tài khoản và bấm “Bật thông báo”.</li>
        </ol>
      </div>
    );
  }
  if (state === "blocked") {
    return <Notice tone="warning">Thông báo đang bị chặn. Mở Cài đặt của trình duyệt (iPhone: Cài đặt › Thông báo › Điểm danh) để cho phép, rồi tải lại trang.</Notice>;
  }
  if (state === "unsupported") {
    return <Notice tone="info">Trình duyệt này không hỗ trợ thông báo đẩy. Hãy dùng Chrome, Edge, Firefox hoặc Safari bản mới.</Notice>;
  }
  if (state === "unconfigured") {
    return <Notice tone="info">Máy chủ chưa bật thông báo đẩy. Hãy báo người quản trị.</Notice>;
  }
  return null;
}
