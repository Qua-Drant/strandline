<p align="center"><img src="tools/icon/strandline.png" width="112" alt="Strandline icon"></p>

<h1 align="center">Strandline · 拾滩</h1>

<p align="center">
  A safety-first disk organizer for Windows — space map, cleaning suggestions, large files, duplicates, rules and verified folder migration.<br>
  <b>English</b> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://OWNER.github.io/strandline/">Live demo (mock data)</a> ·
  <a href="https://github.com/OWNER/strandline/releases">Download</a> ·
  <a href="SECURITY.md">Security model</a>
</p>

<!-- Screenshots / GIF: put files in docs/screenshots/ and link them here.
<p align="center"><img src="docs/screenshots/map.png" width="860" alt="Space map"></p>
-->

Strandline is a desktop app (Tauri v2: Rust backend + React 19 / Vite frontend). The same interface also runs in a browser as a **demo with built-in mock data** that never touches a real file.

## Why it is safe to point at your system drive

| Principle | What the code does |
| --- | --- |
| **Read-only until you say otherwise** | First launch starts in read-only mode: scanning works, every write (clean, recycle, migrate, rules) is refused by the backend. Switch it off in *Settings › 清理与安全*. |
| **Recycle Bin, not delete** | Cleaning, rules, duplicates and large files all go to the Recycle Bin and can be undone for 30 days. The only irreversible action is *Empty Recycle Bin*, which asks again. |
| **No silent permanent deletes** | Before recycling, the volume's Recycle Bin size limit and "delete immediately" setting are checked. Anything Windows would destroy instead of recycling is refused and explained. |
| **Hard-coded protected paths** | `src-tauri/src/guard.rs` refuses Windows, Program Files, ProgramData\Microsoft, boot/recovery folders, page/hibernation files, registry hives and the root folders themselves — checked again after resolving links. No setting or rule can widen it. |
| **Read-only, accurate scanning** | Only names, sizes and times are read. Symbolic links, junctions and mount points are never followed (no loops, nothing counted twice); hard links count once; folders without permission are skipped and counted. |
| **Cloud files stay in the cloud** | OneDrive / iCloud online-only placeholders (`OFFLINE`, `RECALL_ON_OPEN`, `RECALL_ON_DATA_ACCESS`) are never opened: not counted, not hashed, not migrated, skipped by rules. |
| **Verified, resumable migration** | Space check → chunked copy with a BLAKE3 hash of every file, fsync and read-back compare → journal for resume → original renamed to a backup and replaced by a directory junction (rolled back if unreachable) → backup to the Recycle Bin. Pauses while the owning app runs or a folder is held open. |
| **Never tested on a real system drive** | `sandbox-gen` builds a fake drive tree; every test runs inside `sandbox/.tests`. The scan target in Settings accepts only a sandbox folder or a whole drive. |

Details: [SECURITY.md](SECURITY.md).

## Features

- **Space map** — a treemap of the drive with free space as a true-proportion band; blocks are grouped by what they are (system, dev tools, AI models, caches, user folders…) and coloured by how safe they are to clean.
- **Cleaning suggestions** — rebuildable caches (pip, npm, conda, browsers, temp, crash dumps…), old installers and stale build output, with what each one does and its PowerShell equivalent.
- **Large files** — weighed by size and how long they have been untouched; files owned by apps or Windows are explained instead of deleted.
- **Duplicates** — size → first/last 64 KiB → full BLAKE3, so only byte-identical files are offered.
- **Rules** — "installers older than 30 days to the Recycle Bin", "screenshots into a folder per month"… with a dry-run preview and undo.
- **Migration** — move WeChat files, Docker / WSL disks, Ollama models or any big folder to another drive, keeping the old path working.
- **Activity** — 90 days of history with undo, and a calendar of free space.
- Several drives (C:, D:, E:…), light and dark themes, Ctrl K command palette.

## Development

Requirements: Node 22+, Rust (stable-msvc), Visual Studio C++ build tools, WebView2 runtime.

```powershell
npm install
npm run dev        # browser demo with mock data: http://localhost:5173
npm run desktop    # desktop app with the real backend (tauri dev)
```

### Try the real features safely

```powershell
npm run sandbox    # fake drive tree in sandbox\demo (big files are sparse: almost no disk space)
```

In the desktop app set **Settings › 扫描 › 扫描范围** to the full path of `sandbox\demo` and turn read-only mode off. Scans, cleaning, undo, migration and rules then only happen inside that folder (migrations go to `sandbox\demo\_moved`). Keep the app's data away from `%APPDATA%` while developing:

```powershell
$env:STRANDLINE_DATA_DIR = "$PWD\sandbox\appdata"; npm run desktop
```

### End-to-end checks

`tools/e2e/cdp.mjs` drives the real desktop window over WebView2 remote debugging:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"; npm run desktop
node tools/e2e/cdp.mjs eval "location.hash = '#/map'"
node tools/e2e/cdp.mjs shot map.png
```

## Tests and checks

```powershell
npm run lint           # frontend (oxlint)
npm run build          # type check + demo build
npm run lint:backend   # cargo clippy, warnings are errors
npm run test:backend   # Rust unit + integration tests, sandbox only
cargo test --release --manifest-path src-tauri/Cargo.toml --test perf -- --ignored --nocapture   # 300k-file scan benchmark
```

Covered by tests: sandbox generation; scanning and cancel; junction loops, hard links, cloud placeholders, unreadable folders; classification without double counting; large files; duplicates (same size, different content is not a duplicate); Recycle Bin recycle and restore; emptying the bin refused in a sandbox; migration verify + junction, resume after interruption, pause while the app runs, undo; rule dry run / run / undo; protected paths.

## Build and release

```powershell
npm run desktop:build  # NSIS installer, MSI and the portable exe under src-tauri\target\release
npm run build          # browser demo only (dist\, relative paths, ready for GitHub Pages)
```

- `.github/workflows/ci.yml` — lint, build, clippy and tests on Windows for every push and PR; deploys the demo to GitHub Pages from `main`.
- `.github/workflows/release.yml` — on a `v*` tag: full checks, NSIS installer, portable `strandline.exe`, `SHA256SUMS.txt`, and a **draft** GitHub Release.

The app icon is `tools/icon/strandline.svg` (render with `node tools/icon/render.mjs`, then `npx tauri icon tools/icon/strandline.png -o src-tauri/icons`).

## Project layout

```
src/                     React frontend
  pages/                 overview, space map, suggestions, large files, duplicates, rules, activity, settings
  shell/                 title bar, sidebar, command palette, toasts, shared state
  services/diskService.ts  one interface for every page; MockDiskService (demo) or TauriDiskService (desktop)
  styles/strandline.css  the design's stylesheet
src-tauri/src/
  guard.rs  scan.rs  winfs.rs  catalog.rs  finder.rs  recycle.rs  migrate.rs  rules.rs  store.rs  sandbox.rs
  commands.rs  actions.rs  Tauri commands
src-tauri/tests/         sandbox integration tests, Windows edge cases, benchmark
tools/                   e2e driver, icon
```

Settings, custom rules, 90 days of activity, daily free space and undo records live in `%APPDATA%\Strandline\strandline.json`.

## Contributing

Issues and pull requests are welcome — please read [SECURITY.md](SECURITY.md) first. A cleaning suggestion that looks wrong (something important marked as safe to clean) is treated as a security bug: use the *Cleaning rule false positive* issue template.

## License

[MIT](LICENSE)
