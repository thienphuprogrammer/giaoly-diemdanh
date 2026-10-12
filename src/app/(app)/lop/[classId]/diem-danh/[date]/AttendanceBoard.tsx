"use client";
import { Check, CheckCheck, Ellipsis, LayoutGrid, ListChecks, ScanLine, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { SeatMap } from "@/components/seating/SeatMap";
import { SaveStatus, SaveToasts } from "@/components/attendance/SaveStatus";
import { RemainingAbsentButton, RemainingAbsentSheet } from "@/components/attendance/RemainingAbsent";
import { StatusSheet } from "@/components/attendance/StatusSheet";
import { SEAT_TILE, StudentButton } from "@/components/attendance/StudentButton";
import { useDeviceUnsent } from "@/components/attendance/useDeviceUnsent";
import { useLeaveGuard } from "@/components/nav/useLeaveGuard";
import { Notice } from "@/components/ui/Notice";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { StatusPill, WarningPill } from "@/components/ui/Pill";
import { Sheet } from "@/components/ui/Sheet";
import { STATUS_META, STATUS_ORDER, type StatusKey } from "@/components/ui/status";
import { countMarked } from "@/lib/attendance/marks";
import { deviceUnsentNotice, remainingAbsentBlock, unmarkedStudents } from "@/lib/attendance/remaining-absent";
import { toggleStatus } from "@/lib/attendance/toggle";
import { evaluateWarningFromCount } from "@/lib/attendance/warning";
import { scannerHrefFromBoard } from "@/lib/scan-return";
import { seatKey } from "@/lib/seating/assignments";
import type { Board } from "@/server/services/attendance";
import { useBoardSaves } from "./useBoardSaves";

/** Lời nhắc khi rời trang: chỉ hứa "tự chuyển" khi không còn em nào lưu lỗi (lỗi thì phải xử lý trước). */
function leaveMessage(pending: number, failed: number): string {
  if (failed > 0) {
    return `${failed} em chưa lưu được${pending > 0 ? `, còn ${pending} lượt đang lưu` : ""}. Bấm "Thử lại" hoặc bỏ qua lỗi ở cuối màn hình; nếu rời trang bây giờ, các thay đổi đó sẽ mất.`;
  }
  return `Còn ${pending} lượt đang lưu — trang sẽ tự chuyển khi lưu xong. Rời trang ngay có thể mất các thay đổi chưa lưu.`;
}

export function AttendanceBoard({ board, userId, renderId }: { board: Board; userId: string; renderId: string }) {
  const saves = useBoardSaves(board, renderId);
  // Lượt quét của buổi còn nằm trên máy này (chưa tới máy chủ): chặn "Đánh vắng" để không đánh vắng nhầm em đã quét.
  const deviceUnsent = useDeviceUnsent(userId, board.sessionId);
  const scannerHref = scannerHrefFromBoard(`/lop/${board.classId}/diem-danh/${board.heldOn}`);
  const { marks, cancelled, save } = saves;
  const [mode, setMode] = useState<"map" | "list">(board.plan ? "map" : "list");
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [confirmHoliday, setConfirmHoliday] = useState(false);
  const [confirmAbsent, setConfirmAbsent] = useState(false);
  const readOnly = !board.canWrite || cancelled || saves.stale;
  const guard = useLeaveGuard(saves.pending + saves.failures.length);

  const byId = useMemo(() => new Map(board.students.map((st) => [st.id, st])), [board.students]);
  const nameOf = (id: string) => byId.get(id)?.fullName ?? "thiếu nhi";
  const failedIds = new Set(saves.failures.map((f) => f.studentId));
  const warnOf = (id: string) =>
    evaluateWarningFromCount((byId.get(id)?.priorUnexcused ?? 0) + (!cancelled && marks[id]?.status === "absent_unexcused" ? 1 : 0));
  const levelOf = (id: string) => warnOf(id).level;

  const closeSheet = useCallback(() => setSheetFor(null), []);
  const closeHoliday = useCallback(() => setConfirmHoliday(false), []);
  const closeAbsent = useCallback(() => setConfirmAbsent(false), []);
  const tap = (id: string) => { if (!readOnly) void save(id, { status: toggleStatus(marks[id]?.status ?? null), reason: null }); };
  const onHolidayChange = (value: boolean) => {
    if (value && countMarked(marks) > 0) setConfirmHoliday(true);
    else void saves.setCancelledOnServer(value);
  };

  const button = (id: string) => (
    <StudentButton fullName={byId.get(id)!.fullName} status={marks[id]?.status ?? null} warning={levelOf(id)} absences={warnOf(id).unexcused}
      failed={failedIds.has(id)} disabled={readOnly} showOptions={board.canWrite && !cancelled} onTap={() => tap(id)} onLongPress={() => !readOnly && setSheetFor(id)} />
  );

  const seatOf = new Map(board.plan?.assignments.map((a) => [seatKey(a), a.studentId]) ?? []);
  const seated = new Set(board.plan?.assignments.map((a) => a.studentId));
  const unseated = board.students.filter((s) => !seated.has(s.id));
  const total = board.students.length;
  const marked = countMarked(marks);
  const remaining = unmarkedStudents(board.students, marks);
  const absentBlock = remainingAbsentBlock({ unsaved: saves.pending + saves.failures.length, busy: saves.busy, notReady: saves.stale, deviceUnsent });
  const unsentNotice = board.canWrite && !cancelled ? deviceUnsentNotice(deviceUnsent) : null;
  const tally = (key: StatusKey) => board.students.filter((st) => (marks[st.id]?.status ?? "none") === key).length;
  const choice = (pressed: boolean, key: "present" | "absent_unexcused", failed: boolean) =>
    `btn btn-sm w-full border-2 ${pressed ? STATUS_META[key].solid : "btn-secondary"} ${failed ? "ring-[3px] ring-warn-alert ring-offset-2" : ""}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col gap-4 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-display text-lg font-semibold tabular-nums" aria-live="polite">Đã điểm danh {marked}/{total}</p>
          <span className="flex items-center gap-2">
            {board.canWrite && <SaveStatus chip={saves.chip} stale={saves.stale} />}
            <span aria-hidden className="font-display text-sm font-medium tabular-nums text-ink-soft">{total ? Math.round((marked / total) * 100) : 0}%</span>
          </span>
        </div>
        <div role="progressbar" aria-label="Tiến độ điểm danh" aria-valuemin={0} aria-valuemax={total} aria-valuenow={marked}
          className="-mt-2 h-2.5 overflow-hidden rounded-full bg-surface-muted">
          <div className="h-full origin-left rounded-full bg-st-present transition-transform duration-200"
            style={{ transform: `scaleX(${total ? marked / total : 0})` }} />
        </div>
        {board.canWrite && !cancelled && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Link prefetch={false} href={scannerHref} className="btn btn-secondary btn-lg w-full">
              <ScanLine aria-hidden size={20} />
              Quét QR
            </Link>
            <button onClick={() => void saves.markAll()} disabled={saves.busy || saves.stale || marked === total} className="btn btn-primary btn-lg w-full">
              <CheckCheck aria-hidden size={20} />
              Tất cả có mặt
            </button>
          </div>
        )}
        {board.canWrite && !cancelled && (
          <RemainingAbsentButton count={remaining.length} blockedReason={absentBlock} onOpen={() => setConfirmAbsent(true)} />
        )}
        {board.canWrite && (
          <label className="-mx-1 flex min-h-11 items-center justify-between gap-3 rounded-control px-1">
            <span className="flex flex-col">
              <span className="font-medium">Buổi nghỉ lễ</span>
              <span className="text-sm text-ink-soft">Không tính vào thống kê</span>
            </span>
            <input type="checkbox" checked={cancelled} disabled={saves.busy || saves.stale} onChange={(e) => onHolidayChange(e.target.checked)} className="switch" />
          </label>
        )}
      </div>
      {board.canWrite && <OfflineBanner>Mất mạng — chưa lưu được. Các lần chạm sẽ báo lỗi để thử lại khi có mạng.</OfflineBanner>}
      {cancelled && <Notice tone="info" role="status">Buổi nghỉ lễ — không tính vào thống kê.</Notice>}
      {unsentNotice && (
        <Notice tone="warning" role="status">
          <p>
            {unsentNotice}{" "}
            <Link prefetch={false} href={scannerHref} className="font-semibold underline">Mở màn quét</Link>
          </p>
        </Notice>
      )}
      {saves.error && (
        <Notice tone="error" role="alert">
          <p>{saves.error}</p>
          {saves.absentFailed && remaining.length > 0 && (
            <button type="button" onClick={() => setConfirmAbsent(true)} className="btn btn-secondary btn-sm mt-2">Thử lại đánh vắng</button>
          )}
        </Notice>
      )}

      <div role="tablist" aria-label="Cách điểm danh" className="grid grid-cols-2 gap-1 rounded-control border border-border bg-surface-muted p-1">
        {(["map", "list"] as const).map((m) => {
          const Icon = m === "map" ? LayoutGrid : ListChecks;
          return (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              disabled={m === "map" && !board.plan}
              className={`btn min-h-11 rounded-[8px] ${mode === m ? "bg-action text-on-action" : "text-ink-soft hover:bg-surface hover:text-ink"}`}>
              <Icon aria-hidden size={20} />
              {m === "map" ? "Sơ đồ" : "Danh sách"}
            </button>
          );
        })}
      </div>

      {mode === "map" && board.plan ? (
        <>
          <div className="card overflow-hidden">
            <SeatMap layout={board.plan.layout} renderSeat={(seat) => {
              const id = seatOf.get(seatKey(seat));
              return id ? button(id) : <div aria-hidden className={`${SEAT_TILE} rounded-control border border-dashed border-border`} />;
            }} />
            <ul aria-label="Chú thích" className="flex flex-wrap gap-x-4 gap-y-2 border-t border-border px-4 py-3">
              {STATUS_ORDER.map((key) => (
                <li key={key} className="flex items-center gap-1.5 text-sm text-ink-soft">
                  <span aria-hidden className={`h-3.5 w-3.5 rounded-[4px] border-2 ${STATUS_META[key].swatch}`} />
                  {STATUS_META[key].short}
                  <span className="font-display font-semibold tabular-nums text-ink">{tally(key)}</span>
                </li>
              ))}
            </ul>
          </div>
          {unseated.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-base font-semibold">Chưa xếp chỗ <span className="font-normal text-ink-soft">· {unseated.length} em</span></h3>
              <div className="flex flex-wrap gap-2">{unseated.map((st) => <div key={st.id}>{button(st.id)}</div>)}</div>
            </div>
          )}
        </>
      ) : (
        <ul className="card flex flex-col divide-y divide-border">
          {board.students.map((s) => {
            const status = marks[s.id]?.status ?? null;
            const level = levelOf(s.id);
            const failed = failedIds.has(s.id);
            return (
              <li key={s.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
                  <span className="break-words font-medium leading-snug">
                    {s.saintName && <span className="text-sm font-normal text-ink-soft">{s.saintName} </span>}
                    {s.fullName}
                  </span>
                  {(level !== "none" || status === "late" || status === "absent_excused") && (
                    <span className="flex flex-wrap gap-1.5">
                      {(status === "late" || status === "absent_excused") && <StatusPill status={status} />}
                      {level !== "none" && (
                        <WarningPill level={level === "warning" ? "warning" : "watch"}>
                          {level === "warning" ? "Cảnh báo" : "Vắng 1"}
                        </WarningPill>
                      )}
                    </span>
                  )}
                </div>
                <span className="grid grid-cols-[1fr_1fr_auto] gap-2 sm:w-72">
                  <button disabled={readOnly} aria-pressed={status === "present"} onClick={() => void save(s.id, { status: "present", reason: null })}
                    className={choice(status === "present", "present", failed)}>
                    <Check aria-hidden size={18} strokeWidth={2.5} />Có
                  </button>
                  <button disabled={readOnly} aria-pressed={status === "absent_unexcused"} onClick={() => void save(s.id, { status: "absent_unexcused", reason: null })}
                    className={choice(status === "absent_unexcused", "absent_unexcused", failed)}>
                    <X aria-hidden size={18} strokeWidth={2.5} />Vắng
                  </button>
                  <button disabled={readOnly} aria-label={`Lựa chọn khác cho ${s.fullName}`} onClick={() => setSheetFor(s.id)}
                    className="btn btn-secondary btn-sm border-2">
                    <Ellipsis aria-hidden size={18} strokeWidth={2.5} />Khác
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {sheetFor && (
        <StatusSheet key={sheetFor} name={byId.get(sheetFor)!.fullName} current={marks[sheetFor]?.status ?? null} reason={marks[sheetFor]?.reason ?? null}
          onClose={closeSheet}
          onPick={(status, reason) => { const id = sheetFor; setSheetFor(null); void save(id, status ? { status, reason } : null); }} />
      )}

      {confirmHoliday && (
        <Sheet label="Đánh dấu buổi nghỉ lễ?" onClose={closeHoliday}>
          <h2 className="font-display text-lg font-semibold">Đánh dấu buổi nghỉ lễ?</h2>
          <p className="text-ink-soft">Đã có {marked} em được điểm danh. Buổi nghỉ lễ sẽ không tính vào thống kê và không sửa điểm danh được nữa (dữ liệu vẫn được giữ, tắt nghỉ lễ là thấy lại).</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-secondary btn-lg" onClick={closeHoliday}>Huỷ</button>
            <button type="button" className="btn btn-primary btn-lg" onClick={() => { closeHoliday(); void saves.setCancelledOnServer(true); }}>Nghỉ lễ</button>
          </div>
        </Sheet>
      )}

      {confirmAbsent && (
        <RemainingAbsentSheet students={remaining} blockedReason={absentBlock} onClose={closeAbsent}
          onConfirm={() => { closeAbsent(); void saves.markRemainingAbsent(); }} />
      )}

      {guard.target && (
        <Sheet label="Chưa lưu xong" onClose={guard.stay}>
          <h2 className="font-display text-lg font-semibold">Chưa lưu xong</h2>
          <p className="text-ink-soft">
            {leaveMessage(saves.pending, saves.failures.length)}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-primary btn-lg" onClick={guard.stay}>Ở lại</button>
            <button type="button" className="btn btn-secondary btn-lg" onClick={guard.leave}>Vẫn rời trang</button>
          </div>
        </Sheet>
      )}

      <SaveToasts
        failures={saves.failures.map((f) => ({ studentId: f.studentId, name: nameOf(f.studentId), message: f.message }))}
        onRetry={saves.retry} onDismiss={saves.dismiss}
        undo={saves.undo && !cancelled ? { text: `Đã ghi có mặt ${saves.undo.count} em`, onUndo: () => void saves.undoMarkAll(), onClose: saves.closeUndo } : null} />
    </div>
  );
}
