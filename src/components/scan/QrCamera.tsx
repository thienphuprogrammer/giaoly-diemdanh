"use client";
import { Flashlight, FlashlightOff } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createQrDecoder } from "@/lib/qr/decoder";
import { createFrameDeduper } from "@/lib/qr/frame-deduper";

export type CameraState = "starting" | "on" | "restarting" | "denied" | "unavailable";

const DENIED = new Set(["NotAllowedError", "PermissionDeniedError", "SecurityError"]);
const TICK_MS = 60;

/**
 * Camera + vòng giải mã. Tự mở lại khi luồng hình bị ngắt (khóa máy, chuyển app, iOS thu hồi camera)
 * hoặc khi tab hiện lại mà hình đã tắt. Mở lại không được thì báo "unavailable" để màn quét hiện thông báo.
 */
export function QrCamera({ onCode, onState, paused }: {
  onCode: (text: string) => void;
  onState: (state: CameraState) => void;
  /** Tạm ngừng giải mã (đang mở bảng chọn/tìm tên); camera vẫn bật để quay lại ngay. */
  paused: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  const emitCode = useEffectEvent((code: string) => onCode(code));
  const emitState = useEffectEvent((state: CameraState) => onState(state));
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false });
  /** Tăng lên để mở lại camera từ đầu (luồng cũ đã bị ngắt). */
  const [generation, setGeneration] = useState(0);
  const restart = useEffectEvent(() => {
    emitState("restarting");
    setGeneration((n) => n + 1);
  });

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let stream: MediaStream | null = null;
    const deduper = createFrameDeduper();
    // Nạp bộ giải mã (WASM) song song với việc xin quyền camera.
    const decoderReady = createQrDecoder().catch(() => null);
    const onEnded = () => {
      // Luồng bị ngắt khi tab đang ẩn: đợi tab hiện lại rồi mới mở (trình duyệt không cho mở camera khi ẩn).
      if (!stopped && document.visibilityState === "visible") restart();
    };
    const onVisible = () => {
      if (stopped || document.visibilityState !== "visible") return;
      const t = track.current;
      // Luồng đã ngắt, hoặc bị "muted" (iOS giữ track nhưng không còn hình sau khi khóa máy/chuyển app): mở lại.
      if (stream && (!t || t.readyState === "ended" || t.muted)) { restart(); return; }
      const video = videoRef.current;
      if (video?.paused && video.srcObject) void video.play().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        if (!stopped) emitState(DENIED.has((e as DOMException).name) ? "denied" : "unavailable");
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      track.current = stream.getVideoTracks()[0] ?? null;
      track.current?.addEventListener("ended", onEnded);
      const caps = (track.current?.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorch({ supported: !!caps.torch, on: false });
      await video.play().catch(() => undefined);
      const decoder = await decoderReady;
      if (stopped) return;
      if (!decoder) { emitState("unavailable"); return; }
      emitState("on");

      const tick = async () => {
        if (stopped) return;
        if (!pausedRef.current && video.readyState >= 2) {
          const code = await decoder.decodeVideo(video).catch(() => null);
          if (code && deduper.accept(code, performance.now())) emitCode(code);
        }
        timer = window.setTimeout(tick, TICK_MS);
      };
      void tick();
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      track.current?.removeEventListener("ended", onEnded);
      track.current = null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [generation]);

  async function toggleTorch() {
    const next = !torch.on;
    try {
      await track.current?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch({ supported: true, on: next });
    } catch { /* thiết bị không hỗ trợ: giữ nguyên */ }
  }

  return (
    <div className="relative aspect-[4/3] max-h-[52dvh] w-full overflow-hidden rounded-card bg-ink">
      <video ref={videoRef} muted playsInline aria-label="Hình từ camera" className="h-full w-full object-cover" />
      <div aria-hidden className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-white/80" />
      {torch.supported && (
        <button type="button" onClick={toggleTorch} aria-pressed={torch.on} aria-label="Bật đèn"
          className="absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface text-ink">
          {torch.on ? <FlashlightOff aria-hidden size={20} /> : <Flashlight aria-hidden size={20} />}
        </button>
      )}
    </div>
  );
}
