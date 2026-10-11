"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { SeatMap } from "@/components/seating/SeatMap";
import { StatusSheet } from "@/components/attendance/StatusSheet";
import { StudentButton } from "@/components/attendance/StudentButton";
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
  const levelOf = (id: string) =>
    evaluateWarningFromCount((byId.get(id)?.priorUnexcused ?? 0) + (!cancelled && marks[id]?.status === "absent_unexcused" ? 1 : 0)).level;

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
    <StudentButton fullName={byId.get(id)!.fullName} status={marks[id]?.status ?? null} warning={levelOf(id)}
      failed={failedId === id} disabled={readOnly} onTap={() => tap(id)} onLongPress={() => !readOnly && setSheetFor(id)} />
  );

  const seatOf = new Map(board.plan?.assignments.map((a) => [seatKey(a), a.studentId]) ?? []);
  const seated = new Set(board.plan?.assignments.map((a) => a.studentId));
  const unseated = board.students.filter((s) => !seated.has(s.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium" aria-live="polite">Đã điểm danh {countMarked(marks)}/{board.students.length}</p>
        {board.canWrite && !cancelled && (
          <button onClick={markAll} disabled={busy} className="h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60">Tất cả có mặt</button>
        )}
      </div>
      {cancelled && <p role="status" className="rounded-xl bg-paper p-3 text-sm">Buổi nghỉ lễ — không tính vào thống kê.</p>}
      {board.canWrite && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={cancelled} disabled={busy} onChange={(e) => void toggleCancelled(e.target.checked)} className="h-5 w-5" /> Buổi nghỉ lễ
        </label>
      )}
      {error && <p role="alert" className="text-sm text-warn-alert">{error}</p>}

      <div role="tablist" className="flex gap-2">
        {(["map", "list"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
            disabled={m === "map" && !board.plan}
            className={`h-11 rounded-lg border border-line px-4 text-sm font-medium disabled:opacity-40 ${mode === m ? "bg-brand text-white" : "bg-card"}`}>
            {m === "map" ? "Sơ đồ" : "Checklist"}
          </button>
        ))}
      </div>

      {mode === "map" && board.plan ? (
        <>
          <SeatMap layout={board.plan.layout} renderSeat={(seat) => {
            const id = seatOf.get(seatKey(seat));
            return id ? button(id) : <div aria-hidden className="h-16 w-16 rounded-xl border border-dashed border-line opacity-50" />;
          }} />
          {unseated.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-ink-soft">Chưa xếp chỗ</h2>
              <div className="flex flex-wrap gap-2">{unseated.map((s) => <div key={s.id}>{button(s.id)}</div>)}</div>
            </div>
          )}
        </>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-card">
          {board.students.map((s) => (
            <li key={s.id} className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="flex min-w-0 flex-1 basis-40 flex-col items-start gap-1">
                <span className="break-words font-medium">{s.saintName ? `${s.saintName} ` : ""}{s.fullName}</span>
                {levelOf(s.id) !== "none" && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold text-white ${levelOf(s.id) === "warning" ? "bg-warn-alert" : "bg-warn-watch"}`}>
                    {levelOf(s.id) === "warning" ? "Cảnh báo" : "Vắng 1"}
                  </span>
                )}
              </div>
              <span className="flex gap-1">
                <button disabled={readOnly} aria-pressed={marks[s.id]?.status === "present"} onClick={() => void save(s.id, { status: "present", reason: null })}
                  className={`h-11 min-w-11 rounded-lg border px-3 text-sm ${marks[s.id]?.status === "present" ? "border-st-present bg-st-present text-white" : "border-line"} ${failedId === s.id ? "ring-2 ring-warn-alert" : ""}`}>Có</button>
                <button disabled={readOnly} aria-pressed={marks[s.id]?.status === "absent_unexcused"} onClick={() => void save(s.id, { status: "absent_unexcused", reason: null })}
                  className={`h-11 min-w-11 rounded-lg border px-3 text-sm ${marks[s.id]?.status === "absent_unexcused" ? "border-st-unexcused bg-st-unexcused text-white" : "border-line"} ${failedId === s.id ? "ring-2 ring-warn-alert" : ""}`}>Vắng</button>
                <button disabled={readOnly} aria-label={`Thêm lựa chọn cho ${s.fullName}`} onClick={() => setSheetFor(s.id)}
                  className="h-11 w-11 rounded-lg border border-line text-lg">⋯</button>
              </span>
            </li>
          ))}
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
