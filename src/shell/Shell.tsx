import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { win } from '../lib/desktop';
import { soundTap } from '../lib/sound';
import { atmoOf, cx } from '../lib/util';
import { Link } from '../components/Link';
import { navigate } from '../router';
import { NAV, PATHS } from '../routes';
import { AppPortal } from './parts';
import { useShell } from './context';
import { diskService } from '../services/diskService';
import type { DriveInfo } from '../services/types';

function driveView(d: DriveInfo) {
  const lv = atmoOf(d.free, d.total);
  return {
    label: d.id + ': ' + d.name,
    free: d.free.toFixed(1),
    freeShort: (d.free >= 100 ? Math.round(d.free) : d.free.toFixed(1)) + ' GB',
    pct: ((d.total - d.free) / d.total * 100).toFixed(1) + '%',
    tide: ((d.total - d.free30) / d.total * 100).toFixed(1) + '%',
    state: lv === 'hi' ? '空间紧张' : lv === 'mid' ? '空间偏紧' : '空间充足',
    lv,
  };
}

const DISK_VIEWS: [string, string, 'map' | 'suggest' | 'large' | 'dupes'][] = [
  ['空间地图', PATHS.map, 'map'], ['清理建议', PATHS.suggest, 'suggest'], ['大文件', PATHS.large, 'large'], ['重复文件', PATHS.dupes, 'dupes'],
];

function Sidebar({ path }: { path: string }) {
  const { drives, writing, sbDisk, setSbDisk, task, setPal, suggestN, scanAt, readOnly, sys } = useShell();
  const views = drives.map(driveView);
  const hi = views.filter((v) => v.lv === 'hi').length, mid = views.filter((v) => v.lv === 'mid').length;
  const sum = views.length + ' 块磁盘 · ' + (hi ? hi + ' 块空间紧张' : mid ? mid + ' 块空间偏紧' : '空间都充足');
  const suggestCount = suggestN !== null ? String(suggestN) : '';

  return (
    <nav aria-label="主导航" className="side sb">
      <button type="button" className="sb-search" onClick={() => setPal(true)}>
        <Icon name="search" size={14} /><span>搜索或执行命令</span><span className="kbd sb-kbd">Ctrl K</span>
      </button>
      <div className="sb-group">
        <Link className="sb-home" to={PATHS.overview} current={path === PATHS.overview}>
          <span className="sb-rt"><Icon name="home" size={16} /><span className="sb-hn">概览</span></span>
          <span className={cx('sb-hs', hi ? 'is-hi' : mid > 0 && 'is-mid')}>{sum}</span>
        </Link>
      </div>
      <div className="sec-label sb-sec">磁盘</div>
      <div className="sb-disks">
        {drives.map((d, i) => {
          const v = views[i], cur = sbDisk === d.id;
          return (
            <section key={d.id} className={cx('sb-disk', cur && 'is-cur')} aria-label={v.label}>
              <button type="button" className="sb-dh" aria-expanded={cur} aria-label={`${v.label}，${v.free} GB 可用，共 ${Math.round(d.total)} GB，${v.state}`} onClick={() => setSbDisk(d.id)}>
                <span className="sb-rt">
                  <Icon name="disk" size={15} /><span className="sb-dn">{v.label}</span>
                  {writing[d.id] && <span className="wdot" title="正在写入" />}
                  <span className="sb-tag"><span className={'sb-st is-' + v.lv}>{v.state}</span><span className="sb-df mono">{v.freeShort}</span></span>
                </span>
                <span className={'sb-lv is-' + v.lv} aria-hidden="true">
                  <span className="sb-lv-u" style={{ inlineSize: v.pct }} /><span className="sb-lv-t" style={{ left: v.tide }} />
                </span>
                <span className="sb-fold"><span><span className="sb-num"><span><b className="mono">{v.free}</b> GB 可用</span><span className="mono">/ {Math.round(d.total)}</span></span></span></span>
              </button>
              <div className="sb-fold"><div>
                <div className="sb-views" role="group" aria-label={v.label + ' 的视图'}>
                  {DISK_VIEWS.map(([label, to, icon]) => (
                    <Link key={to} className="nav-item" to={to} current={cur && path === to}>
                      <Icon name={icon} size={15} /><span>{label}</span>
                      {icon === 'suggest' && d.id === sys.id && <span className="count mono">{suggestCount}</span>}
                    </Link>
                  ))}
                </div>
              </div></div>
            </section>
          );
        })}
      </div>
      <div className="sec-label sb-sec">规则与记录</div>
      <div className="sb-group sb-log">
        <Link className="nav-item" to={PATHS.rules} current={path === PATHS.rules}><Icon name="rules" size={16} /><span>整理规则</span></Link>
        <Link className="nav-item" to={PATHS.activity} current={path === PATHS.activity}><Icon name="activity" size={16} /><span>活动</span></Link>
      </div>
      <div style={{ flex: '1 1 auto' }} />
      <div className={cx('slot', task && 'open')} aria-live="polite"><div>
        <div className={cx('task', task?.paused && 'is-paused')}>
          <div className="task-top"><span className="ellipsis">{task?.title ?? ''}</span><span className="mono" style={{ color: task?.color ?? 'var(--ink-2)' }}>{task ? task.meta ?? Math.round(task.p) + '%' : ''}</span></div>
          <span className="bar" aria-hidden="true"><span style={{ inlineSize: task ? task.p + '%' : '0%' }} /></span>
          <span className="muted ellipsis" style={{ fontSize: '0.6875rem' }}>{task?.note ?? ''}</span>
        </div>
      </div></div>
      <div className="sb-foot">
        <Link className="nav-item" to={PATHS.settings} current={path === PATHS.settings}><Icon name="settings" size={16} /><span>设置</span></Link>
        <span className="sb-scan mono" title="上次扫描">{(readOnly ? '只读 · ' : '') + (task?.scan ? '正在扫描…' : scanAt + ' 已扫描')}</span>
      </div>
    </nav>
  );
}

