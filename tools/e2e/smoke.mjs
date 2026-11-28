// Smoke test of the PRODUCTION build (dist/) in a real headless browser:  npm run build && npm run smoke
// The dev server is not enough: a CSS minifier setting once dropped every colour from the built demo
// while `npm run dev` looked fine. Checks, in light and dark, on the overview and the space map:
//   - the theme really applies (page background, distinct treemap block colours)
//   - the self-hosted fonts load and nothing is requested from another host
//   - no console errors or uncaught exceptions
//   - at the desktop minimum width (1100 px) header controls are not squeezed
// Screenshots go to SMOKE_OUT (default sandbox/smoke). Browser: BROWSER_PATH, or Chrome/Edge in the usual places.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.env.SMOKE_OUT ?? join('sandbox', 'smoke');
const PREVIEW_PORT = 4317;
const CDP_PORT = 9339;
const ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`;

const browserPath = [
  process.env.BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && existsSync(p));
if (!browserPath) throw new Error('no Chrome/Edge found; set BROWSER_PATH');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return r; } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('timed out waiting for ' + url);
}

const children = [];
const cleanup = () => { for (const c of children) { try { c.kill(); } catch { /* gone */ } } };
process.on('exit', cleanup);

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PREVIEW_PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
children.push(vite);
const profile = join(tmpdir(), 'strandline-smoke-' + process.pid);
const browser = spawn(browserPath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions',
  '--no-proxy-server', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
children.push(browser);

await waitFor(ORIGIN + '/');
await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`);
const target = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).find((t) => t.type === 'page');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const pending = new Map();
let seq = 0;
const problems = [];
const external = new Set();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id) { pending.get(d.id)?.(d); pending.delete(d.id); return; }
  if (d.method === 'Network.requestWillBeSent') {
    const u = d.params.request.url;
    if (!u.startsWith(ORIGIN) && !u.startsWith('data:') && !u.startsWith('blob:')) external.add(u);
  } else if (d.method === 'Runtime.exceptionThrown') {
    problems.push('exception: ' + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text));
  } else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') {
    problems.push('console.error: ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
  } else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') {
    problems.push('log: ' + d.params.entry.text + ' ' + (d.params.entry.url ?? ''));
  }
};
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
};
await send('Network.enable');
await send('Runtime.enable');
await send('Log.enable');

mkdirSync(OUT, { recursive: true });
const failures = [];
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) failures.push(msg); };

// relative luminance of "rgb(r, g, b)"
const lum = (rgb) => {
  const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map((v) => { const c = Number(v) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

for (const scheme of ['light', 'dark']) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  for (const [name, hash] of [['overview', '#/'], ['map', '#/map']]) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
    // a fresh document every time (a hash-only change would keep the old page)
    await send('Page.navigate', { url: `${ORIGIN}/?s=${scheme}-${name}${hash}` });
    await evaluate(`for (let i = 0; i < 100 && !document.querySelector('.app'); i++) await new Promise((r) => setTimeout(r, 100)); await document.fonts.ready; await new Promise((r) => setTimeout(r, 800));`);
    console.log(`${scheme} · ${name}`);

    const bg = await evaluate(`return getComputedStyle(document.querySelector('.app')).backgroundColor;`);
    const opaque = /^rgb\(/.test(bg) || /^rgba\(.*,\s*1\)$/.test(bg);
    check(opaque, `page background is set (${bg})`);
    if (opaque) check(scheme === 'light' ? lum(bg) > 0.6 : lum(bg) < 0.1, `page background matches the ${scheme} theme (luminance ${lum(bg).toFixed(2)})`);

    const fonts = await evaluate(`return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replaceAll('"', ''));`);
    for (const f of ['Inter', 'IBM Plex Mono']) check(fonts.includes(f), `font ${f} loaded`);

    if (name === 'map') {
      const colours = await evaluate(`return [...new Set([...document.querySelectorAll('.cell')].map((c) => { const s = getComputedStyle(c); return s.backgroundColor + '|' + s.backgroundImage; }))].length;`);
      check(colours >= 3, `treemap blocks have distinct colours (${colours} styles)`);
      const squeezed = await evaluate(`return [...document.querySelectorAll('.hdr .seg button')].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent);`);
      check(squeezed.length === 0, `header segmented control fits at 1100 px${squeezed.length ? ' (squeezed: ' + squeezed.join(', ') + ')' : ''}`);
    } else {
      const widths = await evaluate(`return [...document.querySelectorAll('.ov-grow .gr .ellipsis')].map((s) => s.clientWidth);`);
      check(widths.length > 0 && Math.min(...widths) >= 80, `growth list names are readable at 1100 px (narrowest ${widths.length ? Math.min(...widths) : 'none'} px)`);
    }

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `${name}-${scheme}.png`), Buffer.from(shot.result.data, 'base64'));
  }
}

check(external.size === 0, `no requests to other hosts${external.size ? ': ' + [...external].join(', ') : ''}`);
check(problems.length === 0, `no console errors${problems.length ? ':\n    ' + problems.join('\n    ') : ''}`);

await send('Browser.close').catch(() => {});
ws.close();
cleanup();
console.log(failures.length ? `\n${failures.length} check(s) failed` : `\nall checks passed · screenshots in ${OUT}`);
process.exit(failures.length ? 1 : 0);
