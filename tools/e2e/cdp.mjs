// Drive the desktop app's WebView2 over the Chrome DevTools Protocol (end-to-end checks).
// Start the app with:  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"; npm run desktop
// Then:  node tools/e2e/cdp.mjs eval "document.title"
//        node tools/e2e/cdp.mjs shot out.png
import { writeFileSync } from 'node:fs';

const [cmd, arg] = process.argv.slice(2);
const port = process.env.CDP_PORT ?? '9222';
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools'));
if (!page) throw new Error('no page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let seq = 0;
ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); pending.delete(d.id); };
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });

if (cmd === 'eval') {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${arg} })()`, awaitPromise: true, returnByValue: true });
  const v = r.result?.result?.value;
  console.log(r.result?.exceptionDetails ? JSON.stringify(r.result.exceptionDetails, null, 1) : JSON.stringify(v, null, 1));
} else if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(arg, Buffer.from(r.result.data, 'base64'));
  console.log('saved', arg);
} else {
  console.log('usage: cdp.mjs eval <js> | shot <file.png>');
}
ws.close();
