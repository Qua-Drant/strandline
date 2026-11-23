// Demo data for the large-file, duplicate, rule and activity pages (from the R19 design).
import type { ActivityEvent, BigFile, DupGroup, Grower, Rule, RuleTemplate } from '../../types';

export const FILES: BigFile[] = [
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

export const GROUPS: DupGroup[] = [
  { id: 'g1', name: '毕业答辩录像.mov', each: 6.1, copies: [{ dir: '%USERPROFILE%\\Documents\\答辩', date: '2026-03-02' }, { dir: '%USERPROFILE%\\Documents\\WeChat Files\\wxid_…\\FileStorage\\File\\2026-03', date: '2026-03-03' }] },
  { id: 'g2', name: 'S2B_MSIL2A_20230805_T50QKM.zip', each: 1.2, copies: [{ dir: '%USERPROFILE%\\Datasets\\Sentinel-2', date: '2025-10-01' }, { dir: '%USERPROFILE%\\Downloads', date: '2025-09-30' }] },
  { id: 'g3', name: '论文插图_v3.zip', each: 0.42, copies: [{ dir: '%USERPROFILE%\\Documents\\论文', date: '2026-06-10' }, { dir: '%USERPROFILE%\\Desktop', date: '2026-06-11' }, { dir: '%USERPROFILE%\\Documents\\WeChat Files\\wxid_…\\FileStorage\\File\\2026-06', date: '2026-06-11' }] },
  { id: 'g4', name: 'DSM_0.5m_tile_07.tif', each: 0.75, copies: [{ dir: '%USERPROFILE%\\Datasets\\DSM', date: '2026-02-14' }, { dir: '%USERPROFILE%\\Desktop\\临时', date: '2026-08-20' }] },
  { id: 'g5', name: '组会汇报_2026-10.pptx', each: 0.21, copies: [{ dir: '%USERPROFILE%\\Documents\\组会', date: '2026-10-09' }, { dir: '%USERPROFILE%\\Desktop', date: '2026-10-09' }, { dir: '%USERPROFILE%\\Downloads', date: '2026-10-10' }, { dir: '%USERPROFILE%\\Documents\\WeChat Files\\wxid_…\\FileStorage\\File\\2026-10', date: '2026-10-10' }] },
  { id: 'g6', name: '实验记录汇总.xlsx', each: 0.14, copies: [{ dir: '%USERPROFILE%\\Documents\\实验', date: '2026-07-01' }, { dir: '%USERPROFILE%\\Desktop', date: '2026-09-12' }, { dir: '%USERPROFILE%\\Downloads', date: '2026-09-13' }] },
];

export const RULES: Rule[] = [
  { id: 'r1', name: '安装包装好 30 天后移入回收站', on: true, sched: 'day', lv: 'L2', do: '移入回收站 · 可撤销', when: [['位置', '下载'], ['类型', '.exe .msi'], ['早于', '30 天'], ['条件', '对应应用已安装']], last: '今天 09:00 · 3 个文件 · 1.1 GB', files: [['ArcGISPro_32_Setup.exe', 1.9], ['Docker Desktop Installer.exe', 0.56], ['Zoom_6.2.4.exe', 0.12], ['Git-2.47.0-64-bit.exe', 0.07]] },
  { id: 'r2', name: '截图按月归档', on: true, sched: 'new', lv: 'L4', do: '移到 图片\\截图\\年-月', when: [['位置', '桌面、图片'], ['名称包含', '截图 / Screenshot'], ['类型', '.png .jpg']], last: '昨天 18:02 · 6 个文件', files: [['截图 2026-11-20 101233.png', 0.0012], ['截图 2026-11-20 154410.png', 0.0009], ['Screenshot 2026-11-21 093015.png', 0.0021]] },
  { id: 'r3', name: '论文 PDF 归档', on: true, sched: 'new', lv: 'L4', do: '移到 文稿\\文献\\年份', when: [['位置', '下载'], ['类型', '.pdf'], ['名称像', 'arXiv 编号或 DOI']], last: '11月18日 · 4 个文件', files: [['2411.01234v2.pdf', 0.0034], ['10.1016_j.isprsjprs.2025.08.012.pdf', 0.0061]] },
  { id: 'r4', name: '原始影像迁到 D:', on: false, sched: 'week', lv: 'L4', do: '迁移到 D:\\Datasets\\原始数据 · 原处留联接', when: [['位置', '下载、桌面'], ['类型', '.tif .SAFE.zip .tar'], ['大于', '500 MB']], last: '尚未运行', files: [['S2B_MSIL2A_20230805_T50QKM.zip', 1.2], ['DSM_0.5m_tile_07.tif', 0.75]] },
  { id: 'r5', name: '微信文件 90 天后归档到 D:', on: false, sched: 'month', lv: 'L4', do: '迁移到 D:\\WeChat 归档', when: [['位置', '微信收到的文件'], ['早于', '90 天']], last: '尚未运行', files: [['2026-07 至 2026-08 的 214 个文件', 3.8]] },
];

export const TPLS: RuleTemplate[] = [
  { name: '桌面文件每周五收进「待整理」', when: [['位置', '桌面'], ['早于', '7 天']], do: '移到 桌面\\待整理', lv: 'L4', sched: 'week' },
  { name: '压缩包解压后 7 天移入回收站', when: [['位置', '下载'], ['类型', '.zip .7z'], ['条件', '已解压']], do: '移入回收站 · 可撤销', lv: 'L2', sched: 'day' },
  { name: '大于 2 GB 的视频迁到 D:', when: [['类型', '.mp4 .mov'], ['大于', '2 GB']], do: '迁移到 D:\\视频 · 原处留联接', lv: 'L4', sched: 'week' },
  { name: '清理空文件夹', when: [['位置', '文稿、下载'], ['条件', '空文件夹']], do: '删除空文件夹 · 可重建', lv: 'L1', sched: 'month' },
];

export const EVENTS: ActivityEvent[] = [
  { id: 'e2', day: '今天', time: '13:52', kind: 'scan', title: '扫描 C:', detail: '41.2 万个文件 · 1 分 04 秒', amount: '468 GB', undo: '', items: [] },
  { id: 'e3', day: '今天', time: '09:00', kind: 'rule', title: '规则「安装包装好 30 天后移入回收站」', detail: '3 个文件移入回收站', amount: '1.1 GB', undo: '撤销', items: [['L2', 'ArcGISPro_31_Setup.exe', '0.9 GB'], ['L2', 'WeChatSetup.exe', '0.2 GB'], ['L2', 'Python-3.12.4-amd64.exe', '0.03 GB']] },
  { id: 'e5', day: '昨天', time: '18:02', kind: 'rule', title: '规则「截图按月归档」', detail: '6 个文件移到 图片\\截图\\2026-11', amount: '6 个', undo: '撤销', items: [] },
  { id: 'e4', day: '10 月 12 日', time: '20:30', kind: 'move', title: '迁移 Zotero 文献库 → D:', detail: '原处留了联接 · Zotero 照常打开', amount: '6.4 GB', undo: '搬回 C:', items: [] },
  { id: 'e1', day: '10 月 18 日', time: '22:15', kind: 'clean', title: '常规清理 6 项', detail: '可重建的缓存会在用到时自动长回来', amount: '18.6 GB', undo: '', items: [['L1', 'pip 缓存', '5.1 GB'], ['L1', '临时文件', '4.4 GB'], ['L1', '浏览器缓存', '3.6 GB'], ['L3', '回收站 · 已清空', '2.3 GB'], ['L1', 'npm 缓存', '2.2 GB'], ['L1', 'NVIDIA 安装缓存', '1.0 GB']] },
  { id: 'e6', day: '10 月 18 日', time: '22:02', kind: 'scan', title: '扫描 C:', detail: '39.8 万个文件 · 58 秒', amount: '441 GB', undo: '', items: [] },
];

export const GROW: Grower[] = [{ name: '微信聊天原图与视频', lv: 'L4', gb: 12.4 }, { name: 'Docker WSL 磁盘', lv: 'L2', gb: 9.8 }, { name: 'Sentinel-2 2023', lv: 'L4', gb: 8.0 }, { name: 'pip 缓存', lv: 'L1', gb: 4.6 }, { name: '浏览器缓存', lv: 'L1', gb: 3.1 }, { name: '临时文件', lv: 'L1', gb: 2.6 }, { name: '其他 11 项', lv: 'L4', gb: 2.7 }];

/** the overview's recent-activity list as drawn in the design: [time, kind, title, amount] */
export const RECENT: [string, 'scan' | 'rule' | 'clean' | 'move', string, string][] = [
  ['13:52', 'scan', '扫描 C: · 41.2 万个文件 · 1 分 04 秒', '468 GB'],
  ['09:00', 'rule', '规则「安装包装好 30 天后移入回收站」· 3 个文件', '1.1 GB'],
  ['10/18', 'clean', '常规清理 6 项 · 可重建缓存与回收站', '18.6 GB'],
];
