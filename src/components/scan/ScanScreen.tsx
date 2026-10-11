"use client";
import { ArrowLeft, CircleAlert, Clock, Search, Undo2, UserCheck, VideoOff, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { Pill, StatusPill } from "@/components/ui/Pill";
import { Sheet } from "@/components/ui/Sheet";
import { QrCamera, type CameraState } from "./QrCamera";
import { useScanFeedbackSetting } from "./feedback";
import { useScanSession } from "./useScanSession";
import { dateLabel } from "@/lib/date-label";

export function ScanScreen({ sessionId, classId, className, heldOn }: { sessionId: string; classId: string; className: string; heldOn: string }) {
  const s = useScanSession({ sessionId });
  const [storedFeedback, saveFeedback] = useScanFeedbackSetting();
  const [camera, setCamera] = useState<CameraState>("starting");
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [review, setReview] = useState(false);
  const [leave, setLeave] = useState(false);
  const paused = !!s.confirm || finding || review || leave;
  // Sheet đặt focus lại mỗi khi onClose đổi: giữ các hàm đóng ổn định để không cướp focus khỏi ô tìm kiếm.
  const { setConfirm } = s;
  const closeConfirm = useCallback(() => setConfirm(null), [setConfirm]);
  const closeFinding = useCallback(() => { setFinding(false); setQuery(""); }, []);
  const closeReview = useCallback(() => setReview(false), []);
  const closeLeave = useCallback(() => setLeave(false), []);
  const searchRef = useRef<HTMLInputElement>(null);
  // Effect của cha chạy sau effect của Sheet (vốn focus vào khung): đưa focus về ô tìm để gõ ngay.
  useEffect(() => { if (finding) searchRef.current?.focus(); }, [finding]);
  const needsAction = s.queue.events.filter((e) => e.state === "needs_confirm" || e.state === "rejected" || e.state === "failed");
  const boardHref = `/lop/${classId}/diem-danh/${heldOn}`;
  const late = s.mode === "late";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        {s.pending > 0
          ? <button type="button" onClick={() => setLeave(true)} className="btn btn-secondary"><ArrowLeft aria-hidden size={18} /> Xong</button>
          : <Link href={boardHref} className="btn btn-secondary"><ArrowLeft aria-hidden size={18} /> Xong</Link>}
        <button type="button" onClick={() => saveFeedback(!storedFeedback)} aria-pressed={storedFeedback}
          aria-label="Rung và tiếng bíp khi quét" title={storedFeedback ? "Đang bật rung/tiếng bíp" : "Đang tắt rung/tiếng bíp"}
          className="btn btn-ghost btn-icon shrink-0">
          {storedFeedback ? <Volume2 aria-hidden size={20} /> : <VolumeX aria-hidden size={20} />}
        </button>
        <div className="ml-auto min-w-0 text-right">
          <h2 className="font-display text-lg font-semibold leading-tight">Quét thẻ QR</h2>
          <p className="truncate font-display text-sm text-ink-soft">{className} · {dateLabel(heldOn)}</p>
        </div>
      </div>

      <div role="radiogroup" aria-label="Chế độ quét" className="grid grid-cols-2 gap-1 rounded-control border border-border bg-surface-muted p-1">
        {(["present", "late"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={s.mode === m} onClick={() => s.setMode(m)}
            className={`flex h-12 items-center justify-center gap-2 rounded-control font-display text-base transition-colors ${s.mode === m ? `${m === "late" ? "bg-st-late" : "bg-st-present"} font-semibold text-white shadow-sm` : "font-medium text-ink-soft hover:bg-surface"}`}>
            {m === "late" ? <Clock aria-hidden size={18} /> : <UserCheck aria-hidden size={18} />}
            {m === "late" ? "Đi muộn" : "Có mặt"}
          </button>
        ))}
      </div>
      {late && <Notice tone="warning" role="status">Đang quét ở chế độ <b>Đi muộn</b>: các thẻ quét sau sẽ ghi Đi muộn.</Notice>}

      {camera === "denied" || camera === "unavailable" ? (
        <EmptyState icon={VideoOff} title={camera === "denied" ? "Chưa cho phép dùng camera" : "Không mở được camera"}
          action={<button type="button" onClick={() => setFinding(true)} className="btn btn-primary">Tìm bằng tên</button>}>
          {camera === "denied" ? "Vào cài đặt trình duyệt, cho trang này dùng camera rồi tải lại. Trong lúc đó vẫn điểm danh được bằng cách tìm tên." : "Thiết bị không có camera hoặc đang bị ứng dụng khác dùng. Bạn vẫn có thể tìm tên để điểm danh."}
        </EmptyState>
      ) : (
        <QrCamera onCode={s.handleCode} onState={setCamera} paused={paused} />
      )}
      {camera === "starting" && <p className="text-sm text-ink-soft" role="status">Đang mở camera…</p>}
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
        ) : <p className="text-ink-soft">Đưa thẻ QR của em vào khung hình.</p>}
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
            {e.state === "sending" && <Pill tone="action">Đang gửi</Pill>}
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

      {review && (
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
          <p className="text-sm text-ink-soft">Không tự chuyển em chưa điểm danh thành vắng. Muốn đánh vắng, mở bảng điểm danh.</p>
          <Link href={boardHref} className="btn btn-primary btn-lg">Mở bảng điểm danh</Link>
        </Sheet>
      )}

      {leave && (
        <Sheet label={s.pending > 0 ? "Còn lượt chưa lưu" : "Đã lưu hết"} onClose={closeLeave}>
          {s.pending > 0 ? (
            <>
              <p className="font-display text-lg font-semibold">Còn {s.unsaved.total} lượt chưa lưu</p>
              <ul className="text-ink-soft" role="status">
                {s.unsaved.sending > 0 && <li>{s.unsaved.sending} lượt đang gửi: ở lại vài giây để gửi xong.</li>}
                {s.unsaved.failed > 0 && <li>{s.unsaved.failed} lượt chưa gửi được: thử gửi lại, hoặc ghi tay trên bảng điểm danh.</li>}
              </ul>
              <p className="text-sm text-ink-soft">Thoát bây giờ sẽ mất các lượt này.</p>
              {s.unsaved.failed > 0 && <button type="button" className="btn btn-primary btn-lg" onClick={s.retryAllFailed}>Thử gửi lại {s.unsaved.failed} lượt</button>}
              <button type="button" className={`btn btn-lg ${s.unsaved.failed > 0 ? "btn-secondary" : "btn-primary"}`} onClick={closeLeave}>Ở lại</button>
              <Link href={boardHref} className="btn btn-danger">Vẫn thoát</Link>
            </>
          ) : (
            <>
              <p className="font-display text-lg font-semibold" role="status">Đã lưu hết các lượt quét</p>
              <Link href={boardHref} className="btn btn-primary btn-lg">Về bảng điểm danh</Link>
            </>
          )}
        </Sheet>
      )}
    </section>
  );
}
