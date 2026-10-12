"use client";
import { Check, CircleAlert, Clock, LogIn, RefreshCw, Search, Undo2, UserCheck, VideoOff, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RemainingAbsentButton, RemainingAbsentSheet } from "@/components/attendance/RemainingAbsent";
import { useLeaveGuard } from "@/components/nav/useLeaveGuard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { Pill, StatusPill } from "@/components/ui/Pill";
import { Sheet } from "@/components/ui/Sheet";
import { remainingAbsentBlock } from "@/lib/attendance/remaining-absent";
import { dateLabel } from "@/lib/date-label";
import { QrCamera, type CameraState } from "./QrCamera";
import { useScanFeedbackSetting } from "./feedback";
import { useScanSession } from "./useScanSession";
import { useWakeLock } from "./useWakeLock";

interface ScanScreenProps { sessionId: string; userId: string; classId: string; className: string; heldOn: string }

/**
 * Màn quét toàn màn hình (không có thanh điều hướng/tab lớp). "Xong" và công tắc Có mặt/Đi muộn ở đáy cho ngón cái.
 * Rời màn (Xong, Back, link) khi còn lượt chưa lưu thì hỏi lại; rời bằng `router.replace` để Back không quay lại máy quét.
 */
export function ScanScreen({ sessionId, userId, classId, className, heldOn }: ScanScreenProps) {
  const s = useScanSession({ sessionId, userId });
  const [storedFeedback, saveFeedback] = useScanFeedbackSetting();
  const [camera, setCamera] = useState<CameraState>("starting");
  const [cameraKey, setCameraKey] = useState(0);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [review, setReview] = useState(false);
  const [absentOpen, setAbsentOpen] = useState(false);
  const absentSaving = s.absent.phase === "saving";
  const busyCount = s.pending + (absentSaving ? 1 : 0); // đánh vắng đang lưu cũng chặn rời trang
  const guard = useLeaveGuard(busyCount, { navigate: "replace" });
  const leaving = guard.target !== null;
  const paused = !!s.confirm || finding || review || absentOpen || leaving;
  useWakeLock(camera === "on" || camera === "restarting");
  // Sheet đặt focus lại mỗi khi onClose đổi: giữ các hàm đóng ổn định để không cướp focus khỏi ô tìm kiếm.
  const { setConfirm, clearAbsent } = s;
  const closeConfirm = useCallback(() => setConfirm(null), [setConfirm]);
  const closeFinding = useCallback(() => { setFinding(false); setQuery(""); }, []);
  const closeReview = useCallback(() => { setReview(false); clearAbsent(); }, [clearAbsent]);
  const closeAbsent = useCallback(() => setAbsentOpen(false), []);
  const searchRef = useRef<HTMLInputElement>(null);
  // Effect của cha chạy sau effect của Sheet (vốn focus vào khung): đưa focus về ô tìm để gõ ngay.
  useEffect(() => { if (finding) searchRef.current?.focus(); }, [finding]);
  const reopenCamera = useCallback(() => { setCamera("starting"); setCameraKey((k) => k + 1); }, []);
  // Camera không mở được (đang bị app khác giữ, vừa khóa máy…): thử lại khi người dùng quay lại tab.
  useEffect(() => {
    if (camera !== "unavailable") return;
    const onVisible = () => { if (document.visibilityState === "visible") reopenCamera(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [camera, reopenCamera]);

  const needsAction = s.queue.events.filter((e) => e.state === "needs_confirm" || e.state === "rejected" || e.state === "failed");
  const boardHref = `/lop/${classId}/diem-danh/${heldOn}`;
  const late = s.mode === "late";
  // Còn lượt quét đang gửi/lỗi/cần chọn thì không đánh vắng (tránh chạy đua với hàng đợi); nói rõ lý do.
  const absentBlock = remainingAbsentBlock({ unsaved: s.pending, busy: absentSaving, notReady: s.roster === null });
  const goBoard = () => { setReview(false); guard.go(boardHref); };
  const relogin = () => guard.hardNavigate(`/login?next=${encodeURIComponent(`${boardHref}/quet`)}`);

  return (
    <section aria-label="Quét thẻ QR" aria-busy={s.roster === null} className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-2 px-4 pt-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-lg font-semibold leading-tight">Quét thẻ QR</h1>
          <p className="truncate font-display text-sm text-ink-soft">{className} · {dateLabel(heldOn)}</p>
        </div>
        <button type="button" onClick={() => saveFeedback(!storedFeedback)} aria-pressed={storedFeedback}
          aria-label="Rung và tiếng bíp khi quét" title={storedFeedback ? "Đang bật rung/tiếng bíp" : "Đang tắt rung/tiếng bíp"}
          className="btn btn-ghost btn-icon shrink-0">
          {storedFeedback ? <Volume2 aria-hidden size={20} /> : <VolumeX aria-hidden size={20} />}
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-3 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-3">
        <OfflineBanner>Mất mạng — các lượt quét được giữ trên máy và sẽ tự gửi khi có mạng.</OfflineBanner>
        {s.authRequired && (
          <Notice tone="error" role="alert">
            <p>Cần đăng nhập lại. Các lượt quét chưa lưu vẫn được giữ trên máy này và sẽ tự gửi sau khi đăng nhập.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={relogin} className="btn btn-primary btn-sm"><LogIn aria-hidden size={16} /> Đăng nhập lại</button>
              <button type="button" onClick={s.resume} className="btn btn-secondary btn-sm"><RefreshCw aria-hidden size={16} /> Thử gửi lại</button>
            </div>
          </Notice>
        )}
        {s.persistFailed && s.pending > 0 && (
          <Notice tone="warning" role="status">Máy không lưu được hàng chờ: đừng đóng trang cho tới khi gửi xong.</Notice>
        )}

        {camera === "denied" || camera === "unavailable" ? (
          <EmptyState icon={VideoOff} title={camera === "denied" ? "Chưa cho phép dùng camera" : "Không mở được camera"}
            action={(
              <div className="flex flex-wrap justify-center gap-2">
                {camera === "unavailable" && <button type="button" onClick={reopenCamera} className="btn btn-secondary"><RefreshCw aria-hidden size={18} /> Mở lại camera</button>}
                <button type="button" onClick={() => setFinding(true)} className="btn btn-primary">Tìm bằng tên</button>
              </div>
            )}>
            {camera === "denied"
              ? "Vào cài đặt trình duyệt, cho trang này dùng camera rồi tải lại. Trong lúc đó vẫn điểm danh được bằng cách tìm tên."
              : "Camera đang bị ứng dụng khác dùng, vừa bị tắt khi khóa máy, hoặc thiết bị không có camera. Bấm “Mở lại camera”, hoặc tìm tên để điểm danh."}
          </EmptyState>
        ) : (
          <QrCamera key={cameraKey} onCode={s.handleCode} onState={setCamera} paused={paused} />
        )}
        {camera === "starting" && <p className="text-sm text-ink-soft" role="status">Đang mở camera…</p>}
        {camera === "restarting" && <p className="text-sm text-ink-soft" role="status">Đang mở lại camera…</p>}
        {s.rosterError && (
          <Notice tone="error" role="alert">
            Chưa tải được danh sách lớp. <button type="button" onClick={() => void s.loadRoster()} className="underline">Thử lại</button>
          </Notice>
        )}

        <div aria-live="polite" className="min-h-[88px] rounded-card border border-border bg-surface p-3">
          {s.banner ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                {s.banner.saintName && <p className="text-sm text-ink-soft">{s.banner.saintName}</p>}
                <p className="font-display text-2xl font-semibold leading-tight">{s.banner.fullName ?? ""}</p>
                <p className={`flex items-center gap-1 text-sm font-medium ${s.banner.tone === "error" ? "text-warn-alert" : "text-ink-soft"}`}>
                  {s.banner.tone === "error" && <CircleAlert aria-hidden size={16} className="shrink-0" />}
                  {s.banner.text}
                </p>
              </div>
              {s.banner.status && <StatusPill status={s.banner.status} />}
            </div>
          ) : <p className="text-ink-soft">{s.roster === null ? "Đang tải danh sách lớp…" : "Đưa thẻ QR của em vào khung hình."}</p>}
        </div>

        <div role="group" className="flex flex-wrap items-center gap-2 tabular-nums" aria-label="Tổng kết lượt quét">
          <Pill tone="neutral">Đã lưu {s.summary.saved}</Pill>
          <Pill tone="action">Đang gửi {s.summary.sending}</Pill>
          <Pill tone={s.summary.needsAction ? "alert" : "neutral"} icon={s.summary.needsAction ? CircleAlert : undefined}>Cần xử lý {s.summary.needsAction}</Pill>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setFinding(true)} className="btn btn-secondary"><Search aria-hidden size={18} /> Tìm bằng tên</button>
          <button type="button" onClick={() => setReview(true)} className="btn btn-secondary">Kiểm tra cuối buổi</button>
        </div>

        <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
          {s.recent.length === 0 && <li className="p-3 text-sm text-ink-soft">Chưa quét thẻ nào.</li>}
          {s.recent.map((e) => (
            <li key={e.eventId} className="flex flex-wrap items-center gap-2 p-3">
              <span className="min-w-0 flex-1 font-medium">{e.fullName}</span>
              {e.state === "saved" && <StatusPill status={e.serverStatus ?? e.optimisticStatus} label={e.result === "noop" ? "Đã có" : undefined} />}
              {e.state === "sending" && <Pill tone="action">{s.authRequired ? "Chờ đăng nhập" : "Đang gửi"}</Pill>}
              {e.state === "needs_confirm" && (
                <button type="button" onClick={() => s.reopenConfirm(e)} aria-label={`Chọn trạng thái cho ${e.fullName}`} className="btn btn-secondary btn-sm">
                  <CircleAlert aria-hidden size={16} /> Cần chọn
                </button>
              )}
              {e.state === "rejected" && <Pill tone="alert" icon={CircleAlert}>{e.message ?? "Bị từ chối"}</Pill>}
              {e.state === "failed" && <Pill tone="alert" icon={CircleAlert}>Chưa gửi được</Pill>}
              {e.state === "failed" && <button type="button" onClick={() => s.retry(e.eventId)} className="btn btn-secondary btn-sm">Thử lại</button>}
              {(e.state === "rejected" || e.state === "failed") && (
                <button type="button" onClick={() => s.dismiss(e.eventId)} aria-label={`Bỏ qua lượt của ${e.fullName}`} className="btn btn-ghost btn-sm">Bỏ qua</button>
              )}
              {e.state === "undone" && <Pill>Đã hoàn tác</Pill>}
              {e.state === "saved" && e.result === "applied" && (
                <button type="button" disabled={e.undoBusy} onClick={() => void s.undo(e)} aria-label={`Hoàn tác lượt của ${e.fullName}`} className="btn btn-secondary btn-sm">
                  <Undo2 aria-hidden size={16} /> Hoàn tác
                </button>
              )}
              {e.undoError && <p role="alert" className="w-full text-sm text-warn-alert">{e.undoError}</p>}
            </li>
          ))}
        </ul>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 shadow-bar backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {late && <p role="status" className="text-center text-sm font-medium text-st-late">Đang quét chế độ <b>Đi muộn</b>: thẻ quét sau sẽ ghi Đi muộn.</p>}
          <div className="flex items-stretch gap-2">
            <div role="radiogroup" aria-label="Chế độ quét" className="grid flex-1 grid-cols-2 gap-1 rounded-control border border-border bg-surface-muted p-1">
              {(["present", "late"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={s.mode === m} onClick={() => s.setMode(m)}
                  className={`flex h-12 items-center justify-center gap-1.5 rounded-control font-display text-base transition-colors ${s.mode === m ? `${m === "late" ? "bg-st-late" : "bg-st-present"} font-semibold text-white shadow-sm` : "font-medium text-ink-soft hover:bg-surface"}`}>
                  {m === "late" ? <Clock aria-hidden size={18} className="hidden min-[360px]:block" /> : <UserCheck aria-hidden size={18} className="hidden min-[360px]:block" />}
                  {m === "late" ? "Đi muộn" : "Có mặt"}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => guard.go(boardHref)} className="btn btn-primary h-auto min-h-14 shrink-0 px-4">
              <Check aria-hidden size={18} /> Xong
            </button>
          </div>
        </div>
      </div>

      {finding && (
        <Sheet label="Tìm bằng tên" onClose={closeFinding}>
          <label className="flex flex-col gap-1 text-sm font-medium">Tìm tên
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} className="input" inputMode="search" />
          </label>
          <ul className="flex flex-col gap-1">
            {s.search(query).map((r) => (
              <li key={r.studentId}>
                <button type="button" className="btn btn-secondary w-full justify-start" onClick={() => { s.chooseStudent(r.studentId); closeFinding(); }}>
                  {r.saintName ? `${r.saintName} ` : ""}{r.fullName}
                </button>
              </li>
            ))}
            {query.trim() && s.search(query).length === 0 && <li className="text-sm text-ink-soft">Không thấy em nào khớp.</li>}
          </ul>
        </Sheet>
      )}

      {s.confirm && (
        <Sheet label={`Chọn trạng thái cho ${s.confirm.entry.fullName}`} onClose={closeConfirm}>
          <p className="font-display text-xl font-semibold">{s.confirm.entry.fullName}</p>
          <p className="text-ink-soft">Đang được ghi: <b>{s.confirm.current === "absent_excused" ? "Vắng có phép" : "Vắng không phép"}</b>. Em vừa đến, đổi thành:</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => s.confirmChoice("present")}>Có mặt</button>
            <button type="button" className="btn btn-secondary btn-lg" onClick={() => s.confirmChoice("late")}>Đi muộn</button>
          </div>
          <button type="button" className="btn btn-secondary" onClick={s.keepAsIs}>Giữ nguyên</button>
        </Sheet>
      )}

      {review && !absentOpen && (
        <Sheet label="Kiểm tra cuối buổi" onClose={closeReview}>
          <h2 className="font-display text-lg font-semibold">Em chưa điểm danh ({s.unmarked.length})</h2>
          <ul className="text-sm">{s.unmarked.map((r) => <li key={r.studentId} className="py-1">{r.fullName}</li>)}{s.unmarked.length === 0 && <li className="text-ink-soft">Tất cả đã được điểm danh.</li>}</ul>
          <h2 className="font-display text-lg font-semibold">Lượt cần xử lý ({needsAction.length})</h2>
          {s.summary.sending > 0 && <p className="text-sm text-ink-soft">Còn {s.summary.sending} lượt đang gửi.</p>}
          <ul className="text-sm">
            {needsAction.map((e) => (
              <li key={e.eventId} className="py-1">{e.fullName}: {e.state === "needs_confirm" ? "cần chọn Có mặt/Đi muộn" : e.state === "failed" ? "chưa gửi được" : e.message ?? "bị từ chối"}</li>
            ))}
            {needsAction.length === 0 && <li className="text-ink-soft">Không có lượt nào cần xử lý.</li>}
          </ul>
          <p className="text-sm text-ink-soft">App không tự đánh vắng. Nếu các em còn lại đều vắng, bấm nút dưới để ghi “vắng không phép” cho tất cả; sau đó vẫn đổi từng em sang “có phép” được trên bảng điểm danh.</p>
          {s.absent.phase === "done" && (
            <Notice tone="success" role="status">{s.absent.marked > 0 ? `Đã đánh vắng ${s.absent.marked} em.` : "Không còn em nào cần đánh vắng."}</Notice>
          )}
          {s.absent.phase === "saving" && <Notice tone="info" role="status">Đang lưu…</Notice>}
          {s.absent.phase === "error" && (
            <Notice tone="error" role="alert">
              <p>{s.absent.message}</p>
              {s.unmarked.length > 0 && <button type="button" onClick={() => setAbsentOpen(true)} className="btn btn-secondary btn-sm mt-2">Thử lại đánh vắng</button>}
            </Notice>
          )}
          <RemainingAbsentButton count={s.unmarked.length} blockedReason={absentBlock} onOpen={() => { s.clearAbsent(); setAbsentOpen(true); }} />
          <button type="button" onClick={goBoard} className="btn btn-primary btn-lg">Mở bảng điểm danh</button>
        </Sheet>
      )}

      {absentOpen && (
        <RemainingAbsentSheet students={s.unmarked.map((r) => ({ id: r.studentId, fullName: r.fullName, saintName: r.saintName }))} blockedReason={absentBlock}
          onClose={closeAbsent} onConfirm={() => { closeAbsent(); void s.markRemainingAbsent(); }} />
      )}

      {leaving && (
        <Sheet label={busyCount > 0 ? "Còn lượt chưa lưu" : "Đã lưu hết"} onClose={guard.stay}>
          {busyCount > 0 ? (
            <>
              <p className="font-display text-lg font-semibold">Còn {s.unsaved.total + (absentSaving ? 1 : 0)} lượt chưa xong</p>
              <ul className="text-ink-soft" role="status">
                {absentSaving && <li>Đang lưu việc đánh vắng các em còn lại: ở lại vài giây, xong sẽ tự về bảng điểm danh.</li>}
                {s.unsaved.sending > 0 && <li>{s.unsaved.sending} lượt đang gửi: ở lại vài giây, gửi xong sẽ tự về bảng điểm danh.</li>}
                {s.unsaved.failed > 0 && <li>{s.unsaved.failed} lượt chưa gửi được: thử gửi lại, hoặc ghi tay trên bảng điểm danh.</li>}
                {s.unsaved.needsConfirm > 0 && <li>{s.unsaved.needsConfirm} em đang vắng cần chọn Có mặt/Đi muộn: bấm “Cần chọn” trong danh sách.</li>}
              </ul>
              <p className="text-sm text-ink-soft">
                {s.persistFailed
                  ? "Thoát bây giờ sẽ mất các lượt này."
                  : "Nếu thoát, các lượt này vẫn được giữ trên máy này và sẽ tự gửi khi mở lại màn quét của buổi này."}
              </p>
              {s.unsaved.failed > 0 && <button type="button" className="btn btn-primary btn-lg" onClick={s.retryAllFailed}>Thử gửi lại {s.unsaved.failed} lượt</button>}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={`btn btn-lg ${s.unsaved.failed > 0 ? "btn-secondary" : "btn-primary"}`} onClick={guard.stay}>Ở lại</button>
                <button type="button" className="btn btn-danger btn-lg" onClick={guard.leave}>Vẫn thoát</button>
              </div>
            </>
          ) : (
            <p className="font-display text-lg font-semibold" role="status">Đã lưu hết các lượt quét — đang về bảng điểm danh…</p>
          )}
        </Sheet>
      )}
    </section>
  );
}
