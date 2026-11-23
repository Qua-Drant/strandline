import { useState } from 'react';
import { calInfo, CLEANS, freed90, LEVEL90, MOVES90 } from '../data/history';
import { cx } from '../lib/util';

/** "C 盘这 90 天" card: free-space line, tight line, projection after cleaning, and a day grid. */
export function TideCalendar({ cf, after }: { cf: number; after: number }) {
  const [ch, setCh] = useState<number | null>(null);
  const level = LEVEL90.slice(); level[90] = cf;
  const top = Math.max(Math.max(...level), after) * 1.1;
  const Y = (v: number) => 40 - v / top * 40;
  const P = (v: number) => (Y(v) / 40 * 100).toFixed(2) + '%';
  const pts = level.map((v, d) => d + ',' + Y(v).toFixed(2)).join(' L');
  const evs = Object.keys(CLEANS).concat(Object.keys(MOVES90)).map(Number);
  const out = () => setCh(null);
  return (
    <section className="bx tw" aria-labelledby="sg-tc">
      <div className="tw-h"><h2 id="sg-tc" className="bx-h2 wx-k">C 盘这 90 天</h2><span className="tw-r mono">8/23 – 11/21</span></div>
      <div className="tw-plot">
        <svg className="tw-svg" viewBox="0 0 90 40" preserveAspectRatio="none" aria-hidden="true">
          <path className="tw-area" d={'M0,40 L' + pts + ' L90,40 Z'} />
          <path className="tw-line" d={'M' + pts} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="tw-tight" style={{ top: P(512 * 0.12) }} aria-hidden="true" />
        {evs.map((d) => <i key={d} className="tw-ev" style={{ left: (d / 90 * 100).toFixed(2) + '%', top: P(level[d]) }} aria-hidden="true" />)}
        <i className="tw-proj" style={{ top: P(after), height: ((Y(cf) - Y(after)) / 40 * 100).toFixed(2) + '%' }} aria-hidden="true" />
        <i className="tw-now" style={{ top: P(cf) }} aria-hidden="true" />
        <i className="tw-aft" style={{ top: P(after) }} aria-hidden="true" />
        {ch !== null && <i className="tw-hx" style={{ left: (ch / 90 * 100).toFixed(2) + '%' }} aria-hidden="true" />}
      </div>
      <div className="tw-key" aria-hidden="true"><span><i className="k-line" />可用空间</span><span><i className="k-tight" />紧张线</span><span><i className="k-aft" />清理后</span></div>
      <div className="tw-mo" aria-hidden="true"><span style={{ gridColumn: 2 }}>9 月</span><span style={{ gridColumn: 6 }}>10 月</span><span style={{ gridColumn: 11 }}>11 月</span></div>
      <div className="cal tw-cal" role="grid" aria-label="近 90 天 C 盘可用空间，每列一周" onMouseLeave={out}>
        {level.map((_, d) => {
          const ci = calInfo(level, d);
          return <button key={d} type="button" className={cx('cd c-' + ci.kind, d === 90 && 'is-today', ch === d && 'is-on')} aria-label={ci.text}
            onMouseEnter={() => setCh(d)} onFocus={() => setCh(d)} onBlur={out} />;
        })}
      </div>
      <div className="cal-read">
        <span className={cx('cal-leg', ch === null && 'on')}><span><i className="c-calm" />正常</span><span><i className="c-clean" />清理日</span><span><i className="c-high" />空间紧张</span></span>
        <span className={cx('cal-rd mono', ch !== null && 'on')}>{ch === null ? '' : calInfo(level, ch).text}</span>
      </div>
      <p className="bx-foot tw-foot">共腾出 <b className="mono">{freed90().toFixed(1)}</b> GB · 清理 3 次 · 迁移 1 次</p>
    </section>
  );
}
