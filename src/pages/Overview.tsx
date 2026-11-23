import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { freed90 } from '../lib/history';
import { diskService } from '../services/diskService';
import type { EventKind } from '../services/types';
import { useData } from '../services/useData';
import { skippedToast } from '../services/receipts';
import { sound } from '../lib/sound';
import { ATMO_TEXT, atmoOf, cx, pct } from '../lib/util';
import { Link } from '../components/Link';
import { PATHS } from '../routes';
import { PageHeader, Scroll } from '../shell/parts';
import { useShell } from '../shell/context';

const KIND_UI: Record<EventKind, [string, string]> = { scan: ['扫描', 'var(--line-2)'], rule: ['整理', 'var(--l2)'], clean: ['清理', 'var(--l1)'], move: ['迁移', 'var(--l4)'] };
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const greeting = () => { const h = new Date().getHours(); return h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'; };

/** Smiling beachcomber with a cup of tea; cheers up after the one-tap clean. */
function HelloArt() {
  return (
    <svg className="hello-art" viewBox="0 0 240 190" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <g className="ha-all">
        <path className="ha-fill" d="M36 190 C 36 128 74 95 120 95 C 166 95 204 128 204 190" />
        <path className="ha-arm ha-arm-l" d="M50 168 C 56 164 64 160 72 158 C 84 155 94 153 104 154" />
        <path className="ha-arm ha-arm-r" d="M190 168 C 184 164 176 160 168 158 C 156 155 146 153 138 154" />
        <g className="ha-head">
          <circle className="ha-fill" cx="120" cy="68" r="29" />
          <path className="ha-hat" d="M89 56 C 89 28 151 28 151 56 Z" /><path d="M78 57 C 102 49 138 49 162 57" strokeWidth="3.2" />
          <g className="ha-eyes"><ellipse cx="110" cy="72" rx="2.4" ry="3" fill="currentColor" stroke="none" /><ellipse cx="130" cy="72" rx="2.4" ry="3" fill="currentColor" stroke="none" /></g>
          <g className="ha-eyesc"><path d="M105.5 73 q 4.5 3.5 9 0" /><path d="M125.5 73 q 4.5 3.5 9 0" /></g>
          <path className="ha-mouth" d="M115 83 q 5 4.5 10 0" /><path className="ha-grin" d="M113 82 q 7 9 14 0 z" fill="currentColor" />
          <circle className="ha-blush" cx="101" cy="80" r="4.2" stroke="none" /><circle className="ha-blush" cx="139" cy="80" r="4.2" stroke="none" />
        </g>
        <g className="ha-cup">
          <g className="ha-stm"><path className="ha-steam" d="M114 122 c -4 -5 4 -9 0 -14" /><path className="ha-steam s2" d="M126 120 c -4 -5 4 -9 0 -14" /></g>
          <path className="ha-fill" d="M106 132 h 28 v 20 a 8 8 0 0 1 -8 8 h -12 a 8 8 0 0 1 -8 -8 z" /><path d="M134 137 c 9 0 9 12 0 12" />
          <path className="ha-tide" d="M110 140 q 3.5 -3 7 0 t 7 0 t 6 0" strokeWidth="1.6" />
          <path className="ha-fill" d="M100 146 c -2 6 2 12 8 12 c 2 0 3 -2 3 -4 l -1 -9 c -1 -3 -8 -4 -10 1 z" />
          <path className="ha-fill" d="M140 146 c 2 6 -2 12 -8 12 c -2 0 -3 -2 -3 -4 l 1 -9 c 1 -3 8 -4 10 1 z" />
        </g>
      </g>
      <g className="ha-spark"><path d="M56 70 l0 -12 M50 64 l12 0" /><path d="M188 40 l0 -10 M183 35 l10 0" /><path d="M200 92 l0 -8 M196 88 l8 0" /></g>
    </svg>
  );
}

export function Overview() {
  const { cFree: cf, sys, drives, foam, setFoam, setTask, task, pushToast, refreshDrives } = useShell();
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);
  const key = sys.id + ':' + cf.toFixed(2);
  const [rows, reloadRows] = useData(() => diskService.getSuggestions(sys.id), key);
  const [model] = useData(() => diskService.getMapModel(sys.id), key);
  const [ov] = useData(() => diskService.getOverview(sys.id), key);
  const [hist] = useData(() => diskService.getHistory(sys.id), key);
  const [settings] = useData(() => diskService.getSettings());

  const live = (rows ?? []).filter((r) => !r.done);
  const sumL = (lv: string) => live.filter((r) => r.level === lv).reduce((a, r) => a + r.gain, 0);
  const foamRows = (rows ?? []).filter((r) => ov?.foamIds.includes(r.id));
  const foamGb = foamRows.filter((r) => !r.done).reduce((a, r) => a + r.gain, 0);
  const foamFreed = foamRows.filter((r) => r.done).reduce((a, r) => a + r.gain, 0);
  const fdone = foam === 2 || (foamRows.length > 0 && foamRows.every((r) => r.done));
  const atmo = atmoOf(cf, sys.total);
  const atmoText = ATMO_TEXT[atmo];
  const cfi = Math.floor(cf + 1e-6), cfd = Math.round((cf - cfi) * 10) % 10;
  const [today] = useState(() => new Date());

  const foamGo = async () => {
    if (foam || !ov) return;
    setFoam(1);
    sound.wash(false, 560);
    const rc = await diskService.clean(sys.id, ov.foamIds.filter((id) => live.some((r) => r.id === id)));
    timers.current.push(window.setTimeout(() => { void refreshDrives(); void reloadRows(); }, 240));
    timers.current.push(window.setTimeout(() => setFoam(2), 600));
    skippedToast(rc, pushToast);
  };
  const rescan = async () => {
    const t0 = Date.now();
    await diskService.scan(sys.id, (p) => setTask({ title: '扫描 ' + sys.id + ':', note: (p.phase === 'index' ? '索引文件系统' : '识别应用缓存') + '…', p: p.p, scan: true }));
    setTask(null); await refreshDrives();
    pushToast({ kind: 'ok', title: '扫描完成', sub: drives.map((d) => d.id + ': ' + Math.round(d.total - d.free) + ' GB').join(' · ') + ' 已用 · ' + Math.round((Date.now() - t0) / 1000) + ' 秒' }, 5000);
  };

  const k1 = sumL('L1'), k2 = sumL('L2'), k3 = sumL('L3');
  const cleanable = (k1 + k2 + k3).toFixed(1);
  const moves = model?.moves ?? [];
  const mvGb = moves.reduce((a, m) => a + m.cells.reduce((x, c) => x + (model!.leaves.find((l) => l.id === c)?.gb ?? 0), 0), 0);
  const others = drives.filter((d) => d.id !== sys.id).map((d) => d.id + ':').join(' 或 ');
  const kinds: [string, string, number, string, string][] = [
    ['L1', '可重建', live.filter((r) => r.level === 'L1').length, '删了会自动重建', k1.toFixed(1)],
    ['L2', '需审阅', live.filter((r) => r.level === 'L2').length, '看一眼再决定，有的会改系统设置', k2.toFixed(1)],
    ['L3', '不可恢复', live.filter((r) => r.level === 'L3').length, '回收站，清空后找不回', k3.toFixed(1)],
    ['mv', '可迁移', moves.length, others ? '搬到 ' + others + '，' + sys.id + ': 才真正宽裕' : '搬到其他磁盘', mvGb.toFixed(1)],
  ];
  const acts = (ov?.recent ?? []).map(([time, kind, title, amount]) => [time, KIND_UI[kind][0], KIND_UI[kind][1], title, amount] as const);
  const growers = ov?.growers ?? [];
  const growMax = Math.max(0.1, ...growers.map((g) => g.gb));
  const freedTotal = hist ? freed90(hist) : 0;
  const lowText = settings?.low ? '已开启' : '未开启';

  return (
    <>
      <PageHeader crumb={['概览']}>
        <button type="button" className="btn btn-sm" onClick={() => void rescan()} disabled={!!task}><Icon name="rescan" size={14} />重新扫描全部磁盘</button>
      </PageHeader>
      <Scroll className="pg ov2" style={{ paddingTop: '0.75rem' }}>
        <div className="ov-fold">
          <header className={cx('hello', fdone && 'is-happy', foam === 1 && 'is-busy')}>
            <div className="hello-t">
              <p className="eyebrow">{today.getMonth() + 1} 月 {today.getDate()} 日 · 星期{WEEK[today.getDay()]}</p>
              <h1 className="hello-h">{fdone ? greeting() + '，' + sys.id + ' 盘腾出了 ' + foamFreed.toFixed(1) + ' GB' : greeting() + '，' + sys.id + (atmo === 'lo' ? ' 盘空间充足' : ' 盘快满了')}</h1>
              <p className="hello-s">{model && !model.scannedAt
                ? '还没有扫描过 ' + sys.id + ': 盘。点右上角「重新扫描全部磁盘」开始，只读取文件夹结构和大小，不读文件内容。'
                : fdone
                ? '清掉 ' + foamRows.length + ' 项会自动重建的缓存后，' + sys.id + ' 盘回到 ' + cf.toFixed(1) + ' GB 可用。剩下的需要你看一眼再决定。'
                : sys.id + ' 盘只剩 ' + cf.toFixed(1) + ' GB 可用（' + (cf / sys.total * 100).toFixed(1) + '%）。可重建的 ' + k1.toFixed(1) + ' GB 里，有 ' + foamGb.toFixed(1) + ' GB 缓存可以放心一键清理。'}</p>
            </div>
            <HelloArt />
          </header>
          <div className="tiles">
            <Link className={'tile t-state s-' + atmo} to={PATHS.map} aria-label={`${sys.id} 盘可用 ${cf.toFixed(1)} GB，${atmoText}，打开空间地图`}>
              <div className="tl-h"><span className="tl-ic"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 6.5c1.6 0 1.6-1.3 3.2-1.3S6.8 6.5 8.4 6.5s1.6-1.3 3.2-1.3 1.6 1.3 3.2 1.3 1.6-1.3 1.6-1.3" /><path d="M2 11c1.6 0 1.6-1.3 3.2-1.3S6.8 11 8.4 11s1.6-1.3 3.2-1.3S13.2 11 14.8 11 16.4 9.7 16.4 9.7" opacity=".6" /><path d="M2 15h14.4" opacity=".35" /></svg></span><span className="tl-k">{sys.id} 盘可用</span></div>
              <div className="tl-n"><span className="mono num anim" style={{ ['--i' as string]: cfi, ['--dd' as string]: cfd }} /><span className="tl-u">GB</span></div>
              <div className="tl-c">{atmoText} · 30 天{sys.free30 - cf >= 0 ? '少了 ' + (sys.free30 - cf).toFixed(1) : '多了 ' + (cf - sys.free30).toFixed(1)} GB</div>
              {foam === 1 && <div className="foam-wave" aria-hidden="true" />}
            </Link>
            <Link className="tile t-sea" to={PATHS.suggest} aria-label={`可以腾出 ${cleanable} GB，查看清理建议`}>
              <div className="tl-h"><span className="tl-ic"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="3" width="13" height="12" rx="2.5" /><path d="M6 9.2l2 2 4-4.4" /></svg></span><span className="tl-k">可以腾出</span></div>
              <div className="tl-n"><span className="mono">{cleanable}</span><span className="tl-u">GB</span></div>
              <div className="tl-c">{fdone ? '其中 ' + k1.toFixed(1) + ' GB 可重建，缓存已清掉' : '其中 ' + k1.toFixed(1) + ' GB 可重建，含 ' + foamGb.toFixed(1) + ' GB 缓存'}</div>
            </Link>
            <section className={cx('tile t-sand', foam === 1 && 'is-busy', fdone && 'is-done')} aria-label="一键清理缓存">
              <div className="tl-h"><span className="tl-ic"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M1.5 12c2 0 2-1.6 4-1.6s2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 3 1.6" /><circle cx="6" cy="6" r="1.4" /><circle cx="10.5" cy="4.4" r="1" /><circle cx="13" cy="7.2" r="1.2" /></svg></span><span className="tl-k">{fdone ? '已清理缓存' : foam === 1 ? '正在清理…' : '随手可清'}</span></div>
              <div className="tl-n"><span className="mono">{(fdone ? foamFreed : foamGb).toFixed(1)}</span><span className="tl-u">GB</span>
                {!foam && <button type="button" className="btn btn-sm tl-btn" onClick={() => void foamGo()}>一键清理</button>}
                {fdone && <span className="tl-ok" aria-hidden="true">✓</span>}
              </div>
              <div className="tl-c">{fdone ? '缓存会在用到时自动长回来' : foamRows.slice(0, 3).map((r) => r.name.replace(/缓存$/, '')).join('、') + ' 等 ' + foamRows.length + ' 项缓存'}</div>
              {foam === 1 && <div className="foam-wave" aria-hidden="true" />}
            </section>
            <section className="tile t-lime" aria-label={`近 90 天累计释放 ${freedTotal.toFixed(1)} GB`}>
              <div className="tl-h"><span className="tl-ic"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">{[5, 9, 13].flatMap((y) => [5, 9, 13].map((x) => <circle key={x + '-' + y} cx={x} cy={y} r="1.1" />))}</svg></span><span className="tl-k">近 90 天释放</span></div>
              <div className="tl-n"><span className="mono">{freedTotal.toFixed(1)}</span><span className="tl-u">GB</span></div>
              <div className="tl-c">{ov?.ruleRuns ? '自动规则已代劳 ' + ov.ruleRuns + ' 次' : '还没有自动规则运行过'}</div>
            </section>
          </div>
          <div className="ov-row">
            <section className="panel p-pad soft ov-ins" aria-labelledby="ov-r">
              <h2 id="ov-r" className="sec-t"><span>{sys.id}: 怎么腾出这 {cleanable} GB</span></h2>
              <div className="stack" role="img" aria-label={`可重建 ${k1} GB，需审阅 ${k2} GB，不可恢复 ${k3} GB`}>
                <span className="sw-L1" style={{ flex: `${k1} 1 0` }} /><span className="sw-L2" style={{ flex: `${k2} 1 0` }} /><span className="sw-L3" style={{ flex: `${k3} 1 0`, boxShadow: 'inset 3px 0 0 var(--accent)' }} />
              </div>
              {kinds.map(([k, label, n, desc, gb]) => (
                <div key={k} className="rk">
                  {k !== 'mv' ? <span className={'sw10 sw-' + k} /> : <span className="g-arrow" aria-hidden="true">↗</span>}
                  <span style={{ display: 'grid' }}><span>{label}<span className="muted small">  {n} 项</span></span><span className="d">{desc}</span></span>
                  <span className="mono">{gb} GB</span>
                </div>
              ))}
              <div className="ov-go"><Link className="btn btn-primary" to={PATHS.map}>在空间地图中处理</Link><Link className="btn" to={PATHS.suggest}>逐项查看清理建议</Link></div>
            </section>
            <section className="panel p-pad soft ov-disks" aria-labelledby="ov-d">
              <h2 id="ov-d" className="sec-t">磁盘<span className="grow-1" /><Link to={PATHS.map}>空间地图</Link></h2>
              {drives.map(({ id: d, name: kind, total, free, free30: f30 }) => {
                const used = total - free, p = Math.round(used / total * 100), delta = f30 - free;
                return (
                  <Link key={d} className="drow" to={PATHS.map} aria-label={`${d}: ${kind}，${free.toFixed(1)} GB 可用，已用 ${p}%`}>
                    <span className="dr-ic" aria-hidden="true"><Icon name="drive" size={15} /></span>
                    <span className="dr-m">
                      <span className="dr-n"><b>{d}:</b> {kind}</span><span className="dr-s">{free.toFixed(1)} GB 可用 · 共 {Math.round(total)} GB</span>
                      <span className="capbar" aria-hidden="true"><span className="cb-used" style={{ flex: '0 0 ' + pct(used, total) }} /><span className="cb-tide" style={{ left: pct(total - f30, total) }} /></span>
                      <span className="dr-d">{delta > 0.05 ? '30 天少了 ' + delta.toFixed(1) + ' GB' : delta < -0.05 ? '30 天多了 ' + (-delta).toFixed(1) + ' GB' : '30 天没有变化'}</span>
                    </span>
                    <span className={cx('pill mono', free / total < 0.12 && 'p-hi')}>{p}%</span>
                  </Link>
                );
              })}
              <p className="cove-f"><span className="tide"><i />30 天前的水位</span></p>
            </section>
            <section className="panel p-pad soft ov-grow" aria-labelledby="ov-g">
              <h2 id="ov-g" className="sec-t">30 天里涨得最多<span className="grow-1" /><span className="mono" style={{ color: 'var(--accent)' }}>{ov?.growTotal ? '+' + ov.growTotal.toFixed(1) + ' GB' : ''}</span></h2>
              {growers.map(({ name, lv, gb }) => (
                <div key={name} className="gr"><span className={'sw10 sw-' + lv} /><span className="ellipsis">{name}</span><span className="gbar" aria-hidden="true"><i style={{ inlineSize: (gb / growMax * 100).toFixed(0) + '%' }} /></span><span className="mono r" style={{ textAlign: 'end' }}>+{gb.toFixed(1)}</span></div>
              ))}
              <p className="ov-gf">{ov?.growNote || '扫描两次以上之后，这里会列出涨得最快的文件夹'} {ov?.growNote ? <Link to={PATHS.map}>去迁移 →</Link> : null}</p>
            </section>
          </div>
        </div>
        <div className="ov-more">
          <section className="panel p-pad soft ov-acts" aria-labelledby="ov-a">
            <h2 id="ov-a" className="sec-t">最近活动<span className="grow-1" /><Link to={PATHS.activity}>全部活动</Link></h2>
            {acts.map(([time, kind, color, title, amount]) => (
              <div key={title} className="arow"><span className="a-ic"><span className="kd" style={{ background: color, boxShadow: 'none' }} /></span><span className="a-m"><b className="ellipsis">{title}</b><span className="muted">{kind} · {time}</span></span><span className="pill mono">{amount}</span></div>
            ))}
          </section>
          <section className="panel p-pad soft" aria-labelledby="ov-u">
            <h2 id="ov-u" className="sec-t">整理规则<span className="grow-1" /><Link to={PATHS.rules}>管理</Link></h2>
            {(ov?.rulesOn ?? []).map(([name, when]) => (
              <div key={name} className="rk" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}><span className="ellipsis">{name}</span><span className="muted small">{when}</span></div>
            ))}
            <div className="rk" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}><span>{sys.id}: 少于 20 GB 时提醒我</span><span className="tok">{lowText}</span></div>
            <div className="muted small" style={{ paddingTop: '0.625rem' }}>另有 {ov?.rulesOff ?? 0} 条未启用</div>
          </section>
        </div>
      </Scroll>
    </>
  );
}
