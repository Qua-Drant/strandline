import { useState } from 'react';
import { cx } from '../lib/util';
import { Modal, PageHeader } from '../shell/parts';
import { useEscape, useShell } from '../shell/store';

type Sched = 'new' | 'day' | 'week' | 'month';
interface Rule { id: string; name: string; on: boolean; sched: Sched; lv: string; do: string; when: [string, string][]; last: string; files: [string, number][] }

const RULES: Rule[] = [
  { id: 'r1', name: '安装包装好 30 天后移入回收站', on: true, sched: 'day', lv: 'L2', do: '移入回收站 · 可撤销', when: [['位置', '下载'], ['类型', '.exe .msi'], ['早于', '30 天'], ['条件', '对应应用已安装']], last: '今天 09:00 · 3 个文件 · 1.1 GB', files: [['ArcGISPro_32_Setup.exe', 1.9], ['Docker Desktop Installer.exe', 0.56], ['Zoom_6.2.4.exe', 0.12], ['Git-2.47.0-64-bit.exe', 0.07]] },
  { id: 'r2', name: '截图按月归档', on: true, sched: 'new', lv: 'L4', do: '移到 图片\\截图\\年-月', when: [['位置', '桌面、图片'], ['名称包含', '截图 / Screenshot'], ['类型', '.png .jpg']], last: '昨天 18:02 · 6 个文件', files: [['截图 2026-11-20 101233.png', 0.0012], ['截图 2026-11-20 154410.png', 0.0009], ['Screenshot 2026-11-21 093015.png', 0.0021]] },
  { id: 'r3', name: '论文 PDF 归档', on: true, sched: 'new', lv: 'L4', do: '移到 文稿\\文献\\年份', when: [['位置', '下载'], ['类型', '.pdf'], ['名称像', 'arXiv 编号或 DOI']], last: '11月18日 · 4 个文件', files: [['2411.01234v2.pdf', 0.0034], ['10.1016_j.isprsjprs.2025.08.012.pdf', 0.0061]] },
  { id: 'r4', name: '原始影像迁到 D:', on: false, sched: 'week', lv: 'L4', do: '迁移到 D:\\Datasets\\原始数据 · 原处留联接', when: [['位置', '下载、桌面'], ['类型', '.tif .SAFE.zip .tar'], ['大于', '500 MB']], last: '尚未运行', files: [['S2B_MSIL2A_20230805_T50QKM.zip', 1.2], ['DSM_0.5m_tile_07.tif', 0.75]] },
  { id: 'r5', name: '微信文件 90 天后归档到 D:', on: false, sched: 'month', lv: 'L4', do: '迁移到 D:\\WeChat 归档', when: [['位置', '微信收到的文件'], ['早于', '90 天']], last: '尚未运行', files: [['2026-07 至 2026-08 的 214 个文件', 3.8]] },
];
const TPLS: Omit<Rule, 'id' | 'on' | 'last' | 'files'>[] = [
  { name: '桌面文件每周五收进「待整理」', when: [['位置', '桌面'], ['早于', '7 天']], do: '移到 桌面\\待整理', lv: 'L4', sched: 'week' },
  { name: '压缩包解压后 7 天移入回收站', when: [['位置', '下载'], ['类型', '.zip .7z'], ['条件', '已解压']], do: '移入回收站 · 可撤销', lv: 'L2', sched: 'day' },
  { name: '大于 2 GB 的视频迁到 D:', when: [['类型', '.mp4 .mov'], ['大于', '2 GB']], do: '迁移到 D:\\视频 · 原处留联接', lv: 'L4', sched: 'week' },
  { name: '清理空文件夹', when: [['位置', '文稿、下载'], ['条件', '空文件夹']], do: '删除空文件夹 · 可重建', lv: 'L1', sched: 'month' },
];
const SCHED: [Sched, string][] = [['new', '新文件出现时'], ['day', '每天'], ['week', '每周日'], ['month', '每月 1 日']];
const SN = Object.fromEntries(SCHED) as Record<Sched, string>;
const fmt = (g: number) => (g >= 1 ? g.toFixed(1) + ' GB' : g >= 0.01 ? Math.round(g * 1000) + ' MB' : (g * 1000).toFixed(1) + ' MB');

