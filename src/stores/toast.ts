import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  tone?: "neutral" | "success" | "danger";
  action?: { label: string; run: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">, ttlMs?: number) => void;
  dismiss: (id: number) => void;
}

let seq = 1;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (t, ttlMs = 5000) => {
    const id = seq++;
    // ponytail: max 3 visible, oldest drops first
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), ttlMs);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = (message: string, opts?: Omit<Toast, "id" | "message">) =>
  useToasts.getState().push({ message, ...opts });
