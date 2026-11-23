import { useState } from 'react';
import { sound } from '../lib/sound';
import { cx, shortHead } from '../lib/util';
import { Link } from '../components/Link';
import { PATHS } from '../routes';
import { Cbx, PageHeader, Scroll, Seg } from '../shell/parts';
import { useShell } from '../shell/context';

type FType = 'video' | 'img' | 'model' | 'inst' | 'zip' | 'data' | 'sys';
type Kind = 'map' | 'vm' | 'hiber' | 'copy' | null;
interface BigFile { id: string; name: string; dir: string; gb: number; type: FType; last: string; managed: string; act: string | null; kind: Kind; why: string | null }

const FILES: BigFile[] = [
  { id: 'f0', name: 'docker_data.vhdx', dir: '%LOCALAPPDATA%\\Docker\\wsl\\disk', gb: 38.2, type: 'img', last: '昨天', managed: '由 Docker 管理', act: '在空间地图中清理或迁移', kind: 'map', why: 'Docker 镜像和容器都在这块虚拟磁盘里，需在 Docker 内清理后再压缩' },
  { id: 'f1', name: 'ext4.vhdx', dir: '%LOCALAPPDATA%\\Packages\\CanonicalGroupLimited.Ubuntu\\LocalState', gb: 21.4, type: 'img', last: '今天', managed: '由 WSL 管理', act: '在空间地图中迁移到 D:', kind: 'map', why: 'Ubuntu 子系统的整块磁盘，可以整体迁移到其他盘' },
  { id: 'f2', name: 'pagefile.sys', dir: 'C:\\', gb: 15.0, type: 'sys', last: '—', managed: '系统文件', act: '打开虚拟内存设置', kind: 'vm', why: 'Windows 虚拟内存，系统按需自动管理' },
  { id: 'f3', name: 'hiberfil.sys', dir: 'C:\\', gb: 12.8, type: 'sys', last: '—', managed: '系统文件', act: '关闭休眠可腾出 12.8 GB', kind: 'hiber', why: '休眠功能使用的文件，关闭休眠后会自动删除' },
  { id: 'f4', name: '毕业答辩录像.mov', dir: '%USERPROFILE%\\Documents\\答辩', gb: 6.1, type: 'video', last: '8 个月前', managed: '', act: null, kind: null, why: null },
  { id: 'f5', name: 'ubuntu-24.04-desktop-amd64.iso', dir: '%USERPROFILE%\\Downloads', gb: 5.9, type: 'img', last: '5 个月前', managed: '', act: null, kind: null, why: null },
  { id: 'f6', name: 'sha256-6a0746a1ec1a', dir: '%USERPROFILE%\\.ollama\\models\\blobs', gb: 4.7, type: 'model', last: '3 天前', managed: '由 Ollama 管理', act: '复制 ollama rm 命令', kind: 'copy', why: '本地模型文件，需用 Ollama 自己删除' },
  { id: 'f7', name: 'model-00001-of-00004.safetensors', dir: '%USERPROFILE%\\.cache\\huggingface\\hub\\models--Qwen--Qwen2-7B-Instruct', gb: 3.9, type: 'model', last: '7 个月前', managed: '', act: null, kind: null, why: null },
  { id: 'f8', name: 'model-00002-of-00004.safetensors', dir: '%USERPROFILE%\\.cache\\huggingface\\hub\\models--Qwen--Qwen2-7B-Instruct', gb: 3.9, type: 'model', last: '7 个月前', managed: '', act: null, kind: null, why: null },
  { id: 'f9', name: '组会录屏_2026-09.mp4', dir: '%USERPROFILE%\\Documents\\WeChat Files\\wxid_…\\FileStorage\\Video', gb: 3.4, type: 'video', last: '2 个月前', managed: '', act: null, kind: null, why: null },
  { id: 'f10', name: 'cuda_12.4.0_windows.exe', dir: '%USERPROFILE%\\Downloads', gb: 3.1, type: 'inst', last: '6 个月前', managed: '', act: null, kind: null, why: null },
  { id: 'f11', name: 'ArcGISPro_backup_2025.zip', dir: '%USERPROFILE%\\Documents\\Backup', gb: 2.6, type: 'zip', last: '1 年前', managed: '', act: null, kind: null, why: null },
  { id: 'f12', name: 'LC09_L2SP_123032_20240611_T1.tar', dir: '%USERPROFILE%\\Datasets\\Landsat-9', gb: 1.8, type: 'data', last: '4 个月前', managed: '', act: null, kind: null, why: null },
  { id: 'f13', name: 'S2B_MSIL2A_20230805_T50QKM.zip', dir: '%USERPROFILE%\\Datasets\\Sentinel-2', gb: 1.2, type: 'data', last: '1 个月前', managed: '', act: null, kind: null, why: null },
];
const TYPES: [FType | 'all', string][] = [['all', '全部'], ['video', '视频'], ['img', '磁盘镜像'], ['model', '模型'], ['inst', '安装包'], ['zip', '压缩包'], ['data', '数据'], ['sys', '系统文件']];
const TN = Object.fromEntries(TYPES) as Record<FType | 'all', string>;
const HREF: Partial<Record<NonNullable<Kind>, string>> = { map: PATHS.map, hiber: PATHS.suggest };

