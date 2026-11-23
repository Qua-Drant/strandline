import { Fragment, useState } from 'react';
import { TideCalendar } from '../components/TideCalendar';
import { AGES, ALABEL, LVD, LVN } from '../lib/labels';
import { diskService } from '../services/diskService';
import type { CleanAct, CleanRow } from '../services/types';
import { useData } from '../services/useData';
import { skippedToast } from '../services/receipts';
import { sound } from '../lib/sound';
import { cx, shortHead, type Level } from '../lib/util';
import { Link } from '../components/Link';
import { PATHS } from '../routes';
import { Cbx, Modal, PageHeader, Scroll, Seg } from '../shell/parts';
import { useEscape, useShell } from '../shell/context';

type Filter = 'all' | Level;

export function Suggest() {
  const { cFree: cf, sys, refreshDrives, pushToast } = useShell();
  const total = sys.total;
  const [rows, reload] = useData(() => diskService.getSuggestions(sys.id), sys.id);
  const ROWS: CleanRow[] = rows ?? [];
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<'size' | 'last'>('size');
  // default: every rebuildable item is ticked, as in the design
  const [picked, setChecked] = useState<Record<string, boolean> | null>(null);
  const checked: Record<string, boolean> = picked ?? Object.fromEntries(ROWS.filter((r) => r.level === 'L1').map((r) => [r.id, true]));
  const [open, setOpen] = useState<string | null>(null);
  const done: Record<string, boolean> = Object.fromEntries(ROWS.filter((r) => r.done).map((r) => [r.id, true]));
  const [confirm, setConfirm] = useState(false);
  useEscape(() => setConfirm(false));

  const live = ROWS.filter((r) => !done[r.id]);
  const sel = live.filter((r) => checked[r.id]);
  const freeGb = sel.filter((r) => r.act !== 'recycle').reduce((a, r) => a + r.gain, 0);
  const binGb = sel.filter((r) => r.act === 'recycle').reduce((a, r) => a + r.gain, 0);
  const sorter = sort === 'size' ? (a: typeof ROWS[0], b: typeof ROWS[0]) => b.gain - a.gain : (a: typeof ROWS[0], b: typeof ROWS[0]) => b.days - a.days;
  const lvls: Level[] = filter === 'all' ? ['L1', 'L2', 'L3'] : [filter];
  const maxG = Math.max(0.1, ...ROWS.map((r) => r.gain));
  const gbL = (lv: Level) => live.filter((r) => r.level === lv).reduce((a, r) => a + r.gain, 0);

  const cgroups = (['rebuild', 'recycle', 'setting', 'empty'] as CleanAct[]).map((a) => {
    const its = sel.filter((r) => r.act === a);
    return { a, sw: 'sw-' + (a === 'rebuild' ? 'L1' : a === 'empty' ? 'L3' : 'L2'), label: ALABEL[a], names: its.map((r) => r.name).join('、'), sum: its.reduce((x, r) => x + r.gain, 0).toFixed(1) + ' GB', n: its.length };
  }).filter((g) => g.n);

  const ageRows = live.filter((r) => r.days < 900);
  const ages = AGES.map(([label, a, b]) => { const rs = ageRows.filter((r) => r.days >= a && r.days <= b); return { label, n: rs.length, gb: rs.reduce((x, r) => x + r.gain, 0) }; });
  const ageMax = Math.max(1, ...ages.map((a) => a.gb));
  const after = cf + freeGb;
  const st = (f: number) => (f / total < 0.12 ? '空间紧张' : f / total < 0.2 ? '空间偏紧' : '空间充足');
  const pos = (f: number) => Math.min(100, f / total / 0.3 * 100).toFixed(1) + '%';

  const stones = (['L1', 'L2', 'L3'] as Level[]).map((lv) => ({ lv, g: gbL(lv) })).filter((x) => x.g > 0.05).sort((a, b) => a.g - b.g);

  const doClean = async () => {
    setConfirm(false);
    const rc = await diskService.clean(sys.id, sel.map((r) => r.id));
    setChecked({});
    await reload(); await refreshDrives();
    if (rc.items.length) {
      sound.wash(false, 520);
      const undoable = rc.items.filter((i) => i.undoable);
      pushToast({ kind: 'ok', title: rc.freed > 0.05 ? '已释放 ' + rc.freed.toFixed(1) + ' GB' : rc.bin.toFixed(1) + ' GB 已移入回收站',
        sub: rc.freed > 0.05 && rc.bin > 0.05 ? rc.bin.toFixed(1) + ' GB 已移入回收站，可在「活动」里撤销' : rc.bin > 0.05 ? '清空回收站后才会腾出空间' : '记录已写入「活动」',
        ...(undoable.length ? { action: '撤销', run: async () => { await diskService.undoReceipt(rc.id); await reload(); await refreshDrives(); } } : {}) }, 8000);
    }
    skippedToast(rc, pushToast);
  };

  return (
    <>
      <PageHeader crumb={[sys.id + ' 盘', '清理建议']} />
      <Scroll className="pg bpg">
        <div className="sg">
          <div className="sg-main">
            <div className="bento" style={{ gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)' }}>
              <section className="bx bx-sand" aria-labelledby="sg-b">
                <div className="bx-h"><h2 id="sg-b" className="wx-k">可以腾出</h2><span className="bx-note">点石头只看这一类</span></div>
                <div className="stone-w">
                  <div className="st-num">
                    <div className="big-l"><span className="mono">{live.reduce((a, r) => a + r.gain, 0).toFixed(1)}</span><span className="u">GB</span></div>
                    <p>{live.length} 项可以腾出</p>
                    {filter !== 'all' && <button type="button" className="link-btn small" onClick={() => setFilter('all')}>显示全部</button>}
                  </div>
                  <div className="stones">
                    {stones.map((x, i) => {
                      const on = filter === x.lv, w = 54 + Math.sqrt(x.g) * 14, dim = filter !== 'all' && !on;
                      return (
                        <div key={x.lv} className="st-row">
                          <button type="button" className={cx('stone s-' + x.lv, on && 'is-on', dim && 'is-dim')}
                            style={{ inlineSize: Math.round(w) + 'px', blockSize: Math.round(w * 0.4) + 'px', rotate: ([-4, 3, -1.5][i] || 0) + 'deg' }}
                            aria-pressed={on} aria-label={`${LVN[x.lv]} ${x.g.toFixed(1)} GB，只看这一类`} onClick={() => setFilter(on ? 'all' : x.lv)} />
                          <span className={cx('st-l', dim && 'is-dim')}><b className="mono">{x.g.toFixed(1)}</b><span>GB · {LVN[x.lv]}</span></span>
                        </div>
                      );
                    })}
                    <span className="st-shadow" aria-hidden="true" />
                  </div>
                </div>
              </section>
              <section className="bx" aria-labelledby="sg-a">
                <div className="bx-h"><h2 id="sg-a" className="wx-k">多久没用了</h2><button type="button" className="link-btn small" onClick={() => setSort('last')}>按最久没用排序</button></div>
                <div className="wx">
                  {ages.map((a) => (
                    <div key={a.label} className="wx-r" title={a.label + '没用过：' + a.gb.toFixed(1) + ' GB'}>
                      <span className="wx-l">{a.label}</span><span className="wx-n">{a.n ? a.n + ' 项' : '—'}</span>
                      <span className="wx-t"><i className={a.label === '半年以上' ? 'old' : ''} style={{ inlineSize: Math.max(a.gb > 0 ? 4 : 0, a.gb / ageMax * 100).toFixed(1) + '%' }} /></span>
                      <span className="mono wx-v">{a.gb.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
                <p className="bx-foot">有 {ages[4].gb.toFixed(1)} GB 已经半年以上没打开过</p>
              </section>
            </div>
            <section className="bx bx-list" aria-label="清理项">
              <div className="lc-h">
                <div className="tabs" role="group" aria-label="按风险筛选">
                  {([['all', '全部'], ['L1', '可重建'], ['L2', '需审阅'], ['L3', '不可恢复']] as [Filter, string][]).map(([k, label]) => (
                    <button key={k} type="button" className="tab" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                      {label}<span className="cnt">{k === 'all' ? live.length : live.filter((r) => r.level === k).length}</span>
                    </button>
                  ))}
                </div>
                <span className="grow-1" />
                <Seg className="seg seg-sm seg-2" label="排序" value={sort} onPick={setSort} items={[['size', '按大小'], ['last', '最久没用']]} />
              </div>
              {lvls.map((lv) => {
                const rs = ROWS.filter((r) => r.level === lv).sort(sorter);
                const ls = rs.filter((r) => !done[r.id]);
                const allOn = ls.length > 0 && ls.every((r) => checked[r.id]);
                return (
                  <div key={lv} className="lgrp">
                    <div className="lg-h">
                      <span className={'sw10 sw-' + lv} /><b>{LVN[lv]}</b><span className="lg-d">{LVD[lv]}</span><span className="grow-1" />
                      <span className="mono lg-m">{ls.length + ' 项 · ' + ls.reduce((a, r) => a + r.gain, 0).toFixed(1) + ' GB'}</span>
                      <button type="button" className="link-btn small" onClick={() => { const c = { ...checked }; ls.forEach((r) => { c[r.id] = !allOn; }); setChecked(c); }}>{allOn ? '全不选' : '全选'}</button>
                    </div>
                    {rs.map((r) => {
                      const isDone = !!done[r.id], on = !!checked[r.id] && !isDone, isOpen = open === r.id;
                      return (
                        <Fragment key={r.id}>
                          <div className={cx('rc rc-' + r.level, on && 'is-on', isDone && 'is-done', isOpen && 'is-open')} onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
                            <Cbx label={r.name} checked={on} disabled={isDone} onChange={() => setChecked({ ...checked, [r.id]: !checked[r.id] })} />
                            <span className="rc-m">
                              <span className="rc-n"><b className="ellipsis">{r.name}</b>{r.level === 'L3' && <span className="l3tag">不可恢复</span>}{isDone && <span className="tok">已清理</span>}</span>
                              <span className="path"><span>{shortHead(r.head, 30)}</span><span>{r.tail}</span></span>
                            </span>
                            <span className="rc-last">{r.last}</span>
                            <span className="rc-act">{ALABEL[r.act]}</span>
                            <span className="rc-sz"><span className="rbar" aria-hidden="true"><i style={{ inlineSize: (r.gain / maxG * 100).toFixed(1) + '%' }} /></span><span className="mono">{r.gain.toFixed(1)}</span><span className="u">GB</span></span>
                          </div>
                          {isOpen && (
                            <div className="xrow rc-x">
                              <span>{r.note}</span>
                              {r.meta && <span className="muted small">本地元数据识别 · 不读取文件内容</span>}
                              {r.cmd && <details><summary className="muted small" style={{ cursor: 'pointer' }}>高级 · PowerShell 等效命令</summary><code className="mono small">{r.cmd}</code></details>}
                            </div>
                          )}
                        </Fragment>
                      );
                    })}
                  </div>
                );
              })}
            </section>
          </div>
          <aside className="sg-rail">
            <section className="bx bx-sky" aria-labelledby="sg-p">
              <h2 id="sg-p" className="dk-k wx-k">清理计划</h2>
              <div className="dk-n"><span className="mono">{freeGb.toFixed(1)}</span><span>GB</span></div>
              <p className="dk-s">{sel.length ? '将释放 · 已选 ' + sel.length + ' 项' : '在左边勾选要清理的项'}</p>
              <ul className="dk-l">{cgroups.map((g) => <li key={g.a}><span className={'sw10 ' + g.sw} /><span className="ellipsis">{g.label}</span><span className="mono">{g.sum}</span></li>)}</ul>
              {binGb > 0.05 && <p className="dk-bin">另有 {binGb.toFixed(1)} GB 移入回收站，清空后才腾出</p>}
              <button type="button" className="btn dk-cta" disabled={!sel.length} onClick={() => setConfirm(true)}>{sel.length ? '清理 ' + sel.length + ' 项…' : '清理'}</button>
              <Link className="dk-link" to={PATHS.map}>在空间地图中查看 →</Link>
            </section>
            <section className="bx" aria-labelledby="sg-after">
              <h2 id="sg-after" className="bx-h2 wx-k">清理后的 {sys.id} 盘</h2>
              <div className="uv" role="img" aria-label={`现在 ${cf.toFixed(1)} GB 可用，清理后 ${after.toFixed(1)} GB`}>
                <span className="uv-bar" /><span className="uv-dot now" style={{ left: pos(cf) }} /><span className="uv-dot aft" style={{ left: pos(after) }} />
              </div>
              <div className="uv-sc" aria-hidden="true"><span>紧张</span><span>偏紧</span><span>充足</span></div>
              <div className="ab-l"><span>现在<b className="mono">{cf.toFixed(1)}</b>GB</span><span className="tide">清理后<b className="mono">{after.toFixed(1)}</b>GB</span></div>
              <p className="bx-foot">{freeGb > 0.05
                ? '可用从 ' + (cf / total * 100).toFixed(1) + '% 升到 ' + (after / total * 100).toFixed(1) + '%' + (st(cf) !== st(after) ? '，从「' + st(cf) + '」变为「' + st(after) + '」' : '')
                : '勾选后这里会预览清理后的空间'}</p>
            </section>
            <TideCalendar cf={cf} after={after} total={total} drive={sys.id} />
          </aside>
        </div>
      </Scroll>
      {confirm && (
        <Modal onClose={() => setConfirm(false)}>
          <section className="dlg" role="dialog" aria-modal="true" aria-labelledby="sg-c">
            <h2 id="sg-c" style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>清理 {sel.length} 项？</h2>
            <dl style={{ margin: 0 }}>
              <div className="rc-row"><dt>将释放磁盘空间</dt><dd className="mono" style={{ fontWeight: 500 }}>{freeGb.toFixed(1)} GB</dd></div>
              {binGb > 0.05 && <div className="rc-row"><dt>将移入回收站<span className="muted small">（清空后释放）</span></dt><dd className="mono">{binGb.toFixed(1)} GB</dd></div>}
            </dl>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
              {cgroups.map((g) => (
                <li key={g.a} className="grow"><span className={'sw10 ' + g.sw} /><span style={{ display: 'grid', minInlineSize: 0 }}><span>{g.label}</span><span className="muted ellipsis" style={{ fontSize: '0.6875rem' }}>{g.names}</span></span><span className="mono" style={{ fontSize: '0.75rem' }}>{g.sum}</span></li>
              ))}
            </ul>
            {sel.some((r) => r.act === 'empty') && <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--accent)' }}>清空回收站后，里面的文件无法找回。</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="btn" autoFocus onClick={() => setConfirm(false)}>取消</button>
              <button type="button" className="btn btn-primary" onClick={() => void doClean()}>清理</button>
            </div>
          </section>
        </Modal>
      )}
    </>
  );
}
