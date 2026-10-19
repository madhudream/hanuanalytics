import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { I } from "./icons";

export function Button({ variant = "default", size, className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "danger" | "ghost"; size?: "sm" }) {
  const v = variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : variant === "ghost" ? "btn-ghost" : "";
  return <button type="button" {...p} className={`btn ${v} ${size === "sm" ? "btn-sm" : ""} ${className}`} />;
}

export function Input({ className = "", ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={`input ${className}`} />;
}
export function Textarea({ className = "", ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={`textarea ${className}`} />;
}
export function Select({ className = "", ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={`select ${className}`} />;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div id={id}>{children}</div>
      {hint && <div className="mt-1.5 text-[12px] text-t3">{hint}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="toggle" onClick={() => onChange(!checked)} />
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-t3 border-t-transparent ${className}`} aria-label="loading" />;
}

export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="mb-1 text-t3">{icon}</div>}
      <div className="text-[15px] font-semibold text-t1">{title}</div>
      {body && <div className="max-w-md text-[13px] text-t2">{body}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-critical/30 bg-critical/5 px-3 py-2 text-[13px]">
      <span className="text-t1">{error.message}</span>
      {retry && <Button size="sm" onClick={retry}>Retry</Button>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, size }: { tabs: { value: T; label: string }[]; value: T; onChange: (v: T) => void; size?: "sm" }) {
  return (
    <div role="tablist" className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} className={`tab ${size === "sm" ? "!h-[26px] !px-2 !text-[12px]" : ""}`} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, width = "max-w-2xl" }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", h);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[6vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal className={`card w-full ${width} max-h-[88vh] overflow-hidden flex flex-col`}>
        <div className="flex items-center justify-between border-b hairline px-5 py-3">
          <div className="text-[15px] font-semibold">{title}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><I.close /></button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function CopyButton({ text, label = "Copy", size = "sm" }: { text: string; label?: string; size?: "sm" }) {
  const [ok, setOk] = useState(false);
  const t = useRef<number>(0);
  return (
    <Button
      size={size}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          window.clearTimeout(t.current);
          t.current = window.setTimeout(() => setOk(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {ok ? <I.check width={14} height={14} /> : <I.copy width={14} height={14} />}
      {ok ? "Copied" : label}
    </Button>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-t1">{title}</h1>
        {subtitle && <div className="mt-0.5 text-[13px] text-t2">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "", pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex min-h-[46px] items-center justify-between gap-2 border-b hairline px-4 py-2">
          <div className="text-[13.5px] font-semibold text-t1">{title}</div>
          <div className="flex items-center gap-1">{actions}</div>
        </div>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Dropdown({ button, children, align = "left" }: { button: ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h);
    window.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      window.removeEventListener("keydown", k);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{button}</div>
      {open && (
        <div className={`card absolute z-40 mt-1.5 min-w-[220px] p-1.5 ${align === "right" ? "right-0" : "left-0"}`}>{children(() => setOpen(false))}</div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, children, selected, danger }: { onClick: () => void; children: ReactNode; selected?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-s2 ${danger ? "text-critical" : "text-t1"}`}
    >
      <span className="truncate-1">{children}</span>
      {selected && <I.check width={16} height={16} className="flex-none text-accent" strokeWidth={2.5} />}
    </button>
  );
}

export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11.5px] font-medium uppercase tracking-wide text-t3">{label}</div>
      <div className="num mt-0.5 text-[14px] font-medium text-t1">{children}</div>
    </div>
  );
}

export function Pagination({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (o: number) => void }) {
  if (total <= limit) return null;
  return (
    <div className="flex items-center justify-between border-t hairline px-4 py-2 text-[12.5px] text-t2">
      <span>
        {offset + 1}–{Math.min(total, offset + limit)} of {total}
      </span>
      <div className="flex gap-1">
        <Button size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</Button>
        <Button size="sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>Next</Button>
      </div>
    </div>
  );
}
