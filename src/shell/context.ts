import { createContext, useContext, useEffect, useLayoutEffect, useRef } from 'react';

export interface Toast { id: number; kind: 'ok' | 'err'; title: string; sub?: string; action?: string; run?: () => void }
export type ToastInput = Omit<Toast, 'id'>;
export interface Task { title: string; note: string; p: number; scan: boolean; color?: string; meta?: string; paused?: boolean }
export type Theme = 'sys' | 'light' | 'dark';
export type DriveId = 'C' | 'D' | 'E';

export interface ShellState {
  /** free GB on C: — shared so a clean on any page shows in the sidebar and overview */
  cFree: number;
  setCFree: (v: number | ((p: number) => number)) => void;
  /** overview's one-tap cache clean: 0 idle, 1 running, 2 done */
  foam: 0 | 1 | 2;
  setFoam: (v: 0 | 1 | 2) => void;
  /** D: free GB (changes after migrations on the map) */
  dFree: number;
  setDFree: (v: number | ((p: number) => number)) => void;
  writing: Partial<Record<DriveId, boolean>>;
  setWriting: (v: Partial<Record<DriveId, boolean>>) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  sbDisk: DriveId;
  setSbDisk: (d: DriveId) => void;
  toasts: Toast[];
  pushToast: (t: ToastInput, ttl?: number) => void;
  dropToast: (id: number) => void;
  task: Task | null;
  startTask: (title: string, note: string, done?: () => void, scan?: boolean) => void;
  setTask: (t: Task | null) => void;
  pal: boolean;
  setPal: (v: boolean) => void;
  /** the space map reports its live suggestion count; null falls back to the overview's */
  suggestN: number | null;
  setSuggestN: (n: number | null) => void;
  scanAt: string;
  setScanAt: (t: string) => void;
  /** pages register what Escape should close when the palette is not open; returns an unregister function */
  registerEscape: (fn: () => void) => () => void;
  runEscape: () => void;
  /** the .app root, so page dialogs can portal over the whole window */
  appEl: HTMLDivElement | null;
  setAppEl: (el: HTMLDivElement | null) => void;
}

export const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const v = useContext(ShellContext);
  if (!v) throw new Error('useShell must be used inside <ShellProvider>');
  return v;
}

/** Register what Escape closes on this page (palette takes precedence). */
export function useEscape(fn: (() => void) | null) {
  const { registerEscape } = useShell();
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  useEffect(() => registerEscape(() => ref.current?.()), [registerEscape]);
}
