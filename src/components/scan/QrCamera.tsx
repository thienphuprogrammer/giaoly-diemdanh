"use client";
import { Flashlight, FlashlightOff } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createQrDecoder } from "@/lib/qr/decoder";
import { createFrameDeduper } from "@/lib/qr/frame-deduper";

export type CameraState = "starting" | "on" | "denied" | "unavailable";

const DENIED = new Set(["NotAllowedError", "PermissionDeniedError", "SecurityError"]);
const TICK_MS = 60;

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

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let stream: MediaStream | null = null;
    const deduper = createFrameDeduper();

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        emitState(DENIED.has((e as DOMException).name) ? "denied" : "unavailable");
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      track.current = stream.getVideoTracks()[0] ?? null;
      const caps = (track.current?.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorch({ supported: !!caps.torch, on: false });
      await video.play().catch(() => undefined);
      const decoder = await createQrDecoder().catch(() => null);
      if (!decoder) { emitState("unavailable"); return; }
      if (stopped) return;
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
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function toggleTorch() {
    const next = !torch.on;
    try {
      await track.current?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch({ supported: true, on: next });
    } catch { /* thiết bị không hỗ trợ: giữ nguyên */ }
  }

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-card bg-ink">
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
