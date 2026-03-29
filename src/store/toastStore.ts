// src/store/toastStore.ts
import { create } from "zustand";

export type ToastType = "info" | "warning" | "error";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (message: string, type: ToastType) => void;
  dismissToast: (id: string) => void;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (message, type) =>
    set((s) => {
      const toast: Toast = { id: makeId(), message, type };
      // Keep at most 3 visible at once; oldest drops off
      const toasts = [...s.toasts, toast].slice(-3);
      return { toasts };
    }),
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
