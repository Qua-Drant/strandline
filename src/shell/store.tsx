import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { C_FREE_0 } from '../data/history';

export interface Toast { id: number; kind: 'ok' | 'err'; title: string; sub?: string; action?: string; run?: () => void }
export type ToastInput = Omit<Toast, 'id'>;
export interface Task { title: string; note: string; p: number; scan: boolean; color?: string; meta?: string; paused?: boolean }
export type Theme = 'sys' | 'light' | 'dark';
export type DriveId = 'C' | 'D' | 'E';

interface ShellState {
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
  /** pages register what Escape should close when the palette is not open */
  escape: React.MutableRefObject<(() => void) | null>;
  /** the .app root, so page dialogs can portal over the whole window */
  appEl: HTMLDivElement | null;
  setAppEl: (el: HTMLDivElement | null) => void;
}

const Ctx = createContext<ShellState | null>(null);

function readTheme(): Theme {
  try { const t = localStorage.getItem('strandline.theme'); if (t === 'dark' || t === 'light' || t === 'sys') return t; } catch { /* ignore */ }
  return 'sys';
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const [cFree, setCFree] = useState(C_FREE_0);
  const [dFree, setDFree] = useState(388.0);
  const [foam, setFoam] = useState<0 | 1 | 2>(0);
  const [writing, setWriting] = useState<Partial<Record<DriveId, boolean>>>({});
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [sbDisk, setSbDisk] = useState<DriveId>('C');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [task, setTask] = useState<Task | null>(null);
  const [pal, setPal] = useState(false);
  const [suggestN, setSuggestN] = useState<number | null>(null);
  const [scanAt, setScanAt] = useState('13:52');
  const [appEl, setAppEl] = useState<HTMLDivElement | null>(null);
  const tid = useRef(1);
  const taskTimer = useRef<number | null>(null);
  const escape = useRef<(() => void) | null>(null);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem('strandline.theme', t); } catch { /* ignore */ }
  }, []);

  const dropToast = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const pushToast = useCallback((t: ToastInput, ttl?: number) => {
    const id = tid.current++;
    setToasts((ts) => ts.concat([{ id, ...t }]).slice(-2));
    if (ttl) window.setTimeout(() => dropToast(id), ttl);
  }, [dropToast]);

  const startTask = useCallback((title: string, note: string, done?: () => void, scan = false) => {
    if (taskTimer.current) window.clearInterval(taskTimer.current);
    let p = 0;
    setTask({ title, note, p: 0, scan });
    taskTimer.current = window.setInterval(() => {
      p += 5;
      if (p >= 100) {
        if (taskTimer.current) window.clearInterval(taskTimer.current);
        taskTimer.current = null;
        setTask(null);
        done?.();
      } else setTask((t) => (t ? { ...t, p } : t));
    }, 90);
  }, []);

  useEffect(() => () => { if (taskTimer.current) window.clearInterval(taskTimer.current); }, []);

  const value = useMemo<ShellState>(() => ({
    cFree, setCFree, dFree, setDFree, foam, setFoam, writing, setWriting, theme, setTheme, sbDisk, setSbDisk,
    toasts, pushToast, dropToast, task, startTask, setTask, pal, setPal, suggestN, setSuggestN, scanAt, setScanAt, escape, appEl, setAppEl,
  }), [cFree, dFree, foam, writing, theme, setTheme, sbDisk, toasts, pushToast, dropToast, task, startTask, pal, suggestN, scanAt, appEl]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShell(): ShellState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useShell must be used inside <ShellProvider>');
  return v;
}

/** Register what Escape closes on this page (palette takes precedence). */
export function useEscape(fn: (() => void) | null) {
  const { escape } = useShell();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    escape.current = () => ref.current?.();
    return () => { escape.current = null; };
  }, [escape]);
}
