# Strandline · 拾滩

Windows disk-organizer UI (潮线家族 · 磁盘整理工具), implemented from the R19 round of the design canvas.
React 19 + TypeScript + Vite. All data is mock data; nothing reads or changes the disk yet.

```powershell
npm install
npm run dev      # http://localhost:5173
npm run build
```

## Layout

- `src/styles/strandline.css` — the design's stylesheet, ported verbatim (tokens, light/dark via `light-dark()`).
- `src/shell/` — window frame: title bar, sidebar (disks, task slot), command palette, toasts, shared store
  (`useShell`: C:/D: free space, toasts, background task, theme).
- `src/pages/` — the eight pages: 概览, 空间地图, 清理建议, 大文件, 重复文件, 整理规则, 活动, 设置.
  The space map (`Map.tsx`) includes the scan, marquee, confirm → ebb-wash clean → receipt flow, migration dialog,
  context menu, detail drawer and its own Ctrl K palette.
- `src/lib/treemap.ts` — the space-map layout (free band + per-category squarified treemap with readable minimum blocks).
- `src/data/` — mock data for the map, cleaning suggestions and 90-day history.
- `src/router.tsx` — tiny hash router (`#/map`, `#/suggest`, …).
