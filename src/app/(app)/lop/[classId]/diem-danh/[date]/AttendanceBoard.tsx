"use client";
import { Check, CheckCheck, Ellipsis, LayoutGrid, ListChecks, ScanLine, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { SeatMap } from "@/components/seating/SeatMap";
import { StatusSheet } from "@/components/attendance/StatusSheet";
import { SEAT_TILE, StudentButton } from "@/components/attendance/StudentButton";
import { Notice } from "@/components/ui/Notice";
import { StatusPill, WarningPill } from "@/components/ui/Pill";
import { STATUS_META, STATUS_ORDER, type StatusKey } from "@/components/ui/status";
import { countMarked, createSequencer, fillPresent, initialMarks, settleSave, type Mark, type Marks } from "@/lib/attendance/marks";
import { toggleStatus } from "@/lib/attendance/toggle";
import { evaluateWarningFromCount } from "@/lib/attendance/warning";
import { seatKey } from "@/lib/seating/assignments";
import type { Board } from "@/server/services/attendance";
import { markAllPresentAction, setCancelledAction, setStatusAction } from "./actions";

const SAVE_ERROR = "Không lưu được, thử lại sau.";

export function AttendanceBoard({ board }: { board: Board }) {
  const [marks, setMarks] = useState<Marks>(() => initialMarks(board.students));
  const [mode, setMode] = useState<"map" | "list">(board.plan ? "map" : "list");
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(board.cancelled);
  const [busy, setBusy] = useState(false);
  // Trạng thái đã được máy chủ xác nhận cho từng em (để hoàn tác khi lưu lỗi) và bộ đếm lượt lưu:
  // chạm liên tiếp có thể trả về lệch thứ tự: mọi lần lưu thành công đều cập nhật `confirmed`, nhưng chỉ lượt mới nhất mới được hoàn tác / báo lỗi.
  const confirmed = useRef<Marks>(initialMarks(board.students));
  const seq = useRef(createSequencer());
  const readOnly = !board.canWrite || cancelled;

  const byId = useMemo(() => new Map(board.students.map((s) => [s.id, s])), [board.students]);
  const warnOf = (id: string) =>
    evaluateWarningFromCount((byId.get(id)?.priorUnexcused ?? 0) + (!cancelled && marks[id]?.status === "absent_unexcused" ? 1 : 0));
  const levelOf = (id: string) => warnOf(id).level;

  async function save(studentId: string, next: Mark) {
    const turn = seq.current.begin(studentId);
    setMarks((m) => ({ ...m, [studentId]: next }));
    setError(null);
    setFailedId(null);
    let saved = false;
    let message = SAVE_ERROR;
    try {
      const result = await setStatusAction({ sessionId: board.sessionId, studentId, status: next?.status ?? null, reason: next?.reason ?? null });
      saved = result.ok;
      if (!result.ok) message = result.error;
    } catch {
      saved = false;
    } finally {
      const settled = settleSave({ confirmed: confirmed.current, studentId, next, saved, isLatest: seq.current.isLatest(studentId, turn) });
      confirmed.current = settled.confirmed;
      if (settled.revertTo !== undefined) {
        setMarks((m) => ({ ...m, [studentId]: settled.revertTo ?? null }));
        setFailedId(studentId);
        setError(`${message} (${byId.get(studentId)?.fullName ?? "thiếu nhi"})`);
      }
    }
  }

  const closeSheet = useCallback(() => setSheetFor(null), []);
  const tap = (id: string) => { if (!readOnly) void save(id, { status: toggleStatus(marks[id]?.status ?? null), reason: null }); };

  async function markAll() {
    setBusy(true);
    setError(null);
    try {
      const result = await markAllPresentAction({ sessionId: board.sessionId });
      if (!result.ok) { setError(result.error); return; }
      confirmed.current = fillPresent(confirmed.current);
      setMarks((m) => fillPresent(m));
    } catch {
      setError(SAVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function toggleCancelled(value: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await setCancelledAction({ sessionId: board.sessionId, cancelled: value });
      if (result.ok) setCancelled(value); else setError(result.error);
    } catch {
      setError(SAVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const button = (id: string) => (
    <StudentButton fullName={byId.get(id)!.fullName} status={marks[id]?.status ?? null} warning={levelOf(id)} absences={warnOf(id).unexcused}
      failed={failedId === id} disabled={readOnly} onTap={() => tap(id)} onLongPress={() => !readOnly && setSheetFor(id)} />
  );

  const seatOf = new Map(board.plan?.assignments.map((a) => [seatKey(a), a.studentId]) ?? []);
  const seated = new Set(board.plan?.assignments.map((a) => a.studentId));
  const unseated = board.students.filter((s) => !seated.has(s.id));
  const total = board.students.length;
  const marked = countMarked(marks);
  const tally = (key: StatusKey) => board.students.filter((s) => (marks[s.id]?.status ?? "none") === key).length;
  const choice = (pressed: boolean, key: "present" | "absent_unexcused", failed: boolean) =>
    `btn btn-sm w-full border-2 ${pressed ? STATUS_META[key].solid : "btn-secondary"} ${failed ? "ring-[3px] ring-warn-alert ring-offset-2" : ""}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col gap-4 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-display text-lg font-semibold tabular-nums" aria-live="polite">Đã điểm danh {marked}/{total}</p>
          <span aria-hidden className="font-display text-sm font-medium tabular-nums text-ink-soft">{total ? Math.round((marked / total) * 100) : 0}%</span>
        </div>
        <div role="progressbar" aria-label="Tiến độ điểm danh" aria-valuemin={0} aria-valuemax={total} aria-valuenow={marked}
          className="-mt-2 h-2.5 overflow-hidden rounded-full bg-surface-muted">
          <div className="h-full origin-left rounded-full bg-st-present transition-transform duration-200"
            style={{ transform: `scaleX(${total ? marked / total : 0})` }} />
        </div>
        {board.canWrite && !cancelled && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Link prefetch={false} href={`/lop/${board.classId}/diem-danh/${board.heldOn}/quet`} className="btn btn-secondary btn-lg w-full">
              <ScanLine aria-hidden size={20} />
              Quét QR
            </Link>
            <button onClick={markAll} disabled={busy} className="btn btn-primary btn-lg w-full">
              <CheckCheck aria-hidden size={20} />
              Tất cả có mặt
            </button>
          </div>
        )}
        {board.canWrite && (
          <label className="-mx-1 flex min-h-11 items-center justify-between gap-3 rounded-control px-1">
            <span className="flex flex-col">
              <span className="font-medium">Buổi nghỉ lễ</span>
              <span className="text-sm text-ink-soft">Không tính vào thống kê</span>
            </span>
            <input type="checkbox" checked={cancelled} disabled={busy} onChange={(e) => void toggleCancelled(e.target.checked)} className="switch" />
          </label>
        )}
      </div>
      {cancelled && <Notice tone="info" role="status">Buổi nghỉ lễ — không tính vào thống kê.</Notice>}
      {error && <Notice tone="error" role="alert">{error}</Notice>}

      <div role="tablist" aria-label="Cách điểm danh" className="grid grid-cols-2 gap-1 rounded-control border border-border bg-surface-muted p-1">
        {(["map", "list"] as const).map((m) => {
          const Icon = m === "map" ? LayoutGrid : ListChecks;
          return (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              disabled={m === "map" && !board.plan}
              className={`btn min-h-11 rounded-[8px] ${mode === m ? "bg-action text-on-action" : "text-ink-soft hover:bg-surface hover:text-ink"}`}>
              <Icon aria-hidden size={20} />
              {m === "map" ? "Sơ đồ" : "Checklist"}
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
              <div className="flex flex-wrap gap-2">{unseated.map((s) => <div key={s.id}>{button(s.id)}</div>)}</div>
            </div>
          )}
        </>
      ) : (
        <ul className="card flex flex-col divide-y divide-border">
          {board.students.map((s) => {
            const status = marks[s.id]?.status ?? null;
            const level = levelOf(s.id);
            const failed = failedId === s.id;
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
                  <button disabled={readOnly} aria-label={`Thêm lựa chọn cho ${s.fullName}`} onClick={() => setSheetFor(s.id)}
                    className="btn btn-secondary btn-sm border-2">
                    <Ellipsis aria-hidden size={18} strokeWidth={2.5} />Thêm
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
    </div>
  );
}
