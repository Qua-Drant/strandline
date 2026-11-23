// Render the app icon SVG to a 1024x1024 PNG for `npx tauri icon`.
//   node tools/icon/render.mjs && npx tauri icon tools/icon/strandline.png
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const svg = readFileSync(new URL('./strandline.svg', import.meta.url));
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } }).render().asPng();
writeFileSync(new URL('./strandline.png', import.meta.url), png);
console.log('tools/icon/strandline.png', png.length, 'bytes');
