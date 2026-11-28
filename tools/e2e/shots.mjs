// Re-shoots the README screenshots of the web demo from the PRODUCTION build:  npm run build && npm run shots
// Writes docs/media/{space-map,space-map-dark,suggestions-calendar,overview,migration}.png at 1440x900 @1.5.
// (docs/media/desktop-receipt.png is a real desktop run against the sandbox and is taken by hand.)
// Browser: BROWSER_PATH, or Chrome/Edge in the usual places.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.env.SHOTS_OUT ?? join('docs', 'media');
const PREVIEW_PORT = 4318;
const CDP_PORT = 9340;
const ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`;
const VIEW = { width: 1440, height: 900, deviceScaleFactor: 1.5, mobile: false };

const browserPath = [
  process.env.BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && existsSync(p));
if (!browserPath) throw new Error('no Chrome/Edge found; set BROWSER_PATH');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url) {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('timed out waiting for ' + url);
}

const children = [];
const cleanup = () => { for (const c of children) { try { c.kill(); } catch { /* gone */ } } };
process.on('exit', cleanup);
children.push(spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PREVIEW_PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' }));
// InPrivate/incognito + no sync: a fresh profile must never sign in to the user's browser account
children.push(spawn(browserPath, ['--headless=new', '--inprivate', '--incognito', '--no-first-run', '--no-default-browser-check', '--disable-sync',
  '--disable-extensions', '--hide-scrollbars', '--no-proxy-server', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'strandline-shots-' + process.pid)}`, 'about:blank'], { stdio: 'ignore' }));
await waitFor(ORIGIN + '/');
await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`);

const target = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const pending = new Map();
let seq = 0;
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id) { pending.get(d.id)?.(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { const w = (t) => new Promise((r) => setTimeout(r, t)); const q = (s) => document.querySelector(s); ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
};
let n = 0;
const open = async (theme, hash) => {
  // the theme lives in localStorage; load a fresh document (hash-only changes keep the old page)
  await send('Page.navigate', { url: `${ORIGIN}/?t=${++n}#/` });
  await evaluate(`for (let i = 0; i < 100 && !q('.app'); i++) await w(100); localStorage.setItem('strandline.theme', '${theme}');`);
  await send('Page.navigate', { url: `${ORIGIN}/?t=${++n}${hash}` });
  await evaluate(`for (let i = 0; i < 100 && !q('.app'); i++) await w(100); await document.fonts.ready; await w(1500);`);
};
const shot = async (file) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, file), Buffer.from(r.result.data, 'base64'));
  console.log('saved', join(OUT, file));
};

mkdirSync(OUT, { recursive: true });
await send('Emulation.setDeviceMetricsOverride', VIEW);

await open('dark', '#/map');
await shot('space-map-dark.png');

await open('light', '#/map');
await shot('space-map.png');

await open('light', '#/suggest');
console.log('  calendar:', await evaluate(`const b = [...document.querySelectorAll('.tw-cal .cd')][76];
  b?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); b?.focus(); await w(400); return q('.cal-rd')?.textContent;`));
await shot('suggestions-calendar.png');

await open('light', '#/');
console.log('  greeting:', await evaluate(`return q('.hello-h')?.textContent;`));
await shot('overview.png');

await open('light', '#/map');
console.log('  migration:', await evaluate(`[...document.querySelectorAll('.hdr .seg button')].find((b) => b.textContent === '可迁移').click(); await w(500);
  [...document.querySelectorAll('.list .row')].find((r) => r.textContent.includes('Ollama')).querySelector('button').click(); await w(700);
  return q('#r7-mv')?.textContent;`));
await shot('migration.png');

await send('Browser.close').catch(() => {});
ws.close();
cleanup();
process.exit(0);
