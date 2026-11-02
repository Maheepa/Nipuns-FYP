import type { ReactNode } from 'react';
import { create } from 'zustand';

export type Tone = 'info' | 'ok' | 'warn' | 'error';

export interface ConfirmRequest {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone: 'normal' | 'danger';
  /** Optional checklist the operator must tick before confirming. */
  checklist?: string[];
  resolve: (ok: boolean) => void;
}

interface Toast {
  id: number;
  tone: Tone;
  text: string;
}

interface UiState {
  confirm: ConfirmRequest | null;
  toasts: Toast[];
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}

export const useUi = create<UiState>()((set) => ({
  confirm: null,
  toasts: [],
  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
}));

/** Ask the operator to confirm. Resolves false on cancel / Escape. */
export function askConfirm(req: Omit<ConfirmRequest, 'resolve' | 'tone' | 'confirmLabel'> & Partial<Pick<ConfirmRequest, 'tone' | 'confirmLabel'>>): Promise<boolean> {
  return new Promise((resolve) => {
    useUi.getState().confirm?.resolve(false); // never stack dialogs
    useUi.setState({
      confirm: {
        tone: 'normal',
        confirmLabel: 'Confirm',
        ...req,
        resolve: (ok) => {
          useUi.setState({ confirm: null });
          resolve(ok);
        },
      },
    });
  });
}

let toastSeq = 0;
export function toast(text: string, tone: Tone = 'info', ms = 5000): void {
  const id = ++toastSeq;
  useUi.setState((s) => ({ toasts: [...s.toasts, { id, tone, text }].slice(-5) }));
  window.setTimeout(() => useUi.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}
