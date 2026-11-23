import { useEffect, useRef } from 'react';
import { Icon } from '../components/Icon';
import { C_FREE_0, FOAM, freed90 } from '../data/history';
import { sound } from '../lib/sound';
import { ATMO_TEXT, atmoOf, cx, pct } from '../lib/util';
import { Link } from '../router';
import { PATHS } from '../routes';
import { PageHeader, Scroll } from '../shell/parts';
import { useShell } from '../shell/store';

const DISKS: [string, string, number, number, number][] = [['C', '系统盘', 512, 44.0, 87.2], ['D', '数据盘', 1000, 388.0, 401.5], ['E', '移动硬盘', 965, 637.0, 637.0]];
const GROW: [string, string, number][] = [['微信聊天原图与视频', 'L4', 12.4], ['Docker WSL 磁盘', 'L2', 9.8], ['Sentinel-2 2023', 'L4', 8.0], ['pip 缓存', 'L1', 4.6], ['浏览器缓存', 'L1', 3.1], ['临时文件', 'L1', 2.6], ['其他 11 项', 'L4', 2.7]];
type Act = [time: string, kind: string, color: string, title: string, amount: string];
const ACTS: Act[] = [
  ['13:52', '扫描', 'var(--line-2)', '扫描 C: · 41.2 万个文件 · 1 分 04 秒', '468 GB'],
  ['09:00', '整理', 'var(--l2)', '规则「安装包装好 30 天后移入回收站」· 3 个文件', '1.1 GB'],
  ['10/18', '清理', 'var(--l1)', '常规清理 6 项 · 可重建缓存与回收站', '18.6 GB'],
];
const RULES_ON: [string, string][] = [['安装包装好 30 天后移入回收站', '每天'], ['截图按月归档', '新文件出现时'], ['论文 PDF 归档', '新文件出现时']];

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
  const { cFree: cf, setCFree, foam, setFoam, task, startTask, pushToast } = useShell();
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  const fdone = foam === 2;
  const atmo = atmoOf(cf);
  const atmoText = ATMO_TEXT[atmo];
  const cfi = Math.floor(cf + 1e-6), cfd = Math.round((cf - cfi) * 10) % 10;

  const foamGo = () => {
    if (foam) return;
    setFoam(1);
    sound.wash(false, 560);
    timers.current.push(window.setTimeout(() => setCFree(C_FREE_0 + FOAM), 240));
    timers.current.push(window.setTimeout(() => setFoam(2), 600));
  };
  const rescan = () => startTask('扫描 3 块磁盘', '索引文件系统…', () => pushToast({ kind: 'ok', title: '扫描完成', sub: 'C: 468 GB · D: 612 GB · E: 328 GB 已用' }, 5000), true);

  const cleanable = fdone ? '74.3' : '99.5';
  const [k1, k2, k3] = [fdone ? '14.8' : '40.0', '49.9', '9.6'];
  const kinds: [string, string, number, string, string][] = [
    ['L1', '可重建', fdone ? 2 : 8, '删了会自动重建', k1], ['L2', '需审阅', 5, '看一眼再决定，有的会改系统设置', '49.9'],
    ['L3', '不可恢复', 1, '回收站，清空后找不回', '9.6'], ['mv', '可迁移', 7, '搬到 D: 或 E:，C: 才真正宽裕', '256.0'],
  ];
  const acts: Act[] = fdone ? [['刚刚', '清理', 'var(--l1)', '一键清理 6 项缓存', '25.2 GB'] as Act].concat(ACTS.slice(0, 2)) : ACTS;

  return (
    <>
      <PageHeader crumb={['概览']}>
        <button type="button" className="btn btn-sm" onClick={rescan} disabled={!!task}><Icon name="rescan" size={14} />重新扫描全部磁盘</button>
      </PageHeader>
      <Scroll className="pg ov2" style={{ paddingTop: '0.75rem' }}>
        <div className="ov-fold">
          <header className={cx('hello', fdone && 'is-happy', foam === 1 && 'is-busy')}>
            <div className="hello-t">
              <p className="eyebrow">11 月 21 日 · 星期六</p>
              <h1 className="hello-h">{fdone ? '下午好，C 盘腾出了 25.2 GB' : '下午好，C 盘快满了'}</h1>
              <p className="hello-s">{fdone
                ? '清掉 6 项会自动重建的缓存后，C 盘回到 ' + cf.toFixed(1) + ' GB 可用。剩下的需要你看一眼再决定。'
                : 'C 盘只剩 ' + cf.toFixed(1) + ' GB 可用（' + (cf / 512 * 100).toFixed(1) + '%）。可重建的 40.0 GB 里，有 25.2 GB 缓存可以放心一键清理。'}</p>
            </div>
            <HelloArt />
          </header>
          <div className="tiles">
            <Link className={'tile t-state s-' + atmo} to={PATHS.map} aria-label={`C 盘可用 ${cf.toFixed(1)} GB，${atmoText}，打开空间地图`}>
              <div className="tl-h"><span className="tl-ic"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 6.5c1.6 0 1.6-1.3 3.2-1.3S6.8 6.5 8.4 6.5s1.6-1.3 3.2-1.3 1.6 1.3 3.2 1.3 1.6-1.3 1.6-1.3" /><path d="M2 11c1.6 0 1.6-1.3 3.2-1.3S6.8 11 8.4 11s1.6-1.3 3.2-1.3S13.2 11 14.8 11 16.4 9.7 16.4 9.7" opacity=".6" /><path d="M2 15h14.4" opacity=".35" /></svg></span><span className="tl-k">C 盘可用</span></div>
              <div className="tl-n"><span className="mono num anim" style={{ ['--i' as string]: cfi, ['--dd' as string]: cfd }} /><span className="tl-u">GB</span></div>
              <div className="tl-c">{atmoText} · 30 天少了 {(87.2 - cf).toFixed(1)} GB</div>
              {foam === 1 && <div className="foam-wave" aria-hidden="true" />}
            </Link>
            <Link className="tile t-sea" to={PATHS.suggest} aria-label={`可以腾出 ${cleanable} GB，查看清理建议`}>
              <div className="tl-h"><span className="tl-ic"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="3" width="13" height="12" rx="2.5" /><path d="M6 9.2l2 2 4-4.4" /></svg></span><span className="tl-k">可以腾出</span></div>
              <div className="tl-n"><span className="mono">{cleanable}</span><span className="tl-u">GB</span></div>
              <div className="tl-c">{fdone ? '其中 14.8 GB 可重建，缓存已清掉' : '其中 40.0 GB 可重建，含 25.2 GB 缓存'}</div>
            </Link>
            <section className={cx('tile t-sand', foam === 1 && 'is-busy', fdone && 'is-done')} aria-label="一键清理缓存">
              <div className="tl-h"><span className="tl-ic"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M1.5 12c2 0 2-1.6 4-1.6s2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 3 1.6" /><circle cx="6" cy="6" r="1.4" /><circle cx="10.5" cy="4.4" r="1" /><circle cx="13" cy="7.2" r="1.2" /></svg></span><span className="tl-k">{fdone ? '已清理缓存' : foam === 1 ? '正在清理…' : '随手可清'}</span></div>
              <div className="tl-n"><span className="mono">25.2</span><span className="tl-u">GB</span>
                {!foam && <button type="button" className="btn btn-sm tl-btn" onClick={foamGo}>一键清理</button>}
                {fdone && <span className="tl-ok" aria-hidden="true">✓</span>}
              </div>
              <div className="tl-c">{fdone ? '缓存会在用到时自动长回来' : '临时文件、浏览器、pip 等 6 项缓存'}</div>
              {foam === 1 && <div className="foam-wave" aria-hidden="true" />}
            </section>
            <section className="tile t-lime" aria-label={`近 90 天累计释放 ${freed90(fdone ? FOAM : 0).toFixed(1)} GB`}>
              <div className="tl-h"><span className="tl-ic"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">{[5, 9, 13].flatMap((y) => [5, 9, 13].map((x) => <circle key={x + '-' + y} cx={x} cy={y} r="1.1" />))}</svg></span><span className="tl-k">近 90 天释放</span></div>
              <div className="tl-n"><span className="mono">{freed90(fdone ? FOAM : 0).toFixed(1)}</span><span className="tl-u">GB</span></div>
              <div className="tl-c">自动规则已代劳 28 次</div>
            </section>
          </div>
          <div className="ov-row">
            <section className="panel p-pad soft ov-ins" aria-labelledby="ov-r">
              <h2 id="ov-r" className="sec-t"><span>C: 怎么腾出这 {cleanable} GB</span></h2>
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
              {DISKS.map(([d, kind, total, free0, f30]) => {
                const free = d === 'C' ? cf : free0, used = total - free, p = Math.round(used / total * 100), delta = f30 - free;
                return (
                  <Link key={d} className="drow" to={PATHS.map} aria-label={`${d}: ${kind}，${free.toFixed(1)} GB 可用，已用 ${p}%`}>
                    <span className="dr-ic" aria-hidden="true"><Icon name="drive" size={15} /></span>
                    <span className="dr-m">
                      <span className="dr-n"><b>{d}:</b> {kind}</span><span className="dr-s">{free.toFixed(1)} GB 可用 · 共 {total} GB</span>
                      <span className="capbar" aria-hidden="true"><span className="cb-used" style={{ flex: '0 0 ' + pct(used, total) }} /><span className="cb-tide" style={{ left: pct(total - f30, total) }} /></span>
                      <span className="dr-d">{delta > 0.05 ? '30 天少了 ' + delta.toFixed(1) + ' GB' : '30 天没有变化'}</span>
                    </span>
                    <span className={cx('pill mono', free / total < 0.12 && 'p-hi')}>{p}%</span>
                  </Link>
                );
              })}
              <p className="cove-f"><span className="tide"><i />30 天前的水位</span></p>
            </section>
            <section className="panel p-pad soft ov-grow" aria-labelledby="ov-g">
              <h2 id="ov-g" className="sec-t">30 天里涨得最多<span className="grow-1" /><span className="mono" style={{ color: 'var(--accent)' }}>+43.2 GB</span></h2>
              {GROW.map(([name, lv, gb]) => (
                <div key={name} className="gr"><span className={'sw10 sw-' + lv} /><span className="ellipsis">{name}</span><span className="gbar" aria-hidden="true"><i style={{ inlineSize: (gb / 12.4 * 100).toFixed(0) + '%' }} /></span><span className="mono r" style={{ textAlign: 'end' }}>+{gb.toFixed(1)}</span></div>
              ))}
              <p className="ov-gf">微信和 Docker 占了这 30 天涨幅的一半，适合搬到 D: <Link to={PATHS.map}>去迁移 →</Link></p>
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
            {RULES_ON.map(([name, when]) => (
              <div key={name} className="rk" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}><span className="ellipsis">{name}</span><span className="muted small">{when}</span></div>
            ))}
            <div className="rk" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}><span>C: 少于 20 GB 时提醒我</span><span className="tok">已开启</span></div>
            <div className="muted small" style={{ paddingTop: '0.625rem' }}>另有 2 条未启用</div>
          </section>
        </div>
      </Scroll>
    </>
  );
}
