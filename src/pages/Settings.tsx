import { useState, type ReactNode } from 'react';
import { sound } from '../lib/sound';
import { PageHeader, Scroll } from '../shell/parts';
import { useShell, type Theme } from '../shell/context';
import { diskService } from '../services/diskService';
import type { Settings as SettingsData } from '../services/types';
import { useData } from '../services/useData';

const SWD = { autostart: true, sound: false, daily: true, recycleFirst: true, checkRunning: true, skipInUse: true, low: true, weekly: false, inst: true };
type SwKey = keyof typeof SWD;
const SECS: [string, string][] = [['set-general', '通用'], ['set-scan', '扫描'], ['set-safety', '清理与安全'], ['set-remind', '提醒'], ['set-privacy', '隐私'], ['set-about', '关于']];

function Toggle({ id, on, onChange }: { id: string; on: boolean; onChange: () => void }) {
  return (
    <span className="tgl">
      <input id={id} type="checkbox" role="switch" className="tgl-in" checked={on} onChange={onChange} />
      <span className="tgl-tr" aria-hidden="true" /><span className="tgl-kn" aria-hidden="true" />
    </span>
  );
}

function Chips<V extends string>({ label, items, value, onPick }: { label: string; items: [V, string][]; value: V; onPick: (v: V) => void }) {
  return (
    <div className="fchips" role="group" aria-label={label}>
      {items.map(([v, l]) => <button key={v} type="button" className="fchip" aria-pressed={value === v} onClick={() => onPick(v)}>{l}</button>)}
    </div>
  );
}

/** One settings row: title + description on the left, control on the right. */
function Kv({ title, desc, htmlFor, children, top, mono }: { title: string; desc: ReactNode; htmlFor?: string; children: ReactNode; top?: boolean; mono?: boolean }) {
  return (
    <div className="kv" style={top ? { alignItems: 'start' } : undefined}>
      <div>{htmlFor ? <label htmlFor={htmlFor}>{title}</label> : <span>{title}</span>}<div className={mono ? 'd mono' : 'd'}>{desc}</div></div>
      {children}
    </div>
  );
}

