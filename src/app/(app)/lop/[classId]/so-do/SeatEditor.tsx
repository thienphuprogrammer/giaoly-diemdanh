"use client";
import { useState } from "react";
import { SeatMap } from "@/components/seating/SeatMap";
import { seatKey, unseatedStudentIds } from "@/lib/seating/assignments";
import { addBench, addGap, addRow, canAddBench, canAddRow, removeItem, removeRow, setBenchSeats, LIMITS } from "@/lib/seating/layout";
import type { Assignment, Layout, Seat } from "@/lib/seating/types";
import { shortName } from "@/lib/students/short-name";
import { assignSeatAction, saveLayoutAction } from "./actions";

interface Props {
  classId: string;
  planId: string;
  initialLayout: Layout;
  initialAssignments: Assignment[];
  students: { id: string; fullName: string }[];
  canWrite: boolean;
}

const SAVE_ERROR = "Không lưu được, thử lại sau.";
const uid = () => crypto.randomUUID();
const chip = "h-11 min-w-11 rounded-lg border border-line bg-card px-3 text-sm font-medium";

export function SeatEditor({ classId, planId, initialLayout, initialAssignments, students, canWrite }: Props) {
  const [mode, setMode] = useState<"seat" | "layout">("seat");
  const [layout, setLayout] = useState(initialLayout);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [picking, setPicking] = useState<Seat | null>(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  const names = new Map(students.map((s) => [s.id, s.fullName]));
  const owner = new Map(assignments.map((a) => [seatKey(a), a.studentId]));
  const freeIds = new Set(unseatedStudentIds(students.map((s) => s.id), assignments));
  const edit = (next: Layout) => { setLayout(next); setDirty(true); setMessage(undefined); };

  async function save() {
    setBusy(true);
    try {
      const r = await saveLayoutAction(classId, { planId, layout });
      if (r.ok) { setAssignments(r.data.assignments); setDirty(false); setMessage("Đã lưu bố cục"); }
      else setMessage(r.error);
    } catch {
      setMessage(SAVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function assign(studentId: string | null) {
    if (!picking) return;
    setBusy(true);
    try {
      const r = await assignSeatAction(classId, { planId, ...picking, studentId });
      if (r.ok) setAssignments(r.data.assignments); else setMessage(r.error);
    } catch {
      setMessage(SAVE_ERROR);
    } finally {
      setPicking(null);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {canWrite && (
        <div className="flex gap-2" role="tablist">
          <button role="tab" aria-selected={mode === "seat"} disabled={dirty} onClick={() => setMode("seat")} className={`${chip} ${mode === "seat" ? "bg-brand text-white" : ""}`}>Xếp chỗ</button>
          <button role="tab" aria-selected={mode === "layout"} onClick={() => setMode("layout")} className={`${chip} ${mode === "layout" ? "bg-brand text-white" : ""}`}>Bố cục</button>
        </div>
      )}
      {dirty && <p className="text-sm text-warn-watch">Hãy lưu bố cục trước khi xếp chỗ.</p>}

      {mode === "seat" || !canWrite ? (
        <>
          <SeatMap layout={layout} renderSeat={(seat) => {
            const id = owner.get(seatKey(seat));
            return (
              <button disabled={!canWrite} onClick={() => setPicking(seat)} aria-label={id ? `Ghế của ${names.get(id)}` : "Ghế trống"}
                className={`flex h-16 w-16 items-center justify-center rounded-xl border text-xs font-medium ${id ? "border-brand bg-paper" : "border-dashed border-line text-ink-soft"}`}>
                {id ? shortName(names.get(id) ?? "") : "+"}
              </button>
            );
          }} />
          <p className="text-sm text-ink-soft">Chưa xếp chỗ: {freeIds.size} em</p>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          {layout.map((row, index) => (
            <div key={row.id} className="rounded-2xl border border-line bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Hàng {index + 1}</span>
                <button className={chip} disabled={!canAddBench(layout, row.id)} onClick={() => edit(addBench(layout, row.id, uid()))}>+ Băng</button>
                <button className={chip} onClick={() => edit(addGap(layout, row.id, uid()))}>+ Lối đi</button>
                <button className={`${chip} text-warn-alert`} onClick={() => edit(removeRow(layout, row.id))}>Xóa hàng</button>
              </div>
              <ul className="mt-2 flex flex-wrap gap-2">
                {row.items.map((item) => (
                  <li key={item.id} className="flex items-center gap-1 rounded-xl border border-line px-2 py-1 text-sm">
                    {item.type === "gap" ? "Lối đi" : (
                      <>
                        Băng
                        <button aria-label="Bớt ghế" className={chip} disabled={item.seats <= LIMITS.minSeats} onClick={() => edit(setBenchSeats(layout, item.id, item.seats - 1))}>−</button>
                        {item.seats}
                        <button aria-label="Thêm ghế" className={chip} disabled={item.seats >= LIMITS.maxSeats} onClick={() => edit(setBenchSeats(layout, item.id, item.seats + 1))}>+</button>
                      </>
                    )}
                    <button aria-label="Xóa" className={`${chip} text-warn-alert`} onClick={() => edit(removeItem(layout, row.id, item.id))}>×</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <button className={chip} disabled={!canAddRow(layout)} onClick={() => edit(addRow(layout, uid()))}>+ Thêm hàng</button>
          <button className="h-12 rounded-xl bg-brand font-semibold text-white disabled:opacity-60" disabled={!dirty || busy} onClick={save}>Lưu bố cục</button>
        </div>
      )}
      {message && <p role="status" className="text-sm">{message}</p>}

      {picking && (
        <div role="dialog" aria-label="Chọn em" className="fixed inset-x-0 bottom-0 z-30 max-h-[70dvh] overflow-y-auto rounded-t-3xl border-t border-line bg-card p-4 shadow-2xl">
          <div className="mx-auto max-w-3xl">
            <button className={`${chip} mb-2 w-full`} disabled={busy} onClick={() => assign(null)}>Bỏ trống ghế này</button>
            <ul className="grid gap-1">
              {students.filter((s) => freeIds.has(s.id) || owner.get(seatKey(picking)) === s.id).map((s) => (
                <li key={s.id}><button className="h-12 w-full rounded-lg px-3 text-left" disabled={busy} onClick={() => assign(s.id)}>{s.fullName}</button></li>
              ))}
            </ul>
            <button className={`${chip} mt-2 w-full`} onClick={() => setPicking(null)}>Đóng</button>
          </div>
        </div>
      )}
    </div>
  );
}
