import { useState } from 'react';
import { cx } from '../lib/util';
import { Modal, PageHeader } from '../shell/parts';
import { useEscape, useShell } from '../shell/context';
import { diskService } from '../services/diskService';
import type { Rule, Sched } from '../services/types';
import { useData } from '../services/useData';

const SCHED: [Sched, string][] = [['new', '新文件出现时'], ['day', '每天'], ['week', '每周日'], ['month', '每月 1 日']];
const SN = Object.fromEntries(SCHED) as Record<Sched, string>;
const fmt = (g: number) => (g >= 1 ? g.toFixed(1) + ' GB' : g >= 0.01 ? Math.round(g * 1000) + ' MB' : (g * 1000).toFixed(1) + ' MB');

export function Rules() {
  const { task, startTask, pushToast } = useShell();
  const [sel, setSel] = useState('r1');
  const [tpl, setTpl] = useState(false);
  const [rules, reload] = useData(() => diskService.listRules());
  const [TPLS] = useData(() => diskService.ruleTemplates());
  useEscape(() => setTpl(false));

  const list = rules ?? [];
  const cur = list.find((r) => r.id === sel) || list[0];
  const [preview] = useData(() => (cur ? diskService.dryRunRule(cur.id) : Promise.resolve(null)), (cur?.id ?? '') + ':' + (cur?.last ?? ''));
  if (!cur) return <PageHeader crumb={['整理规则']} />;
  const isOn = (r: Rule) => r.on;
  const sch = (r: Rule) => r.sched;
  const last = {} as Record<string, string>;
  const files = preview?.files ?? cur.files;
  const total = files.reduce((a, f) => a + f[1], 0);
  const builtin = cur.id === 'r1' || cur.id === 'r2' || cur.id === 'r3';
  const update = async (r: Rule, patch: Partial<Rule>) => { await diskService.saveRule({ ...r, ...patch }); await reload(); };
  const removeCur = async () => {
    try {
      await diskService.deleteRule(cur.id);
      await reload();
      setSel('r1');
      pushToast({ kind: 'ok', title: '已删除规则「' + cur.name + '」' }, 3000);
    } catch (e) { pushToast({ kind: 'err', title: '无法删除规则', sub: String(e) }, 5000); }
  };

  const runNow = () => {
    const name = cur.name;
    const job = diskService.runRule(cur.id);
    startTask('运行规则', name, async () => {
      try {
        const { run, receiptId } = await job;
        await reload();
        pushToast({ kind: 'ok', title: '「' + name + '」已运行', sub: run.n + ' 个文件 · ' + fmt(run.gb), action: '撤销',
          run: async () => { await diskService.undoReceipt(receiptId); await reload(); } }, 8000);
      } catch (e) { pushToast({ kind: 'err', title: '「' + name + '」没有运行', sub: String(e) }, 8000); }
    });
  };

  return (
    <>
      <PageHeader crumb={['整理规则']}>
        <button type="button" className="btn btn-sm" onClick={() => setTpl(true)}>新建规则</button>
      </PageHeader>
      <div className="rules">
        <div className="sbw" style={{ ['--sbh' as string]: '72px', borderInlineEnd: '1px solid var(--line)' }}>
          <div className="rl-list sbs" role="listbox" aria-label="规则">
            {list.map((r) => (
              <div key={r.id} className={cx('rl', r.id === cur.id && 'is-sel', !isOn(r) && 'is-off')} role="option" aria-selected={r.id === cur.id} onClick={() => setSel(r.id)}>
                <div className="rl-top">
                  <span className="rl-n ellipsis">{r.name}</span>
                  <span className="tgl">
                    <input type="checkbox" role="switch" className="tgl-in" aria-label={'启用 ' + r.name} checked={isOn(r)}
                      onChange={() => void update(r, { on: !isOn(r) })} onClick={(e) => e.stopPropagation()} />
                    <span className="tgl-tr" aria-hidden="true" /><span className="tgl-kn" aria-hidden="true" />
                  </span>
                </div>
                <span className="muted small ellipsis">{SN[sch(r)] + ' · ' + r.do}</span>
                <span className="mono muted" style={{ fontSize: '0.6875rem' }}>{last[r.id] || r.last}</span>
              </div>
            ))}
            <p className="muted" style={{ fontSize: '0.6875rem', padding: '0.75rem', margin: 0 }}>规则只看文件名、类型、大小和时间<br />保存在 %APPDATA%\Strandline\strandline.json</p>
          </div>
          <i className="sbt" aria-hidden="true" />
        </div>
        <div className="sbw" style={{ ['--sbh' as string]: '72px' }}>
          <section className="rl-detail sbs" aria-labelledby="rl-t">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <h2 id="rl-t" style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>{cur.name}</h2>
              <span className="tok">{isOn(cur) ? '已启用' : '未启用'}</span>
              <span className="grow-1" />
              {!builtin && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void removeCur()}>删除规则</button>}
            </div>
            <div className="rl-sec"><span className="rl-k">当</span><div className="toks">{cur.when.map(([k, v]) => <span key={k} className="tok"><b>{k}</b>{v}</span>)}</div></div>
            <div className="rl-sec"><span className="rl-k">就</span><span className="act" style={{ color: 'var(--ink)' }}><span className={'sw10 sw-' + cur.lv} />{cur.do}</span></div>
            <div className="rl-sec"><span className="rl-k">何时</span><div className="fchips">
              {SCHED.map(([k, label]) => <button key={k} type="button" className="fchip" aria-pressed={sch(cur) === k} onClick={() => void update(cur, { sched: k })}>{label}</button>)}
            </div></div>
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
              <h3 className="sec-t">预览下次运行<span className="grow-1" /><span className="mono">{files.length ? files.length + ' 个文件 · ' + fmt(total) : '暂时没有符合条件的文件'}</span></h3>
              {files.map(([name, g], idx) => <div key={name + ':' + idx} className="tr" style={{ ['--cols' as string]: 'minmax(0, 1fr) auto', padding: 0 }}><span className="ellipsis">{name}</span><span className="mono muted small">{fmt(g)}</span></div>)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button type="button" className="btn btn-primary" disabled={!!task} onClick={runNow}>立即运行</button>
              <span className="muted small">{/迁移/.test(cur.do) ? '迁移在后台进行，可以继续使用电脑' : /回收站/.test(cur.do) ? '移入回收站，30 天内可撤销' : '移动后可在「活动」里撤销'}</span>
            </div>
          </section>
          <i className="sbt" aria-hidden="true" />
        </div>
      </div>
      {tpl && (
        <Modal onClose={() => setTpl(false)}>
          <section className="dlg" role="dialog" aria-modal="true" aria-labelledby="tpl-t">
            <h2 id="tpl-t" style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>从模板新建规则</h2>
            <p className="muted small" style={{ margin: '-0.5rem 0 0' }}>新规则默认不启用，看过预览再打开。</p>
            {(TPLS ?? []).map((t, i) => (
              <button key={t.name} type="button" className="tpl" onClick={async () => {
                const id = 'n' + Date.now().toString(36) + '_' + i;
                await diskService.saveRule({ ...t, id, on: false, last: '尚未运行', files: [] }); await reload(); setSel(id); setTpl(false);
              }}>
                <span style={{ fontWeight: 500 }}>{t.name}</span><span className="muted small">{t.when.map(([k, v]) => k + ' ' + v).join(' · ') + ' → ' + t.do}</span>
              </button>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" className="btn" autoFocus onClick={() => setTpl(false)}>取消</button></div>
          </section>
        </Modal>
      )}
    </>
  );
}
