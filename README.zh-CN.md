<p align="center"><img src="tools/icon/strandline.png" width="112" alt="Strandline 图标"></p>

# Strandline · 拾滩

[English](README.md) · **简体中文** · [在线演示（模拟数据）](https://OWNER.github.io/strandline/) · [下载](https://github.com/OWNER/strandline/releases) · [安全模型](SECURITY.md)

<!-- 截图 / GIF：放到 docs/screenshots/ 后在这里引用 -->

安全优先的 Windows 磁盘整理工具：空间地图、清理建议、大文件、重复文件、整理规则与目录迁移。
Tauri v2（Rust 后端）+ React 19 / Vite 前端。

- **桌面版**：真实扫描与操作本机磁盘。
- **在线演示**：同一套界面跑在浏览器里，使用内置的演示数据，不接触任何真实文件（可部署到 GitHub Pages）。

## 安全设计

| 原则 | 做法 |
| --- | --- |
| 默认只读 | 首次启动是只读模式：只扫描，清理、回收、迁移、规则一律被后端拒绝；在 设置 › 清理与安全 里关闭。 |
| 默认只进回收站 | 所有清理、规则、重复文件、大文件都移入回收站，30 天内可撤销。唯一的不可逆操作是「清空回收站」，界面上需单独确认。 |
| 不让 Windows 静默永久删除 | 移入回收站前检查该卷回收站的最大容量和「直接删除」设置；放不下的项目直接拒绝并说明原因，而不是交给系统去永久删除。 |
| 硬编码保护路径 | `src-tauri/src/guard.rs`：Windows、Program Files、ProgramData\Microsoft、引导与恢复目录、页面/休眠文件、注册表配置单元、用户与系统根文件夹本身等一律拒绝写入；会解析链接后再检查一次。任何设置或规则都不能放宽。 |
| 只读扫描 | 只读取文件夹结构、名称、大小和时间；不跟随符号链接、目录联接和挂载点（不会死循环或重复计数）；硬链接只计一次；没有权限的文件夹跳过并计数。 |
| 云端文件留在云端 | OneDrive / iCloud 的仅在线占位文件（OFFLINE、RECALL_ON_OPEN、RECALL_ON_DATA_ACCESS）从不打开：不计入大小、不算哈希、不迁移、规则跳过。 |
| 可验证、可续传的迁移 | 目标盘空间检查 → 分块复制并对每个文件做 BLAKE3 校验、落盘后读回比对 → 断点日志（中断后续传）→ 原文件夹改名备份并在原处建立目录联接（不可达则回滚）→ 备份移入回收站（放不下就保留在磁盘上并告知）。相关程序在运行、或文件夹被占用时自动暂停，可重试，可撤销。 |
| 不在真实系统盘上测试 | `sandbox-gen` 生成模拟的磁盘目录树；所有测试只在 `sandbox/.tests` 里运行。设置里的「扫描范围」只接受沙盒文件夹或整盘。 |

## 开发

需要：Node 22+、Rust（stable-msvc）、Visual Studio C++ 生成工具、WebView2 运行时。

```powershell
npm install
npm run dev        # 浏览器演示模式（Mock 数据）：http://localhost:5173
npm run desktop    # 桌面版（真实后端），等同 tauri dev
```

### 用沙盒安全地试真实功能

```powershell
npm run sandbox    # 在 sandbox\demo 生成模拟磁盘（大文件为稀疏文件，几乎不占空间）
```

然后在桌面版的 **设置 › 扫描 › 扫描范围** 里填 `sandbox\demo` 的完整路径，并关闭只读模式。之后的扫描、清理、撤销、迁移、规则都只发生在这个文件夹里（迁移目标默认是 `sandbox\demo\_moved`）。

开发时也可以把应用数据放到别处，避免碰到 `%APPDATA%\Strandline`：

```powershell
$env:STRANDLINE_DATA_DIR = "$PWD\sandbox\appdata"; npm run desktop
```

### 端到端检查

`tools/e2e/cdp.mjs` 通过 WebView2 远程调试驱动真实的桌面窗口：

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"; npm run desktop
node tools/e2e/cdp.mjs eval "location.hash = '#/map'"
node tools/e2e/cdp.mjs shot map.png
```

## 测试与检查

```powershell
npm run lint           # 前端 oxlint
npm run build          # TypeScript 类型检查 + 打包演示版
npm run lint:backend   # cargo clippy（警告即失败）
npm run test:backend   # Rust 单元测试 + 集成测试（只在沙盒里）
cargo test --release --manifest-path src-tauri/Cargo.toml --test perf -- --ignored --nocapture   # 30 万文件扫描压测
```

后端测试覆盖：沙盒生成、只读扫描与取消、分类与容器去重、大文件识别、重复文件（同大小不同内容不会误判）、回收站移入与恢复、清空回收站在沙盒中被拒绝、迁移校验与目录联接、迁移中断后续传、应用运行时暂停、迁移撤销、规则预演/执行/撤销、保护路径拦截。

## 构建

```powershell
npm run desktop:build  # 生成 NSIS 安装包、MSI（src-tauri\target\release\bundle）与绿色版 strandline.exe
npm run build          # 只构建浏览器演示版（dist\，相对路径，可直接放到 GitHub Pages）
```

`.github/workflows/ci.yml` 会在 Windows 上跑全部检查，并把演示版发布到 GitHub Pages；推送 `v*` 标签时 `.github/workflows/release.yml` 会构建安装包、绿色版和 `SHA256SUMS.txt`，并创建草稿 Release。

## 目录结构

```
src/                     React 前端
  pages/                 8 个页面（概览、空间地图、清理建议、大文件、重复文件、整理规则、活动、设置）
  shell/                 标题栏、侧栏、命令面板、通知、共享状态
  services/
    diskService.ts       统一的数据与操作接口，启动时自动选择实现
    mock/                MockDiskService：设计稿的演示数据与模拟交互
    tauri/               TauriDiskService：调用 Rust 后端
  styles/strandline.css  设计稿样式（原样保留）
src-tauri/src/
  guard.rs               写入守卫（保护路径）
  scan.rs                并行只读扫描
  catalog.rs             分类：地图区块、清理建议、迁移计划
  finder.rs              大文件与重复文件
  recycle.rs             回收站（容量预检、恢复）
  migrate.rs             校验 + 续传 + 目录联接的迁移
  rules.rs               整理规则
  store.rs               设置、规则、活动、历史的本地 JSON 存储
  sandbox.rs             沙盒生成器（bin/sandbox_gen.rs）
  commands.rs / actions.rs  Tauri 命令
tools/e2e/cdp.mjs        桌面窗口端到端脚本
```

数据保存在 `%APPDATA%\Strandline\strandline.json`（设置、自定义规则、90 天活动记录、每日可用空间、撤销信息）。

## 许可证

MIT
