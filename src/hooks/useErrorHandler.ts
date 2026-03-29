// src/hooks/useErrorHandler.ts
import { useToastStore } from "../store/toastStore";

/** Returns helpers to route errors: git errors → toast, others → caller renders ErrorBanner */
export function useErrorHandler() {
  const addToast = useToastStore((s) => s.addToast);

  /** Extract error message string (use when the component renders its own ErrorBanner) */
  const extractMessage = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);

  /** Show a toast for non-critical errors (git operations, etc.) */
  const toastError = (err: unknown) => {
    addToast(extractMessage(err), "error");
  };

  const toastInfo = (message: string) => addToast(message, "info");
  const toastWarning = (message: string) => addToast(message, "warning");

  return { toastError, toastInfo, toastWarning, extractMessage };
}