/** Ctrl K palette: jump to a page. Pages may pass extra commands (the map does). */
export interface PaletteCommand { label: string; meta?: string; run: () => void }
function Palette({ commands }: { commands?: PaletteCommand[] }) {
  const { setPal } = useShell();
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const t = q.trim();
  const nav = NAV.filter(([n]) => !t || n.includes(t));
  const cmds = (commands ?? []).filter((c) => !t || c.label.includes(t));
  const go = (to: string) => { setPal(false); navigate(to); };
  return (
    <AppPortal>
      <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) setPal(false); }}>
        <section className="pal" role="dialog" aria-modal="true" aria-label="命令面板">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--line)' }}>
            <Icon name="searchLg" size={16} />
            <label htmlFor="pq" className="vh">搜索页面</label>
            <input ref={input} id="pq" type="text" placeholder={commands?.length ? '搜索命令或页面…' : '前往页面…'} value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (cmds[0]) { setPal(false); cmds[0].run(); } else if (nav[0]) go(nav[0][1]); } }}
              style={{ flex: '1 1 auto', border: 0, outline: 0, background: 'transparent', font: 'inherit', fontSize: '0.9375rem', color: 'var(--ink)' }} />
            <button type="button" className="kbd" style={{ cursor: 'pointer' }} aria-label="关闭" onClick={() => setPal(false)}>Esc</button>
          </div>
          <div className="sbw" style={{ ['--sbh' as string]: '40px' }}>
            <div className="thin sbs" style={{ padding: '0.375rem 0', maxBlockSize: '22rem' }}>
              {cmds.length > 0 && <>
                <div className="sec-label" style={{ padding: '0.375rem 1rem' }}>命令</div>
                {cmds.map((c) => (
                  <button key={c.label} type="button" className="pal-item" onClick={() => { setPal(false); c.run(); }}>
                    <span style={{ flex: '1 1 auto' }}>{c.label}</span><span className="mono muted" style={{ fontSize: '0.75rem' }}>{c.meta ?? '命令'}</span>
                  </button>
                ))}
              </>}
              <div className="sec-label" style={{ padding: '0.375rem 1rem' }}>前往</div>
              {nav.map(([label, to]) => (
                <Link key={to} className="pal-item" to={to} onClick={() => setPal(false)} style={{ textDecoration: 'none' }}>
                  <span style={{ flex: '1 1 auto' }}>{label}</span><span className="mono muted" style={{ fontSize: '0.75rem' }}>页面</span>
                </Link>
              ))}
              {!nav.length && !cmds.length && <div className="muted" style={{ padding: '1rem', textAlign: 'center' }}>没有找到「{t}」</div>}
            </div>
            <i className="sbt" aria-hidden="true" />
          </div>
          <div className="muted" style={{ padding: '0.5rem 1rem', borderTop: '1px solid var(--line)', fontSize: '0.6875rem' }}>在「空间地图」里，Ctrl K 还能直接执行清理和迁移</div>
        </section>
      </div>
    </AppPortal>
  );
}

export function Toasts({ bottom = '4.5rem' }: { bottom?: string }) {
  const { toasts, dropToast } = useShell();
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="region" aria-label="通知" style={{ insetBlockEnd: bottom }}>
      {toasts.slice(-2).reverse().map((t) => (
        <div key={t.id} className="toast" role="status">
          {t.kind === 'err' ? <span className="t-ico t-err">!</span> : <span className="t-ico t-ok"><Icon name="check" size={10} /></span>}
          <div style={{ display: 'grid', gap: '0.125rem', minInlineSize: 0 }}>
            <span style={{ fontWeight: 500 }}>{t.title}</span>
            {t.sub && <span className="muted" style={{ fontSize: '0.75rem' }}>{t.sub}</span>}
          </div>
          <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
            {t.action && <button type="button" className="btn btn-sm" onClick={() => { t.run?.(); dropToast(t.id); }}>{t.action}</button>}
            <button type="button" className="btn btn-ghost btn-sm" aria-label="关闭通知" onClick={() => dropToast(t.id)} style={{ padding: '0.25rem' }}><Icon name="close" size={12} /></button>
          </span>
        </div>
      ))}
    </div>
  );
}

