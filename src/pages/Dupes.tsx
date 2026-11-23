import { useState } from 'react';
import { sound } from '../lib/sound';
import { cx, shortHead } from '../lib/util';
import { PageHeader, Scroll, Seg } from '../shell/parts';
import { useShell } from '../shell/context';
import { diskService } from '../services/diskService';
import type { DupGroup, Receipt } from '../services/types';
import { useData } from '../services/useData';
import { skippedToast } from '../services/receipts';

type Group = DupGroup;

const fmt = (g: number) => (g >= 1 ? g.toFixed(1) + ' GB' : Math.round(g * 1000) + ' MB');
const PLACES: [string, string, RegExp][] = [['wx', '微信收到的文件', /FileStorage/], ['dl', '下载', /Downloads/], ['dt', '桌面', /Desktop/], ['ds', '数据集', /Datasets/], ['doc', '文稿', /Documents/]];
const PLACE = (d: string): [string, string] => { const p = PLACES.find((x) => x[2].test(d)); return p ? [p[0], p[1]] : ['other', '其他']; };
const SUB = (d: string) => { const p = d.split('\\'); return p[p.length - 1]; };
const EXT = (n: string) => n.split('.').pop()!.toUpperCase();
const PNAME = (d: string) => { const p = PLACE(d); return p[1] + (p[0] === 'wx' || p[0] === 'other' || /^(Desktop|Downloads|Documents|Datasets)$/.test(SUB(d)) ? '' : ' › ' + SUB(d)); };
/** Paper-stack shadow: one offset sheet per extra copy, up to three. */
const STACK = (n: number) => { const out: string[] = []; for (let i = 1; i < Math.min(n, 4); i++) out.push(`${i * 3}px ${-i * 3}px 0 -1px var(--surface)`, `${i * 3}px ${-i * 3}px 0 0 var(--line-2)`); return out.length ? out.join(', ') : 'none'; };
/** Round to one decimal so the parts still add up to the rounded total. */
const round1 = (vals: number[]) => {
  const tot = Math.round(vals.reduce((a, v) => a + v, 0) * 10), fl = vals.map((v) => Math.floor(v * 10 + 1e-9));
  let left = tot - fl.reduce((a, v) => a + v, 0);
  vals.map((v, i) => [v * 10 - fl[i], i] as const).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { fl[i] += 1; left -= 1; } });
  return fl.map((v) => (v / 10).toFixed(1));
};

type Rule = 'docs' | 'old' | 'new';
const RULE_NOTE: Record<Rule, string> = { docs: '优先留下「文稿」和数据集里的那份', old: '留下最早出现的那份，后来的复制和转存算副本', new: '留下最新的那份，早先的算副本' };

