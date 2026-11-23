import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { C_FREE_0 } from '../data/history';
import { ShellContext, type DriveId, type ShellState, type Task, type Theme, type Toast, type ToastInput } from './context';

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

  const registerEscape = useCallback((fn: () => void) => {
    escape.current = fn;
    return () => { if (escape.current === fn) escape.current = null; };
  }, []);
  const runEscape = useCallback(() => escape.current?.(), []);

  useEffect(() => () => { if (taskTimer.current) window.clearInterval(taskTimer.current); }, []);

  const value = useMemo<ShellState>(() => ({
    cFree, setCFree, dFree, setDFree, foam, setFoam, writing, setWriting, theme, setTheme, sbDisk, setSbDisk,
    toasts, pushToast, dropToast, task, startTask, setTask, pal, setPal, suggestN, setSuggestN, scanAt, setScanAt,
    registerEscape, runEscape, appEl, setAppEl,
  }), [cFree, dFree, foam, writing, theme, setTheme, sbDisk, toasts, pushToast, dropToast, task, startTask, pal, suggestN, scanAt, registerEscape, runEscape, appEl]);

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
