// src/hooks/useErrorHandler.ts
import { useToastStore } from "../store/toastStore";

/** Returns helpers to route errors: git errors → toast, others → caller renders ErrorBanner */
export function useErrorHandler() {
  const addToast = useToastStore((s) => s.addToast);

  /** Show a toast for non-critical errors (git operations, etc.) */
  const toastError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    addToast(message, "error");
  };

  const toastInfo = (message: string) => addToast(message, "info");
  const toastWarning = (message: string) => addToast(message, "warning");

  /** Extract error message string (use when the component renders its own ErrorBanner) */
  const extractMessage = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);

  return { toastError, toastInfo, toastWarning, extractMessage };
}
