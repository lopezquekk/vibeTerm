import { create } from "zustand";
import type { ConnStatus } from "../transport/classifyFailure";

interface ConnectionStore {
  status: ConnStatus;
  setStatus: (s: ConnStatus) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  status: "connecting",
  setStatus: (status) => set((s) => (s.status === status ? s : { status })),
}));
