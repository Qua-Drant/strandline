# Changelog

## 0.1.1 — 2026-11-28

### Fixed
- The production build lost every background and chart colour: the CSS minifier rewrote `light-dark()` into variables that ignore the theme set by the app. `light-dark()` is now kept as is (supported by WebView2 and all current browsers).
- Space map: the 30-day tide curve produced invalid SVG (`NaN`) when there was no history yet, e.g. on first run.
- Overview: at the desktop minimum width the growth list names were cut to one character; the panels now reflow into two rows.
- Space map: the 全部 / 可清理 / 可迁移 switch no longer gets squeezed in narrow windows.

### Changed
- Fonts are bundled (~110 KB) instead of loaded from Google Fonts. The app makes no network requests; the desktop CSP no longer allows any font host. Chinese body text uses the system UI font.
- The version shown in Settings comes from `package.json`.

### Added
- `npm run smoke`: a headless-browser check of the production build (theme colours, local fonts, no external requests, no console errors, narrow layouts), run in CI and before release builds.
- `npm run shots`: re-shoots the README screenshots of the web demo from the production build.

## 0.1.0 — 2026-11-23

First version: space map, cleaning suggestions, large files, duplicates, rules, verified folder migration with junctions, activity and tide calendar; read-only by default, Recycle Bin only, hard-coded protected paths. Not published as a release (its build had the colour bug fixed in 0.1.1).
