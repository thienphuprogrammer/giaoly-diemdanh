/** Nhãn hiển thị phía trên ô nhập (không dùng placeholder thay nhãn). */
export function Field({ label, hint, required, children, className = "" }: {
  label: string; hint?: React.ReactNode; required?: boolean; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`grid gap-1.5 ${className}`}>
      <label className="grid gap-1.5">
        <span className="label">
          {label}
          {required && <span aria-hidden className="text-warn-alert"> *</span>}
        </span>
        {children}
      </label>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
