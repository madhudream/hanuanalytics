import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type Kind = "info" | "success" | "error";
interface Toast { id: number; kind: Kind; text: string }
interface Ctx { toast: (text: string, kind?: Kind) => void }

const ToastCtx = createContext<Ctx>({ toast: () => {} });
let seq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((text: string, kind: Kind = "info") => {
    const id = seq++;
    setItems((xs) => [...xs, { id, kind, text }]);
    setTimeout(() => setItems((xs) => xs.filter((t) => t.id !== id)), kind === "error" ? 6000 : 3200);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="card pointer-events-auto flex items-start gap-2 px-3 py-2.5 text-[13px] shadow-lg">
            <span className={`mt-[7px] h-2 w-2 flex-none rounded-full ${t.kind === "error" ? "bg-critical" : t.kind === "success" ? "bg-good" : "bg-accent"}`} />
            <span className="text-t1">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