export function Dupes() {
  const { pushToast, refreshDrives, sys } = useShell();
  const [rule, setRule] = useState<Rule>('docs');
  const [keep, setKeep] = useState<Record<string, number>>({});
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [groups, reload] = useData(() => diskService.findDuplicates(sys.id), sys.id);
  const GROUPS = groups ?? [];
  const done = !!receipt;
  const [place, setPlace] = useState<string | null>(null);

  const keepOf = (g: Group) => {
    if (keep[g.id] !== undefined) return keep[g.id];
    const idx = g.copies.map((_, i) => i);
    if (rule === 'docs') { const d = idx.find((i) => /Documents\\(?!WeChat)/.test(g.copies[i].dir) || /Datasets/.test(g.copies[i].dir)); if (d !== undefined) return d; }
    const byDate = idx.slice().sort((a, b) => (g.copies[a].date < g.copies[b].date ? -1 : 1));
    return rule === 'new' ? byDate[byDate.length - 1] : byDate[0];
  };

  const reclaim = GROUPS.reduce((a, g) => a + g.each * (g.copies.length - 1), 0);
  const nCopies = GROUPS.reduce((a, g) => a + g.copies.length - 1, 0);
  const pl: Record<string, { k: string; label: string; gb: number; n: number }> = {};
  GROUPS.forEach((g) => { const k = keepOf(g); g.copies.forEach((c, i) => { if (i === k) return; const p = PLACE(c.dir); pl[p[0]] ??= { k: p[0], label: p[1], gb: 0, n: 0 }; pl[p[0]].gb += g.each; pl[p[0]].n += 1; }); });
  const plist = Object.values(pl).sort((a, b) => b.gb - a.gb), shown = round1(plist.map((p) => p.gb));
  const visG = GROUPS.filter((g) => !place || g.copies.some((c, i) => i !== keepOf(g) && PLACE(c.dir)[0] === place));
  const setKeepFor = (g: Group, i: number) => setKeep((kk) => ({ ...kk, [g.id]: i }));

  const undo = async () => {
    if (receipt) await diskService.undoReceipt(receipt.id);
    setReceipt(null); await reload(); await refreshDrives();
  };
  const run = async () => {
    const rc = await diskService.recycleDuplicates(GROUPS.map((g) => ({ groupId: g.id, keep: keepOf(g) })));
    setReceipt(rc); await reload(); await refreshDrives();
    sound.wash(false, 460);
    pushToast({ kind: 'ok', title: rc.items.length + ' 份副本已移入回收站', sub: rc.bin.toFixed(1) + ' GB · 清空回收站后释放', action: '撤销', run: () => void undo() }, 8000);
    skippedToast(rc, pushToast);
  };

  return (
    <>
      <PageHeader crumb={[sys.id + ' 盘', '重复文件']} />
      <Scroll className="pg lp dpx">
        <section className="collate" aria-label="重复文件概况">
          <div className="co-n"><span className="mono">{done ? '0.0' : reclaim >= 1 ? reclaim.toFixed(1) : Math.round(reclaim * 1024)}</span><span className="u">{reclaim >= 1 || done ? 'GB' : 'MB'}</span>
            <span className="co-s"><span>{GROUPS.length} 组完全相同的文件</span><span>每组留一份原件，其余 {done ? 0 : nCopies} 份副本移入回收站</span></span></div>
          <div className="co-src" role="group" aria-label="多出来的副本从哪来，点选只看这一处">
            <button type="button" className={cx('pile pile-all', !place && 'is-on')} aria-pressed={!place} onClick={() => setPlace(null)}>
              <span className="pile-n">全部来源</span><span className="pile-s mono">{done ? 0 : nCopies} 份 · {done ? '0.0' : reclaim.toFixed(1)} GB</span>
            </button>
            {!done && plist.map((p, i) => (
              <button key={p.k} type="button" className={cx('pile', place === p.k && 'is-on')} aria-pressed={place === p.k} onClick={() => setPlace(place === p.k ? null : p.k)}>
                <span className="pile-g" aria-hidden="true" style={{ boxShadow: STACK(p.n) }} /><span className="pile-n">{p.label}</span><span className="pile-s mono">{p.n} 份 · {shown[i]} GB</span>
              </button>
            ))}
          </div>
        </section>
        <div className="ltool dp-tool">
          <span className="ltool-k">每组留下</span>
          <Seg className="seg seg-wide" label="每组保留哪一份" value={rule} onPick={(r) => { setRule(r); setKeep({}); }} items={[['docs', '「文稿」里的'], ['old', '最早的'], ['new', '最新的']]} />
          <span className="ltool-n">{RULE_NOTE[rule]}；点任一份副本可以把它设为原件</span>
        </div>
        {!done && visG.map((g) => {
          const k = keepOf(g), kc = g.copies[k];
          return (
            <section key={g.id} className="pair" aria-label={g.name}>
              <div className="pair-h"><span className="ftype">{EXT(g.name)}</span><b>{g.name}</b><span className="szchip mono">{fmt(g.each)} × {g.copies.length}</span><span className="grow-1" /><span className="dgx-s">副本移入回收站 <b className="mono">{fmt(g.each * (g.copies.length - 1))}</b></span></div>
              <div className="pair-b">
                <label className="orig">
                  <span className="o-k"><span className="rdx"><input type="radio" className="rdx-in" name={g.id} aria-label={'原件：' + PNAME(kc.dir)} checked readOnly /><span className="rdx-ring" aria-hidden="true"><i /></span></span>原件 · 留下</span>
                  <span className="o-pl">{PNAME(kc.dir)}</span><span className="path o-p"><span>{shortHead(kc.dir + '\\', 64)}</span><span /></span><span className="o-d mono">{kc.date}</span>
                </label>
                <div className="ghosts"><span className="g-k">副本 · {g.copies.length - 1} 份移入回收站</span>
                  {g.copies.map((c, i) => ({ c, i })).filter((x) => x.i !== k).map(({ c, i }) => (
                    <label key={i} className={cx('ghost', place && PLACE(c.dir)[0] === place && 'is-hit')}>
                      <span className="rdx"><input type="radio" className="rdx-in" name={g.id} aria-label={'改为保留 ' + PNAME(c.dir) + ' 这一份'} checked={false} onChange={() => setKeepFor(g, i)} /><span className="rdx-ring" aria-hidden="true"><i /></span></span>
                      <span className="gh-m"><span className="gh-pl">{PNAME(c.dir)}</span><span className="path gh-p"><span>{shortHead(c.dir + '\\', 56)}</span><span /></span></span>
                      <span className="gh-d mono">{c.date}</span><span className="gh-sw">设为原件</span>
                    </label>
                  ))}
                </div>
              </div>
            </section>
          );
        })}
        {!done && groups === null && <div className="muted" style={{ padding: '3rem 0', textAlign: 'center' }}>正在按大小、局部哈希、全量哈希比对文件…</div>}
        {!done && groups !== null && !GROUPS.length && <div className="muted" style={{ padding: '3rem 0', textAlign: 'center' }}>没有发现完全相同的文件</div>}
        {done && (
          <div style={{ display: 'grid', justifyItems: 'center', gap: '0.5rem', padding: '3rem 0' }} className="muted">
            <span>{receipt!.items.length} 份副本已移入回收站 · {receipt!.bin.toFixed(1)} GB，清空回收站后释放</span>
            <button type="button" className="link-btn" onClick={() => void undo()}>撤销</button>
          </div>
        )}
        <div className="dockw"><div className={cx('dock', !done && 'is-active')} role="region" aria-label="操作">
          <span className="dk-sel"><b>{done ? '没有待处理的重复文件' : nCopies + ' 份副本 · ' + fmt(reclaim) + ' 移入回收站'}</b><span>{done ? '' : '每组都会留下一份原件'}</span></span>
          <span className="dk-note">清空回收站后才会腾出磁盘空间 · 30 天内可撤销 · 内容按哈希比对，只在本机计算</span>
          <button type="button" className="btn btn-primary" disabled={done || !GROUPS.length} onClick={() => void run()}>移入回收站</button>
        </div></div>
      </Scroll>
    </>
  );
}