/** First desktop launch: say plainly what is read and what may be written, and let the user choose. */
function SafetyNotice() {
  const { ackSafety, refreshDrives } = useShell();
  const [busy, setBusy] = useState(false);
  if (ackSafety || diskService.mode === 'mock') return null;
  const choose = async (readOnly: boolean) => {
    setBusy(true);
    await diskService.saveSettings({ readOnly, ackSafety: true });
    await refreshDrives();
  };
  return (
    <AppPortal>
      <div className="modal">
        <section className="dlg" role="dialog" aria-modal="true" aria-labelledby="safety-t">
          <h2 id="safety-t" style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Strandline 怎样对待你的文件</h2>
          <ul style={{ margin: 0, paddingInlineStart: '1.1rem', display: 'grid', gap: '0.5rem', lineHeight: 1.55 }}>
            <li><b>扫描只读。</b>只读取文件夹结构、名称、大小和时间，不读文件内容；不跟随链接，跳过没有权限的文件夹，不会触发 OneDrive 等云端文件下载。</li>
            <li><b>清理默认只移入回收站。</b>Windows 系统目录、程序目录和用户根文件夹一律受保护；回收站放不下的项目会被拒绝，而不是直接删除。唯一的不可逆操作是「清空回收站」，会再确认一次。</li>
            <li><b>迁移先复制并逐个文件校验</b>，确认无误后才在原处建立链接，旧文件夹进回收站。</li>
          </ul>
          <p className="muted small" style={{ margin: 0 }}>可以先用只读模式看看扫描结果，之后随时在 设置 › 清理与安全 里改。</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button type="button" className="btn" disabled={busy} onClick={() => void choose(false)}>允许清理（只进回收站）</button>
            <button type="button" className="btn btn-primary" autoFocus disabled={busy} onClick={() => void choose(true)}>先只读看看</button>
          </div>
        </section>
      </div>
    </AppPortal>
  );
}

/** Window frame: title bar, sidebar, page area. Pages render their header + content as children. */
/** `palette` replaces the default page palette (the space map has its own, with commands). */
export function Shell({ path, children, commands, palette }: { path: string; children: ReactNode; commands?: PaletteCommand[]; palette?: ReactNode }) {
  const { cFree, sys, theme, pal, setPal, runEscape, setAppEl } = useShell();
  const atmo = atmoOf(cFree, sys.total);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = (e.key || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); setPal(!pal); }
      else if (k === 'escape') { if (pal) setPal(false); else runEscape(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pal, setPal, runEscape]);

  return (
    <div ref={setAppEl} className="app" onPointerDown={soundTap}
      style={{ colorScheme: theme === 'sys' ? 'light dark' : theme, position: 'relative', display: 'flex', flexDirection: 'column', inlineSize: '100%', blockSize: '100vh', overflow: 'clip' }}>
      <svg className="noise" aria-hidden="true" focusable="false">
        <filter id="sl-noise" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".82" numOctaves={3} seed={11} stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 .36 0 0 0 0 .32 0 0 0 0 .26 0 0 0 1.4 -.2" />
        </filter>
        <rect width="100%" height="100%" filter="url(#sl-noise)" />
      </svg>
      <div className={'atmo t-' + atmo} aria-hidden="true"><i className="a-hi" /><i className="a-mid" /><i className="a-lo" /></div>
      <header className="tbar" data-tauri-drag-region onDoubleClick={(e) => { if (e.target === e.currentTarget) win.toggleMaximize(); }}>
        <Icon name="logo" size={18} />
        <span className="brand" data-tauri-drag-region><span className="brand-n">Strandline</span><span className="brand-t">拾滩</span></span>
        <span style={{ flex: '1 1 auto' }} data-tauri-drag-region />
        <button type="button" className="cap" aria-label="最小化" onClick={win.minimize}><Icon name="winMin" size={10} /></button>
        <button type="button" className="cap" aria-label="最大化" onClick={win.toggleMaximize}><Icon name="winMax" size={10} /></button>
        <button type="button" className="cap cap-close" aria-label="关闭" onClick={win.close}><Icon name="winClose" size={10} /></button>
      </header>
      <div style={{ display: 'flex', flex: '1 1 auto', minBlockSize: 0, flexWrap: 'wrap' }}>
        <Sidebar path={path} />
        <main style={{ flex: '999 1 36rem', minInlineSize: 0, display: 'flex', flexDirection: 'column', background: 'transparent', position: 'relative', blockSize: '100%' }}>
          {children}
        </main>
      </div>
      {pal && (palette ?? <Palette commands={commands} />)}
      <SafetyNotice />
    </div>
  );
}
