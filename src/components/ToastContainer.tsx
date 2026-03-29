import { useEffect } from "react";
import { useToastStore, type Toast } from "../store/toastStore";

const COLORS: Record<Toast["type"], string> = {
  info:    "bg-zinc-800 border-zinc-600 text-zinc-100",
  warning: "bg-yellow-900/80 border-yellow-600 text-yellow-100",
  error:   "bg-red-900/80 border-red-700 text-red-100",
};

const ICONS: Record<Toast["type"], string> = {
  info: "ℹ",
  warning: "⚠",
  error: "✕",
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismissToast = useToastStore((s) => s.dismissToast);

  useEffect(() => {
    const timer = setTimeout(() => dismissToast(toast.id), 4000);
    return () => clearTimeout(timer);
  }, [toast.id, dismissToast]);

  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 rounded border text-sm shadow-lg ${COLORS[toast.type]}`}
      role="alert"
    >
      <span className="flex-shrink-0 opacity-70 mt-px">{ICONS[toast.type]}</span>
      <span className="flex-1 min-w-0 break-words">{toast.message}</span>
      <button
        onClick={() => dismissToast(toast.id)}
        className="flex-shrink-0 opacity-50 hover:opacity-100 ml-1"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} />
        </div>
      ))}
    </div>
  );
}
