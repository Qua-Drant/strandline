import { useState } from 'react';
import { calInfo, filledLevel, freed90, range90 } from '../lib/history';
import { cx } from '../lib/util';
import { diskService } from '../services/diskService';
import { useData } from '../services/useData';

/** "C 盘这 90 天" card: free-space line, tight line, projection after cleaning, and a day grid. */
export function TideCalendar({ cf, after, total, drive }: { cf: number; after: number; total: number; drive: string }) {
  const [ch, setCh] = useState<number | null>(null);
  const [h] = useData(() => diskService.getHistory(drive), drive + ':' + cf.toFixed(2));
  if (!h) return <section className="bx tw" aria-label={drive + ' 盘这 90 天'} />;
  const level = filledLevel(h, cf);
  const top = Math.max(Math.max(...level), after) * 1.1;
  const Y = (v: number) => 40 - v / top * 40;
  const P = (v: number) => (Y(v) / 40 * 100).toFixed(2) + '%';
  const pts = level.map((v, d) => d + ',' + Y(v).toFixed(2)).join(' L');
  const evs = Object.keys(h.cleans).concat(Object.keys(h.moves)).map(Number);
  const out = () => setCh(null);
  const nClean = Object.keys(h.cleans).length, nMove = Object.keys(h.moves).length;
  return (
    <section className="bx tw" aria-labelledby="sg-tc">
      <div className="tw-h"><h2 id="sg-tc" className="bx-h2 wx-k">{drive} 盘这 90 天</h2><span className="tw-r mono">{range90(h)}</span></div>
      <div className="tw-plot">
        <svg className="tw-svg" viewBox="0 0 90 40" preserveAspectRatio="none" aria-hidden="true">
          <path className="tw-area" d={'M0,40 L' + pts + ' L90,40 Z'} />
          <path className="tw-line" d={'M' + pts} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="tw-tight" style={{ top: P(total * 0.12) }} aria-hidden="true" />
        {evs.map((d) => <i key={d} className="tw-ev" style={{ left: (d / 90 * 100).toFixed(2) + '%', top: P(level[d]) }} aria-hidden="true" />)}
        <i className="tw-proj" style={{ top: P(after), height: ((Y(cf) - Y(after)) / 40 * 100).toFixed(2) + '%' }} aria-hidden="true" />
        <i className="tw-now" style={{ top: P(cf) }} aria-hidden="true" />
        <i className="tw-aft" style={{ top: P(after) }} aria-hidden="true" />
        {ch !== null && <i className="tw-hx" style={{ left: (ch / 90 * 100).toFixed(2) + '%' }} aria-hidden="true" />}
      </div>
      <div className="tw-key" aria-hidden="true"><span><i className="k-line" />可用空间</span><span><i className="k-tight" />紧张线</span><span><i className="k-aft" />清理后</span></div>
      <div className="tw-mo" aria-hidden="true">
        {[0, 1, 2, 3].map((k) => {
          // label the week column where each calendar month starts
          const start = new Date(h.start), m = new Date(start.getFullYear(), start.getMonth() + k + 1, 1);
          const col = Math.floor((m.getTime() - h.start) / 86400000 / 7) + 1;
          return col >= 1 && col <= 13 ? <span key={k} style={{ gridColumn: col }}>{m.getMonth() + 1} 月</span> : null;
        })}
      </div>
      <div className="cal tw-cal" role="grid" aria-label={'近 90 天 ' + drive + ' 盘可用空间，每列一周'} onMouseLeave={out}>
        {level.map((_, d) => {
          const ci = calInfo(h, level, d, total);
          return <button key={d} type="button" className={cx('cd c-' + (ci.kind === 'none' ? 'calm' : ci.kind), d === 90 && 'is-today', ch === d && 'is-on')} aria-label={ci.text}
            style={ci.kind === 'none' ? { opacity: 0.35 } : undefined}
            onMouseEnter={() => setCh(d)} onFocus={() => setCh(d)} onBlur={out} />;
        })}
      </div>
      <div className="cal-read">
        <span className={cx('cal-leg', ch === null && 'on')}><span><i className="c-calm" />正常</span><span><i className="c-clean" />清理日</span><span><i className="c-high" />空间紧张</span></span>
        <span className={cx('cal-rd mono', ch !== null && 'on')}>{ch === null ? '' : calInfo(h, level, ch, total).text}</span>
      </div>
      <p className="bx-foot tw-foot">共腾出 <b className="mono">{freed90(h).toFixed(1)}</b> GB · 清理 {nClean} 次 · 迁移 {nMove} 次</p>
    </section>
  );
}
