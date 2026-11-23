import { useState } from 'react';
import { cx } from '../lib/util';
import { PageHeader, Scroll } from '../shell/parts';
import { useShell } from '../shell/context';

type Kind = 'clean' | 'move' | 'rule' | 'scan';
interface Ev { id: string; day: string; time: string; kind: Kind; title: string; detail: string; amount: string; undo: string; items: [string, string, string][] }

const EVENTS: Ev[] = [
  { id: 'e2', day: '今天', time: '13:52', kind: 'scan', title: '扫描 C:', detail: '41.2 万个文件 · 1 分 04 秒', amount: '468 GB', undo: '', items: [] },
  { id: 'e3', day: '今天', time: '09:00', kind: 'rule', title: '规则「安装包装好 30 天后移入回收站」', detail: '3 个文件移入回收站', amount: '1.1 GB', undo: '撤销', items: [['L2', 'ArcGISPro_31_Setup.exe', '0.9 GB'], ['L2', 'WeChatSetup.exe', '0.2 GB'], ['L2', 'Python-3.12.4-amd64.exe', '0.03 GB']] },
  { id: 'e5', day: '昨天', time: '18:02', kind: 'rule', title: '规则「截图按月归档」', detail: '6 个文件移到 图片\\截图\\2026-11', amount: '6 个', undo: '撤销', items: [] },
  { id: 'e4', day: '10 月 12 日', time: '20:30', kind: 'move', title: '迁移 Zotero 文献库 → D:', detail: '原处留了联接 · Zotero 照常打开', amount: '6.4 GB', undo: '搬回 C:', items: [] },
  { id: 'e1', day: '10 月 18 日', time: '22:15', kind: 'clean', title: '常规清理 6 项', detail: '可重建的缓存会在用到时自动长回来', amount: '18.6 GB', undo: '', items: [['L1', 'pip 缓存', '5.1 GB'], ['L1', '临时文件', '4.4 GB'], ['L1', '浏览器缓存', '3.6 GB'], ['L3', '回收站 · 已清空', '2.3 GB'], ['L1', 'npm 缓存', '2.2 GB'], ['L1', 'NVIDIA 安装缓存', '1.0 GB']] },
  { id: 'e6', day: '10 月 18 日', time: '22:02', kind: 'scan', title: '扫描 C:', detail: '39.8 万个文件 · 58 秒', amount: '441 GB', undo: '', items: [] },
];
const KIND: Record<Kind, [string, string, string]> = { clean: ['清理', 'var(--l1)', 'none'], move: ['迁移', 'var(--l4)', 'inset 0 0 0 1px var(--line-2)'], rule: ['整理', 'var(--l2)', 'none'], scan: ['扫描', 'var(--line-2)', 'none'] };
const FILTERS: [Kind | 'all', string][] = [['all', '全部'], ['clean', '清理'], ['move', '迁移'], ['rule', '整理'], ['scan', '扫描']];

export function Activity() {
  const { pushToast } = useShell();
  const [filter, setFilter] = useState<Kind | 'all'>('all');
  const [open, setOpen] = useState<Record<string, boolean>>({ e1: true });
  const [undone, setUndone] = useState<Record<string, boolean>>({});

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
              const un = !!undone[e.id], isOpen = !!open[e.id];
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
                    {!!e.undo && !un && <button type="button" className="link-btn small" onClick={() => { setUndone({ ...undone, [e.id]: true }); pushToast({ kind: 'ok', title: '已' + e.undo.replace(/^撤销.*/, '撤销'), sub: e.title }, 5000); }}>{e.undo}</button>}
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
