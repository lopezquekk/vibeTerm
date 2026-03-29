// src/components/ErrorBanner.tsx
interface ErrorBannerProps {
  message: string;
  type: "error" | "warning";
  onDismiss?: () => void;
}

const STYLES = {
  error:   "bg-red-900/40 border-red-700/60 text-red-200",
  warning: "bg-yellow-900/40 border-yellow-700/60 text-yellow-200",
};

const ICONS = {
  error: "✕",
  warning: "⚠",
};

export function ErrorBanner({ message, type, onDismiss }: ErrorBannerProps) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 border-b text-xs ${STYLES[type]}`}
      role="alert"
    >
      <span className="flex-shrink-0 opacity-70">{ICONS[type]}</span>
      <span className="flex-1 min-w-0 break-words">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="flex-shrink-0 opacity-50 hover:opacity-100 ml-1 p-1"
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
  );
}
