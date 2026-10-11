"use client";
import { Armchair, Check, Minus, MoveHorizontal, Plus, Rows3, Save, Trash2, X } from "lucide-react";
import { useCallback, useState } from "react";
import { SeatMap } from "@/components/seating/SeatMap";
import { Avatar } from "@/components/ui/Avatar";
import { Notice } from "@/components/ui/Notice";
import { Sheet } from "@/components/ui/Sheet";
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
const TILE = "flex h-[72px] w-16 flex-col items-center justify-center gap-1 rounded-control border-2 px-0.5 font-display text-sm transition-[transform,background-color] duration-150 enabled:active:scale-95";

export function SeatEditor({ classId, planId, initialLayout, initialAssignments, students, canWrite }: Props) {
  const [mode, setMode] = useState<"seat" | "layout">("seat");
  const [layout, setLayout] = useState(initialLayout);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [picking, setPicking] = useState<Seat | null>(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  const names = new Map(students.map((s) => [s.id, s.fullName]));
  const owner = new Map(assignments.filter((a) => names.has(a.studentId)).map((a) => [seatKey(a), a.studentId]));
  const freeIds = new Set(unseatedStudentIds(students.map((s) => s.id), assignments));
  const closePicker = useCallback(() => setPicking(null), []);
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

  const tabs = [
    { key: "seat" as const, label: "Xếp chỗ", icon: Armchair },
    { key: "layout" as const, label: "Bố cục", icon: Rows3 },
  ];
  const pickingOwner = picking ? owner.get(seatKey(picking)) : undefined;

  return (
    <div className="flex flex-col gap-4">
      {canWrite && (
        <div role="tablist" aria-label="Chỉnh sơ đồ" className="grid grid-cols-2 gap-1 rounded-control border border-border bg-surface-muted p-1">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button key={key} role="tab" aria-selected={mode === key} disabled={key === "seat" && dirty} onClick={() => setMode(key)}
              className={`btn min-h-11 rounded-[8px] ${mode === key ? "bg-action text-on-action" : "text-ink-soft hover:bg-surface hover:text-ink"}`}>
              <Icon aria-hidden size={20} />
              {label}
            </button>
          ))}
        </div>
      )}
      {dirty && <Notice tone="warning">Hãy lưu bố cục trước khi xếp chỗ.</Notice>}

      {mode === "seat" || !canWrite ? (
        <>
          <div className="card overflow-hidden">
            <SeatMap layout={layout} renderSeat={(seat) => {
              const id = owner.get(seatKey(seat));
              return (
                <button disabled={!canWrite} onClick={() => setPicking(seat)} aria-label={id ? `Ghế của ${names.get(id)}` : "Ghế trống"}
                  className={`${TILE} ${id ? "border-border-strong bg-surface font-semibold text-ink" : "border-dashed border-st-none bg-surface text-ink-soft"}`}>
                  {id ? (
                    <span className="w-full truncate text-center leading-tight">{shortName(names.get(id) ?? "")}</span>
                  ) : (
                    <>
                      <Plus aria-hidden size={20} />
                      <span className="text-xs font-medium leading-none">Trống</span>
                    </>
                  )}
                </button>
              );
            }} />
            <p className="flex items-center gap-2 border-t border-border px-4 py-3 text-sm text-ink-soft">
              <Armchair aria-hidden size={16} />
              Chưa xếp chỗ: <span className="font-display font-semibold tabular-nums text-ink">{freeIds.size} em</span>
            </p>
          </div>
          {canWrite && <p className="text-sm text-ink-soft">Chạm một ghế để chọn em ngồi ở đó.</p>}
        </>
      ) : (
        <div className="flex flex-col gap-3">
          {layout.map((row, index) => (
            <section key={row.id} aria-label={`Hàng ${index + 1}`} className="card flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold">Hàng {index + 1}</h3>
                <button className="btn btn-ghost btn-sm text-warn-alert hover:bg-warn-alert-tint hover:text-warn-alert" onClick={() => edit(removeRow(layout, row.id))}>
                  <Trash2 aria-hidden size={18} />Xóa hàng
                </button>
              </div>
              {row.items.length > 0 && (
                <ul className="flex flex-col divide-y divide-border rounded-control border border-border">
                  {row.items.map((item) => (
                    <li key={item.id} className="flex min-h-14 items-center gap-2 px-3 py-1.5">
                      {item.type === "gap" ? (
                        <span className="flex flex-1 items-center gap-2 text-ink-soft">
                          <MoveHorizontal aria-hidden size={18} />Lối đi
                        </span>
                      ) : (
                        <>
                          <span className="flex flex-1 items-center gap-2 font-medium">
                            <Armchair aria-hidden size={18} className="text-ink-soft" />Băng
                          </span>
                          <span className="flex items-center rounded-control border border-border-strong">
                            <button aria-label="Bớt ghế" className="btn btn-ghost btn-icon rounded-r-none" disabled={item.seats <= LIMITS.minSeats} onClick={() => edit(setBenchSeats(layout, item.id, item.seats - 1))}>
                              <Minus aria-hidden size={18} />
                            </button>
                            <span className="min-w-14 text-center font-display text-sm font-semibold tabular-nums">{item.seats} ghế</span>
                            <button aria-label="Thêm ghế" className="btn btn-ghost btn-icon rounded-l-none" disabled={item.seats >= LIMITS.maxSeats} onClick={() => edit(setBenchSeats(layout, item.id, item.seats + 1))}>
                              <Plus aria-hidden size={18} />
                            </button>
                          </span>
                        </>
                      )}
                      <button aria-label="Xóa" className="btn btn-ghost btn-icon text-warn-alert hover:bg-warn-alert-tint hover:text-warn-alert" onClick={() => edit(removeItem(layout, row.id, item.id))}>
                        <X aria-hidden size={18} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button className="btn btn-secondary btn-sm" disabled={!canAddBench(layout, row.id)} onClick={() => edit(addBench(layout, row.id, uid()))}>
                  <Plus aria-hidden size={18} />Băng
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => edit(addGap(layout, row.id, uid()))}>
                  <Plus aria-hidden size={18} />Lối đi
                </button>
              </div>
            </section>
          ))}
          <button className="btn btn-secondary w-full border-dashed" disabled={!canAddRow(layout)} onClick={() => edit(addRow(layout, uid()))}>
            <Plus aria-hidden size={20} />Thêm hàng
          </button>
          <button className="btn btn-primary btn-lg w-full" disabled={!dirty || busy} onClick={save}>
            <Save aria-hidden size={20} />Lưu bố cục
          </button>
        </div>
      )}
      {message && <Notice tone="info" role="status">{message}</Notice>}

      {picking && (
        <Sheet label="Chọn em" onClose={closePicker}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Chọn em cho ghế này</h2>
            <button onClick={closePicker} aria-label="Đóng" className="btn btn-ghost btn-icon -mr-2 shrink-0">
              <X aria-hidden size={22} />
            </button>
          </div>
          <button className="btn btn-secondary w-full" disabled={busy} onClick={() => assign(null)}>Bỏ trống ghế này</button>
          <ul className="-mx-2 grid gap-1">
            {students.filter((s) => freeIds.has(s.id) || pickingOwner === s.id).map((s) => (
              <li key={s.id}>
                <button className={`flex min-h-14 w-full items-center gap-3 rounded-control px-2 text-left transition-colors hover:bg-surface-muted disabled:opacity-50 ${pickingOwner === s.id ? "bg-action-tint" : ""}`}
                  disabled={busy} onClick={() => assign(s.id)}>
                  <Avatar name={s.fullName} />
                  <span className="min-w-0 flex-1 break-words font-medium">{s.fullName}</span>
                  {pickingOwner === s.id && <Check aria-hidden size={20} className="shrink-0 text-action" />}
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </div>
  );
}