/** Months since last opened; system files are always in use (0). */
function months(t: string): number {
  if (!t || t === '—' || t === '今天') return 0;
  if (t === '昨天') return 0.03;
  let m = t.match(/(\d+) 天前/); if (m) return +m[1] / 30;
  m = t.match(/(\d+) 个月前/); if (m) return +m[1];
  m = t.match(/(\d+) 年前/); if (m) return +m[1] * 12;
  return 0;
}
const XP = (mo: number) => 4 + 88 * Math.log(1 + mo) / Math.log(1 + 14);
const ZZ = [1, 2, 4, 6, 9, 12];
const gbOf = (arr: BigFile[]) => arr.reduce((a, f) => a + f.gb, 0);

const Lock = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"><rect x="3.25" y="7" width="9.5" height="6.75" rx="1.5" /><path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" /></svg>
);

export function Large() {
  const { pushToast } = useShell();
  const [type, setType] = useState<FType | 'all'>('all');
  const [th, setTh] = useState(1);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [gone, setGone] = useState<Record<string, boolean>>({});
  const [hf, setHf] = useState<string | null>(null);
  const [sort, setSort] = useState<'size' | 'old' | 'both'>('size');

  const inTh = FILES.filter((f) => f.gb >= th && !gone[f.id]);
  const freeAll = inTh.filter((f) => !f.managed), lockAll = inTh.filter((f) => f.managed);
  const sorter = sort === 'size' ? (a: BigFile, b: BigFile) => b.gb - a.gb
    : sort === 'old' ? (a: BigFile, b: BigFile) => months(b.last) - months(a.last) || b.gb - a.gb
      : (a: BigFile, b: BigFile) => b.gb * (1 + months(b.last)) - a.gb * (1 + months(a.last));
  const vis = freeAll.filter((f) => type === 'all' || f.type === type).sort(sorter);
  const sel = freeAll.filter((f) => checked[f.id]);
  const freeG = gbOf(freeAll), lockG = gbOf(lockAll), selG = gbOf(sel);
  const tl = TYPES.slice(1).map(([k, l]) => ({ k, l, gb: gbOf(freeAll.filter((f) => f.type === k)) })).filter((t) => t.gb > 0);
  const fmax = Math.max(0.01, ...vis.map((f) => f.gb));
  const tog = (f: BigFile) => () => { if (!f.managed) setChecked((c) => ({ ...c, [f.id]: !c[f.id] })); };
  const unhov = () => setHf(null);

  // Rocks on the shore: x = how long unopened (log), area = size; stacked a little when they would overlap.
  const placed: { x: number; y: number; h: number; d: number }[] = [];
  const rocks = inTh.slice().sort((a, b) => b.gb - a.gb).map((f) => {
    const d = 16 + Math.sqrt(f.gb) * 9.5, h = d * 0.68, x0 = XP(months(f.last)), W = 11.2;
    const clash = (x: number) => placed.some((p) => p.y === 0 && Math.abs(p.x - x) * W < (p.d + d) / 2 * 0.78);
    let x = x0, y = 0;
    while (clash(x) && x < x0 + 9) x += 0.5;
    if (clash(x)) { x = x0; placed.forEach((p) => { if (Math.abs(p.x - x) * W < (p.d + d) / 2 && y <= p.y + p.h * 0.6) y = p.y + p.h * 0.6; }); }
    placed.push({ x, y, h, d });
    const aria = f.name + ' · ' + f.gb.toFixed(1) + ' GB · ' + (f.last === '—' ? '系统常驻' : f.last + '打开') + (f.managed ? ' · ' + f.managed : '');
    return { f, x, y, d, h, aria };
  });

  const recycle = () => {
    const ids = sel.map((f) => f.id), g = { ...gone };
    ids.forEach((id) => { g[id] = true; });
    setGone(g); setChecked({});
    sound.wash(false, 460);
    pushToast({ kind: 'ok', title: ids.length + ' 个文件已移入回收站', sub: selG.toFixed(1) + ' GB · 清空回收站后才会腾出', action: '撤销',
      run: () => setGone((g2) => { const n = { ...g2 }; ids.forEach((id) => { delete n[id]; }); return n; }) }, 8000);
  };
  const runLocked = (f: BigFile) => {
    if (f.kind === 'copy') {
      navigator.clipboard?.writeText('ollama list && ollama rm qwen2:7b').catch(() => { /* clipboard may be blocked */ });
      pushToast({ kind: 'ok', title: '已复制命令', sub: 'ollama list && ollama rm qwen2:7b — 先确认模型名' }, 4000);
    } else pushToast({ kind: 'ok', title: '已打开 Windows 虚拟内存设置', sub: '系统 › 高级系统设置 › 性能 › 虚拟内存' }, 4000);
  };

  return (
    <>
      <PageHeader crumb={['C 盘', '大文件']}>
        <Seg label="大小下限" value={th} onPick={(t) => { setTh(t); setChecked({}); }} items={[[1, '≥ 1 GB'], [5, '≥ 5 GB'], [10, '≥ 10 GB']]} />
      </PageHeader>
      <Scroll className="pg lp">
        <section className="shore-card" aria-labelledby="sh-t">
          <div className="sh-h"><h2 id="sh-t" className="wx-k">称一称 · 越大越重，越靠右越久没打开</h2><span className="sh-sum"><b className="mono">{(freeG + lockG).toFixed(1)}</b> GB · {inTh.length} 个，其中 <b className="mono">{freeG.toFixed(1)}</b> GB 可以处理</span></div>
          <div className="shore" onMouseLeave={unhov}>
            <span className="sh-sleep" aria-hidden="true"><span>沉睡区 · 半年以上没打开</span></span>
            <span className="sh-line" aria-hidden="true" />
            {rocks.map(({ f, x, y, d, h, aria }) => (
              <button key={f.id} type="button"
                className={cx('rock', f.managed && 'is-lock', checked[f.id] && 'is-on', hf === f.id && 'is-hov', type !== 'all' && f.type !== type && 'is-dim', months(f.last) >= 6 && 'is-old')}
                style={{ left: x.toFixed(2) + '%', bottom: (y + 18).toFixed(0) + 'px', width: d.toFixed(0) + 'px', height: h.toFixed(0) + 'px' }}
                aria-label={aria} title={aria} onMouseEnter={() => setHf(f.id)} onClick={tog(f)} aria-disabled={!!f.managed}>
                {f.gb >= 5 && <span className="mono">{f.gb.toFixed(1)}</span>}
              </button>
            ))}
            <div className="sh-ax" aria-hidden="true"><span style={{ left: '4%' }}>今天 / 常驻</span><span style={{ left: XP(1).toFixed(1) + '%' }}>1 个月</span><span style={{ left: XP(6).toFixed(1) + '%' }}>半年</span><span style={{ left: XP(12).toFixed(1) + '%' }}>1 年</span></div>
          </div>
          <div className="sh-leg"><span><i className="rk-sw" />可以处理，点石头即可选中</span><span><i className="rk-sw lock" />由应用或系统管理</span><span className="grow-1" /><span>石头面积 ∝ 文件大小</span></div>
        </section>
        <div className="ltool">
          <div className="fchips" role="group" aria-label="按类型筛选可以处理的文件">
            {[{ k: 'all' as const, l: '全部', gb: freeG }, ...tl].map((t) => (
              <button key={t.k} type="button" className="fchip" aria-pressed={type === t.k} onClick={() => setType(t.k)}>{t.l}<span className="mono">{t.gb.toFixed(1)}</span></button>
            ))}
          </div>
          <span className="grow-1" />
          <Seg label="排序" value={sort} onPick={setSort} items={[['size', '最重'], ['old', '最久没开'], ['both', '又大又久']]} />
        </div>
        {vis.length > 0 && (
          <section className="ladder wl" aria-label="可以处理的文件">
            {vis.map((f) => {
              const mo = months(f.last);
              return (
                <div key={f.id} className={cx('lr', checked[f.id] && 'is-on', hf === f.id && 'is-hov', mo >= 6 && 'is-sleep')} onClick={tog(f)} onMouseEnter={() => setHf(f.id)} onMouseLeave={unhov}>
                  <Cbx label={f.name} checked={!!checked[f.id]} onChange={tog(f)} />
                  <span className="lr-m"><span className="lr-n"><span className="ftype">{TN[f.type]}</span><b>{f.name}</b></span><span className="path lr-p"><span>{shortHead(f.dir + '\\', 60)}</span><span /></span></span>
                  <span className="sleep" title={f.last + '没打开'}><span className="zz" aria-hidden="true">{ZZ.map((t) => <i key={t} className={mo >= t ? (t >= 6 ? 'on old' : 'on') : ''} />)}</span><span className="sl-t">{f.last}</span></span>
                  <span className="wt" aria-hidden="true"><i style={{ inlineSize: (f.gb / fmax * 100).toFixed(1) + '%' }} /></span>
                  <span className="lr-sz"><span className="mono">{f.gb.toFixed(1)}</span><span>GB</span></span>
                </div>
              );
            })}
          </section>
        )}
        {!vis.length && <div className="muted" style={{ padding: '2rem', textAlign: 'center' }}>这个范围里没有可以处理的大文件</div>}
        {lockAll.length > 0 && (
          <section className="ladder is-managed" aria-labelledby="lg-m">
            <h2 id="lg-m" className="ld-h"><span className="lk" aria-hidden="true"><Lock /></span>由应用或系统管理<span className="mono">{lockAll.length} 个 · {lockG.toFixed(1)} GB</span><span className="ld-d">不能直接删除，需要回到各自的应用里处理</span></h2>
            {lockAll.map((f) => (
              <div key={f.id} className={cx('lr is-locked', hf === f.id && 'is-hov')} onMouseEnter={() => setHf(f.id)} onMouseLeave={unhov}>
                <span className="lk" aria-hidden="true"><Lock /></span>
                <span className="lr-m"><span className="lr-n"><span className="ftype">{TN[f.type]}</span><b>{f.name}</b><span className="mtag">{f.managed === '系统文件' ? '由 Windows 管理' : f.managed}</span></span><span className="lr-why">{f.why}</span></span>
                <span className="lr-sz"><span className="mono">{f.gb.toFixed(1)}</span><span>GB</span></span>
                {f.kind === 'map' || f.kind === 'hiber'
                  ? <Link className="lr-go" to={HREF[f.kind] ?? PATHS.map}>{f.act} →</Link>
                  : <button type="button" className="lr-go" onClick={() => runLocked(f)}>{f.act}</button>}
              </div>
            ))}
          </section>
        )}
        <div className="dockw"><div className={cx('dock', sel.length > 0 && 'is-active')} role="region" aria-label="操作">
          <span className="dk-sel"><b>{sel.length ? '已选 ' + sel.length + ' 个 · ' + selG.toFixed(1) + ' GB' : '点选不再需要的文件'}</b><span>{sel.length ? '还有 ' + (freeG - selG).toFixed(1) + ' GB 可以处理' : '可以处理的共 ' + freeG.toFixed(1) + ' GB'}</span></span>
          <span className="dk-note">移入回收站 · 清空回收站后才会腾出磁盘空间 · 30 天内可撤销</span>
          {sel.length > 0 && <button type="button" className="link-btn small" onClick={() => setChecked({})}>取消选择</button>}
          <button type="button" className="btn btn-primary" disabled={!sel.length} onClick={recycle}>{sel.length ? '移入回收站 ' + sel.length + ' 个' : '移入回收站'}</button>
        </div></div>
      </Scroll>
    </>
  );
}