export function Rules() {
  const { task, startTask, pushToast } = useShell();
  const [sel, setSel] = useState('r1');
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [sched, setSched] = useState<Record<string, Sched>>({});
  const [last, setLast] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<Rule[]>([]);
  const [tpl, setTpl] = useState(false);
  useEscape(() => setTpl(false));

  const list = RULES.concat(extra);
  const isOn = (r: Rule) => on[r.id] ?? r.on;
  const sch = (r: Rule) => sched[r.id] || r.sched;
  const cur = list.find((r) => r.id === sel) || list[0];
  const files = cur.files;
  const total = files.reduce((a, f) => a + f[1], 0);

  const runNow = () => {
    const id = cur.id, n = files.length, prev = last[id];
    startTask('运行规则', cur.name, () => {
      setLast((l) => ({ ...l, [id]: '刚刚 · ' + n + ' 个文件' + (total >= 0.5 ? ' · ' + fmt(total) : '') }));
      pushToast({ kind: 'ok', title: '「' + cur.name + '」已运行', sub: n + ' 个文件 · ' + fmt(total), action: '撤销',
        run: () => setLast((l) => { const l2 = { ...l }; if (prev) l2[id] = prev; else delete l2[id]; return l2; }) }, 8000);
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
                      onChange={() => setOn({ ...on, [r.id]: !isOn(r) })} onClick={(e) => e.stopPropagation()} />
                    <span className="tgl-tr" aria-hidden="true" /><span className="tgl-kn" aria-hidden="true" />
                  </span>
                </div>
                <span className="muted small ellipsis">{SN[sch(r)] + ' · ' + r.do}</span>
                <span className="mono muted" style={{ fontSize: '0.6875rem' }}>{last[r.id] || r.last}</span>
              </div>
            ))}
            <p className="muted" style={{ fontSize: '0.6875rem', padding: '0.75rem', margin: 0 }}>规则只看文件名、类型、大小和时间<br />保存在 %APPDATA%\Strandline\rules.json · v12</p>
          </div>
          <i className="sbt" aria-hidden="true" />
        </div>
        <div className="sbw" style={{ ['--sbh' as string]: '72px' }}>
          <section className="rl-detail sbs" aria-labelledby="rl-t">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}><h2 id="rl-t" style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>{cur.name}</h2><span className="tok">{isOn(cur) ? '已启用' : '未启用'}</span></div>
            <div className="rl-sec"><span className="rl-k">当</span><div className="toks">{cur.when.map(([k, v]) => <span key={k} className="tok"><b>{k}</b>{v}</span>)}</div></div>
            <div className="rl-sec"><span className="rl-k">就</span><span className="act" style={{ color: 'var(--ink)' }}><span className={'sw10 sw-' + cur.lv} />{cur.do}</span></div>
            <div className="rl-sec"><span className="rl-k">何时</span><div className="fchips">
              {SCHED.map(([k, label]) => <button key={k} type="button" className="fchip" aria-pressed={sch(cur) === k} onClick={() => setSched({ ...sched, [cur.id]: k })}>{label}</button>)}
            </div></div>
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
              <h3 className="sec-t">预览下次运行<span className="grow-1" /><span className="mono">{files.length ? files.length + ' 个文件 · ' + fmt(total) : '暂时没有符合条件的文件'}</span></h3>
              {files.map(([name, g]) => <div key={name} className="tr" style={{ ['--cols' as string]: 'minmax(0, 1fr) auto', padding: 0 }}><span className="ellipsis">{name}</span><span className="mono muted small">{fmt(g)}</span></div>)}
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
            {TPLS.map((t, i) => (
              <button key={t.name} type="button" className="tpl" onClick={() => {
                const id = 'n' + (extra.length + 1) + '_' + i;
                setExtra(extra.concat([{ ...t, id, on: false, last: '尚未运行', files: [] }])); setSel(id); setTpl(false);
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
