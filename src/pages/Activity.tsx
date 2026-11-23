import { useState } from 'react';
import { cx } from '../lib/util';
import { PageHeader, Scroll } from '../shell/parts';
import { useShell } from '../shell/context';
import { diskService } from '../services/diskService';
import type { ActivityEvent, EventKind } from '../services/types';
import { useData } from '../services/useData';

type Kind = EventKind;
type Ev = ActivityEvent;

const KIND: Record<Kind, [string, string, string]> = { clean: ['清理', 'var(--l1)', 'none'], move: ['迁移', 'var(--l4)', 'inset 0 0 0 1px var(--line-2)'], rule: ['整理', 'var(--l2)', 'none'], scan: ['扫描', 'var(--line-2)', 'none'] };
const FILTERS: [Kind | 'all', string][] = [['all', '全部'], ['clean', '清理'], ['move', '迁移'], ['rule', '整理'], ['scan', '扫描']];

export function Activity() {
  const { pushToast } = useShell();
  const [filter, setFilter] = useState<Kind | 'all'>('all');
  const [open, setOpen] = useState<Record<string, boolean>>({ e1: true });
  const [events, reload] = useData(() => diskService.listActivity());
  const EVENTS = events ?? [];

  const vis = EVENTS.filter((e) => filter === 'all' || e.kind === filter);
  const days: { label: string; items: Ev[] }[] = [];
  vis.forEach((e) => { let d = days.find((x) => x.label === e.day); if (!d) { d = { label: e.day, items: [] }; days.push(d); } d.items.push(e); });

  return (
    <>
      <PageHeader crumb={['活动']}>
        <div className="fchips" role="group" aria-label="筛选">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" className="fchip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {label}<span className="mono">{k === 'all' ? EVENTS.length : EVENTS.filter((e) => e.kind === k).length}</span>
            </button>
          ))}
        </div>
      </PageHeader>
      <Scroll className="pg"><div className="acts">
        {days.map((d) => (
          <section key={d.label} style={{ marginBottom: '1.25rem' }}>
            <h2 className="sec-t" style={{ marginBottom: '0.25rem' }}>{d.label}</h2>
            {d.items.map((e) => {
              const un = !!e.undone, isOpen = !!open[e.id];
              return (
                <div key={e.id} className={cx('ev', un && 'is-undone')}>
                  <span className="mono muted ev-t">{e.time}</span><span className="kd" style={{ background: KIND[e.kind][1], boxShadow: KIND[e.kind][2] }} />
                  <div style={{ minInlineSize: 0 }}>
                    <button type="button" className="ev-title" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [e.id]: !isOpen })}>
                      <span className="tok">{KIND[e.kind][0]}</span><span>{e.title}</span>
                      {e.items.length > 0 && <span className="ev-chev" aria-hidden="true">{isOpen ? '收起' : '明细'}</span>}
                    </button>
                    <div className="muted small" style={{ marginTop: '0.25rem' }}>{e.detail}</div>
                  </div>
                  <div className="ev-r">
                    <span className="mono ev-amt">{e.amount}</span>
                    {!!e.undo && !un && <button type="button" className="link-btn small" onClick={async () => { await diskService.undoActivity(e.id); await reload(); pushToast({ kind: 'ok', title: '已' + e.undo.replace(/^撤销.*/, '撤销'), sub: e.title }, 5000); }}>{e.undo}</button>}
                    {(un || (!e.undo && e.kind !== 'scan')) && <span className="muted small">{un ? '已撤销' : '不可撤销'}</span>}
                  </div>
                  {isOpen && e.items.length > 0 && (
                    <ul className="ev-items">{e.items.map(([lv, name, amt]) => <li key={name}><span className={'sw10 sw-' + lv} /><span className="ellipsis">{name}</span><span className="mono ev-amt">{amt}</span></li>)}</ul>
                  )}
                </div>
              );
            })}
          </section>
        ))}
        <p className="muted small" style={{ margin: '0.5rem 0 0' }}>移入回收站的项目 30 天内可撤销；清空回收站不可撤销；删除的缓存会在需要时自动重建。</p>
      </div></Scroll>
    </>
  );
}
