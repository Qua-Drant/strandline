import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { diskService } from '../services/diskService';
import type { DriveInfo } from '../services/types';
import { ShellContext, type DriveId, type ShellState, type Task, type Theme, type Toast, type ToastInput } from './context';

function readTheme(): Theme {
  try { const t = localStorage.getItem('strandline.theme'); if (t === 'dark' || t === 'light' || t === 'sys') return t; } catch { /* ignore */ }
  return 'sys';
}

/** Drives plus the system drive's open suggestion count (sidebar badge). */
async function readDrives() {
  const ds = await diskService.listDrives();
  const sys = ds.find((d) => d.id === 'C') ?? ds[0];
  const n = sys ? (await diskService.getSuggestions(sys.id)).filter((r) => !r.done).length : 0;
  const st = await diskService.getSettings();
  return { ds, n, readOnly: st.readOnly, ackSafety: st.ackSafety, closeMode: st.close, low: st.low };
}

type Boot = Awaited<ReturnType<typeof readDrives>>;

/** Reads the drives once, then mounts the shell so nothing renders with placeholder sizes. */
export function ShellProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Boot | null>(null);
  useEffect(() => {
    let live = true;
    void readDrives().then((b) => { if (live) setBoot(b); });
    return () => { live = false; };
  }, []);
  return boot ? <ShellCore boot={boot}>{children}</ShellCore> : null;
}

function ShellCore({ boot, children }: { boot: Boot; children: ReactNode }) {
  const [drives, setDrives] = useState<DriveInfo[]>(boot.ds);
  const [foam, setFoam] = useState<0 | 1 | 2>(0);
  const [writing, setWriting] = useState<Partial<Record<DriveId, boolean>>>({});
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [sbDisk, setSbDisk] = useState<DriveId>('C');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [task, setTask] = useState<Task | null>(null);
  const [pal, setPal] = useState(false);
  const [suggestN, setSuggestN] = useState<number | null>(boot.n);
  const [safety, setSafety] = useState({ readOnly: boot.readOnly, ackSafety: boot.ackSafety, closeMode: boot.closeMode });
  const [scanAt, setScanAt] = useState('13:52');
  const [appEl, setAppEl] = useState<HTMLDivElement | null>(null);
  const tid = useRef(1);
  const taskTimer = useRef<number | null>(null);
  const escape = useRef<(() => void) | null>(null);
  const lowWarned = useRef(false);

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

  const refreshDrives = useCallback(() => readDrives().then(({ ds, n, readOnly, ackSafety, closeMode }) => { setDrives(ds); setSuggestN(n); setSafety({ readOnly, ackSafety, closeMode }); }), []);

  useEffect(() => {
    if (lowWarned.current || diskService.mode === 'mock' || !boot.low || !boot.ackSafety) return;
    const sys = boot.ds.find((d) => d.id === 'C') ?? boot.ds[0];
    if (sys && sys.free < 20) {
      lowWarned.current = true;
      pushToast({ kind: 'err', title: sys.id + ': 剩余空间不足 20 GB', sub: '当前仅剩 ' + sys.free.toFixed(1) + ' GB 可用，建议扫描并查看清理建议' }, 9000);
    }
  }, [boot, pushToast]);

  useEffect(() => () => { if (taskTimer.current) window.clearInterval(taskTimer.current); }, []);

  const value = useMemo<ShellState>(() => {
    const sys = drives.find((d) => d.id === 'C') ?? drives[0];
    const cur = drives.find((d) => d.id === sbDisk) ?? sys;
    return {
    drives, sys, cur, readOnly: safety.readOnly, ackSafety: safety.ackSafety, closeMode: safety.closeMode, cFree: sys.free, refreshDrives, foam, setFoam, writing, setWriting, theme, setTheme, sbDisk, setSbDisk,
    toasts, pushToast, dropToast, task, startTask, setTask, pal, setPal, suggestN, setSuggestN, scanAt, setScanAt,
    registerEscape, runEscape, appEl, setAppEl,
  }; }, [drives, safety, refreshDrives, foam, writing, theme, setTheme, sbDisk, toasts, pushToast, dropToast, task, startTask, pal, suggestN, scanAt, registerEscape, runEscape, appEl]);

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
