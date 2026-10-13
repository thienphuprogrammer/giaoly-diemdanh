"use client";
import { ArrowUpRight, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { Sheet } from "@/components/ui/Sheet";
import { MAX_PROMOTION, PROMOTION_CONSEQUENCES, PROMOTION_HISTORY_NOTE, STALE_PROMOTION } from "@/lib/promotion";
import type { ActionResult } from "@/server/result";
import type { PromotionPreview, PromotionResult, PromotionTargets } from "@/server/services/promotions";

const CONSEQUENCES = PROMOTION_CONSEQUENCES;
const FAILED = "Không lưu được. Kiểm tra mạng rồi thử lại.";
const MAX = MAX_PROMOTION;

interface Props {
  options: PromotionTargets;
  canManageAll?: boolean;
  preview: (input: { fromClassId: string; toClassId: string }) => Promise<ActionResult<PromotionPreview>>;
  apply: (input: { fromClassId: string; toClassId: string; studentIds: string[]; clientToken: string }) => Promise<ActionResult<PromotionResult>>;
  undo: (input: { promotionId: string }) => Promise<ActionResult<{ restored: number; notRestored: number }>>;
}

type Done = { result: PromotionResult; preview: PromotionPreview; undone?: { restored: number; notRestored: number } };

/** Lên lớp: chọn lớp nguồn → lớp đích → tích em (mặc định tất cả) → xác nhận → kết quả kèm nút hoàn tác. */
export function PromotionWizard({ options, preview, apply, undo, canManageAll = false }: Props) {
  const router = useRouter();
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [list, setList] = useState<PromotionPreview | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [token, setToken] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targets = options.targets.filter((t) => t.id !== fromId);
  const reset = () => { setList(null); setDone(null); setToken(null); setError(null); };

  async function run<T>(fn: () => Promise<ActionResult<T>>, onOk: (data: T) => void, onError?: (error: string) => void) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (r.ok) onOk(r.data); else { setError(r.error); onError?.(r.error); }
    } catch {
      setError(FAILED);
    } finally {
      setBusy(false);
    }
  }

  const showList = (p: PromotionPreview) => {
    setList(p);
    setPicked(new Set(p.students.filter((s) => s.selected).map((s) => s.id)));
  };
  const loadStudents = () => run(() => preview({ fromClassId: fromId, toClassId: toId }), showList);

  /** Danh sách đã cũ (em vừa nghỉ/chuyển lớp ở máy khác): tải lại danh sách, giữ câu báo để người dùng chọn lại. */
  const reloadAfterStale = async (p: PromotionPreview) => {
    setToken(null);
    try {
      const fresh = await preview({ fromClassId: p.from.id, toClassId: p.to.id });
      if (fresh.ok) showList(fresh.data);
    } catch {
      // giữ danh sách cũ; câu báo lỗi đã hiện
    }
  };

  const confirm = (p: PromotionPreview, clientToken: string) =>
    run(() => apply({ fromClassId: p.from.id, toClassId: p.to.id, studentIds: [...picked], clientToken }), (result) => {
      setToken(null);
      setList(null);
      setDone({ result, preview: p });
      router.refresh();
    }, (error) => { if (error === STALE_PROMOTION) void reloadAfterStale(p); });

  const undoDone = (d: Done) => d.result.promotionId && run(() => undo({ promotionId: d.result.promotionId! }), (undone) => {
    setDone({ ...d, undone });
    router.refresh();
  });

  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (done) {
    const { result, preview: p, undone } = done;
    return (
      <div className="card grid gap-3 p-4">
        {undone ? (
          <Notice tone="success" role="status">
            Đã trả {undone.restored} em về {p.from.name} ({p.from.schoolYearName}).{undone.notRestored > 0 && ` ${undone.notRestored} em không trả được vì đã chuyển sang lớp khác.`} Chỗ ngồi cũ không được khôi phục.
          </Notice>
        ) : (
          <Notice tone="success" role="status">
            {result.moved > 0 ? `Đã chuyển ${result.moved} em từ ${p.from.name} (${p.from.schoolYearName}) sang ${p.to.name} (${p.to.schoolYearName}).` : `Các em đã ở ${p.to.name} (${p.to.schoolYearName}), không chuyển thêm.`}
            {result.seatsRemoved > 0 && ` Đã xoá ${result.seatsRemoved} chỗ ngồi ở lớp cũ.`}
          </Notice>
        )}
        {error && <Notice tone="error" role="alert">{error}</Notice>}
        {!undone && result.promotionId && (
          <button type="button" disabled={busy} onClick={() => undoDone(done)} className="btn btn-lg btn-secondary w-full">
            <Undo2 aria-hidden size={20} /> Hoàn tác
          </button>
        )}
        <button type="button" onClick={reset} className="btn btn-lg btn-ghost w-full">Lên lớp lớp khác</button>
      </div>
    );
  }

  if (list) {
    const count = picked.size;
    const all = count === list.students.length;
    return (
      <div className="card grid gap-3 p-4">
        <div>
          <h3 className="text-lg font-semibold">{list.from.name} → {list.to.name}</h3>
          <p className="text-sm text-ink-soft">Năm học {list.from.schoolYearName} → {list.to.schoolYearName}</p>
          <p className="text-sm text-ink-soft">{list.to.gradeName} · Đã chọn <span className="tabular-nums">{count}/{list.students.length}</span> em</p>
        </div>
        {list.students.length === 0 ? (
          <Notice tone="info">Lớp này không còn em nào đang học.</Notice>
        ) : (
          <>
            <button type="button" className="btn btn-sm btn-ghost justify-self-start" onClick={() => setPicked(all ? new Set() : new Set(list.students.map((s) => s.id)))}>
              {all ? "Bỏ chọn tất cả" : "Chọn tất cả"}
            </button>
            <ul aria-label="Các em sẽ lên lớp" className="divide-y divide-border rounded-control border border-border">
              {list.students.map((s) => (
                <li key={s.id}>
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2">
                    <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} className="h-5 w-5 shrink-0 accent-[var(--action)]" />
                    <span className="min-w-0 break-words">{s.saintName && <span className="text-ink-soft">{s.saintName} </span>}{s.fullName}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        {count > MAX && <Notice tone="warning">Mỗi lần chuyển tối đa {MAX} em.</Notice>}
        {error && <Notice tone="error" role="alert">{error}</Notice>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-lg btn-secondary" onClick={reset}>Quay lại</button>
          <button type="button" className="btn btn-lg btn-primary" disabled={count === 0 || count > MAX}
            onClick={() => setToken(crypto.randomUUID())}>Lên lớp {count} em</button>
        </div>
        {token && (
          <Sheet label="Xác nhận lên lớp" onClose={() => setToken(null)}>
            <h2 className="font-display text-lg font-semibold">Chuyển {count} em từ {list.from.name} ({list.from.schoolYearName}) sang {list.to.name} ({list.to.schoolYearName})?</h2>
            <p className="text-ink-soft">{CONSEQUENCES}</p>
            <p className="text-sm text-ink-soft">Từ giờ các em điểm danh ở {list.to.name}; quét thẻ ở buổi của {list.from.name} sẽ báo “Thẻ không dùng được cho lớp này”.</p>
            <p className="text-sm text-ink-soft">{PROMOTION_HISTORY_NOTE}</p>
            {error && <Notice tone="error" role="alert">{error}</Notice>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-lg btn-secondary" onClick={() => setToken(null)}>Huỷ</button>
              <button type="button" className="btn btn-lg btn-primary" disabled={busy} onClick={() => confirm(list, token)}>Xác nhận lên lớp</button>
            </div>
          </Sheet>
        )}
      </div>
    );
  }

  return (
    <div className="card grid gap-4 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-action-tint text-action">
          <ArrowUpRight aria-hidden size={20} />
        </span>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">Cho em lên lớp</h3>
          <p className="mt-0.5 text-sm text-ink-soft">{CONSEQUENCES}</p>
        </div>
      </div>
      <Field label="Lớp hiện tại">
        <select value={fromId} onChange={(e) => { setFromId(e.target.value); setToId(""); }} className="input">
          <option value="">Chọn lớp</option>
          {options.sources.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.gradeName} · {c.schoolYearName} ({c.activeCount} em)</option>)}
        </select>
      </Field>
      <Field label="Lên lớp" hint={canManageAll ? "Chọn lớp cùng năm hoặc năm sau trong bất kỳ khối nào." : options.nextGrade ? `Gồm các lớp trong khối và ${options.nextGrade.name}.` : "Chỉ các lớp trong khối (chưa chọn khối kế tiếp)."}>
        <select value={toId} onChange={(e) => setToId(e.target.value)} disabled={!fromId} className="input">
          <option value="">Chọn lớp đích</option>
          {[...new Set(targets.map((t) => t.gradeName))].map((g) => (
            <optgroup key={g} label={g}>
              {targets.filter((t) => t.gradeName === g).map((t) => <option key={t.id} value={t.id}>{t.name} · {t.schoolYearName}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>
      {error && <Notice tone="error" role="alert">{error}</Notice>}
      <button type="button" disabled={!fromId || !toId || busy} onClick={loadStudents} className="btn btn-lg btn-primary w-full">Xem danh sách em</button>
    </div>
  );
}