export function Settings() {
  const { theme, setTheme, pushToast } = useShell();
  const [sec, setSec] = useState('set-general');
  const [st, reload] = useData(() => diskService.getSettings());
  if (!st) return <PageHeader crumb={['设置']} />;
  const put = async (patch: Partial<SettingsData>) => {
    try { await diskService.saveSettings(patch); } catch (e) { pushToast({ kind: 'err', title: '设置没有保存', sub: String(e) }, 9000); }
    await reload();
  };
  const sw: Record<SwKey, boolean> = { ...SWD, ...Object.fromEntries(Object.keys(SWD).map((k) => [k, st[k as SwKey]])), sound: sound.enabled() } as Record<SwKey, boolean>;
  const { close, bin, drives, excl } = st;
  const setClose = (v: SettingsData['close']) => void put({ close: v });
  const setBin = (v: SettingsData['bin']) => void put({ bin: v });
  const setDrives = (v: Record<string, boolean>) => void put({ drives: v });
  const setExcl = (v: string[]) => void put({ excl: v });

  const tg = (k: SwKey) => () => {
    const v = !sw[k];
    void put({ [k]: v });
    if (k === 'sound') { sound.setEnabled(v); if (v) { sound.click(true); window.setTimeout(() => sound.wash(true, 520), 140); } }
  };
  const T = (k: SwKey) => <Toggle id={'st-' + k} on={sw[k]} onChange={tg(k)} />;
  const jump = (id: string) => { setSec(id); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  return (
    <>
      <PageHeader crumb={['设置']} />
      <Scroll className="pg"><div className="set">
        <nav className="set-nav" aria-label="设置分区">
          {SECS.map(([id, label]) => <a key={id} href={'#' + id} aria-current={sec === id ? 'true' : undefined} onClick={(e) => { e.preventDefault(); jump(id); }}>{label}</a>)}
        </nav>
        <div>
          <section id="set-general" aria-labelledby="h-general"><h2 id="h-general">通用</h2>
            <Kv title="开机时启动" desc="在后台待命，不会自动扫描" htmlFor="st-autostart">{T('autostart')}</Kv>
            <Kv title="轻柔交互音效" desc="极轻的按键微点击声与清理时的沙沙声，由浏览器实时合成，不含任何音频文件" htmlFor="st-sound">{T('sound')}</Kv>
            <Kv title="外观" desc="跟随 Windows 的浅色或深色"><Chips<Theme> label="外观" value={theme} onPick={setTheme} items={[['sys', '跟随系统'], ['light', '浅色'], ['dark', '深色']]} /></Kv>
            <Kv title="关闭窗口时" desc="最小化后仍可在托盘里看进度"><Chips label="关闭窗口时" value={close} onPick={setClose} items={[['tray', '最小化到托盘'], ['quit', '退出']]} /></Kv>
          </section>
          <section id="set-scan" aria-labelledby="h-scan"><h2 id="h-scan">扫描</h2>
            <Kv title="扫描哪些磁盘" desc="只读取文件夹结构和大小">
              <div className="fchips">{['C', 'D', 'E'].map((d) => <button key={d} type="button" className="fchip" aria-pressed={!!drives[d]} onClick={() => setDrives({ ...drives, [d]: !drives[d] })}>{d}:</button>)}</div>
            </Kv>
            <Kv top title="扫描范围" desc={<>
              留空表示扫描整个磁盘。开发与测试时填沙盒目录（例如 D:\01_Research\Strandline\sandbox），所有清理、迁移都只会发生在这里面
              {st.scanRoot && <div className="mono small" style={{ color: 'var(--ink)', marginTop: '0.375rem', overflowWrap: 'anywhere' }}>{st.scanRoot}</div>}
            </>}>
              <span style={{ display: 'inline-flex', gap: '0.375rem' }}>
                {st.scanRoot && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void put({ scanRoot: '' })}>改为整盘</button>}
                <button type="button" className="btn btn-sm" onClick={() => { const p = window.prompt('扫描这个文件夹（完整路径）', st.scanRoot); if (p !== null) void put({ scanRoot: p.trim() }); }}>设置…</button>
              </span>
            </Kv>
            <Kv title="每天快速扫描一次" desc="13:00 左右，电脑空闲时进行，大约 1 分钟" htmlFor="st-daily">{T('daily')}</Kv>
            <Kv top title="不扫描这些文件夹" desc={<>
              正在使用的项目放在这里，清理建议就不会碰它们
              <div style={{ display: 'grid', gap: '0.25rem', marginTop: '0.625rem' }}>
                {excl.map((p, i) => (
                  <div key={p} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className="mono small" style={{ color: 'var(--ink)', overflowWrap: 'anywhere' }}>{p}</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExcl(excl.filter((_, j) => j !== i))}>移除</button>
                  </div>
                ))}
              </div>
            </>}>
              <button type="button" className="btn btn-sm" onClick={() => setExcl(excl.concat(['%USERPROFILE%\\Projects\\thesis-' + (excl.length + 1)]))}>添加文件夹…</button>
            </Kv>
          </section>
          <section id="set-safety" aria-labelledby="h-safety"><h2 id="h-safety">清理与安全</h2>
            <Kv title="不可恢复的操作要再确认一次" desc="清空回收站这类操作，总会先弹出确认，列出将被删除的内容"><span className="lock">始终开启</span></Kv>
            <Kv title="能放进回收站的，先放进回收站" desc="安装包、重复文件、大文件都先进回收站，30 天内可撤销" htmlFor="st-recycleFirst">{T('recycleFirst')}</Kv>
            <Kv title="清理前确认相关程序没有运行" desc="例如清理 Docker 镜像前会先确认 Docker Desktop 已退出" htmlFor="st-checkRunning">{T('checkRunning')}</Kv>
            <Kv title="跳过正在使用的文件" desc="临时文件里正在被占用的会自动跳过" htmlFor="st-skipInUse">{T('skipInUse')}</Kv>
            <Kv title="回收站里的项目保留" desc="到期后由 Windows 清空"><Chips label="回收站里的项目保留" value={bin} onPick={setBin} items={[['30', '30 天'], ['60', '60 天'], ['never', '不自动清空']]} /></Kv>
          </section>
          <section id="set-remind" aria-labelledby="h-remind"><h2 id="h-remind">提醒</h2>
            <Kv title="C: 少于 20 GB 时提醒我" desc="通知里直接给出可腾出多少" htmlFor="st-low">{T('low')}</Kv>
            <Kv title="每周日自动清理「可重建」项" desc="不碰回收站、系统设置和你的文件" htmlFor="st-weekly">{T('weekly')}</Kv>
            <Kv title="安装包装好后提醒我放进回收站" desc="只看「下载」文件夹" htmlFor="st-inst">{T('inst')}</Kv>
          </section>
          <section id="set-privacy" aria-labelledby="h-privacy"><h2 id="h-privacy">隐私</h2>
            <Kv title="本地元数据识别 · 不读取文件内容" desc="判断一个文件夹能不能清理，只用文件名、类型、大小和时间"><span className="lock">始终如此</span></Kv>
            <Kv title="重复文件的哈希只在这台电脑上计算" desc="不上传任何文件、文件名或路径"><span className="lock">始终如此</span></Kv>
            <Kv title="规则和活动记录的位置" desc="%APPDATA%\Strandline" mono>
              <button type="button" className="btn btn-sm" onClick={() => pushToast({ kind: 'ok', title: '已在资源管理器中打开', sub: '%APPDATA%\\Strandline' }, 3000)}>打开文件夹</button>
            </Kv>
          </section>
          <section id="set-about" aria-labelledby="h-about"><h2 id="h-about">关于</h2>
            <Kv title="Strandline 0.10" desc="潮线家族 · 磁盘整理与空间地图">
              <button type="button" className="btn btn-sm" onClick={() => pushToast({ kind: 'ok', title: '已是最新版本', sub: 'Strandline 0.10' }, 3000)}>检查更新</button>
            </Kv>
          </section>
        </div>
      </div></Scroll>
    </>
  );
}
