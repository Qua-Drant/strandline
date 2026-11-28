// Regenerates the self-hosted fonts in src/assets/fonts (run: npm run fonts).
// The app never loads fonts from the network: the desktop build is offline-first and
// fonts.googleapis.com is unreliable in mainland China.
//
// - Inter (variable) and IBM Plex Mono: Latin subset, copied from the @fontsource packages.
// - Noto Serif SC Bold: only the greeting on the overview page uses it, so it is subset to
//   the characters below. If you change greeting()/the hello heading in src/pages/Overview.tsx,
//   add the new characters here and re-run. Missing characters fall back to the system serif.
// - LXGW WenKai TC: only the brand mark 拾滩.
// Chinese body text uses the system UI font (Microsoft YaHei UI / PingFang SC): real file names
// can contain any character, and a full CJK font would add >10 MB to the installer.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'src', 'assets', 'fonts');
mkdirSync(out, { recursive: true });
const require = createRequire(import.meta.url);
const pkgFile = (pkg, file) => join(dirname(require.resolve(`${pkg}/package.json`)), 'files', file);

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
const SUBSETS = [
  { file: 'noto-serif-sc-700-greeting.woff2', family: 'Noto Serif SC', axis: 'wght@700',
    text: ASCII + '夜深了早上好中午好下午好晚上好，盘腾出了空间充足快满' },
  { file: 'lxgw-wenkai-tc-brand.woff2', family: 'LXGW WenKai TC', axis: '', text: '拾滩' },
];

copyFileSync(pkgFile('@fontsource-variable/inter', 'inter-latin-wght-normal.woff2'), join(out, 'inter-latin-wght.woff2'));
for (const w of [300, 400, 500]) {
  copyFileSync(pkgFile('@fontsource/ibm-plex-mono', `ibm-plex-mono-latin-${w}-normal.woff2`), join(out, `ibm-plex-mono-latin-${w}.woff2`));
}

// a modern UA so the CSS API answers with woff2
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
for (const s of SUBSETS) {
  const fam = s.family.replaceAll(' ', '+') + (s.axis ? `:${s.axis}` : '');
  const chars = [...new Set(s.text)].join('');
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${fam}&text=${encodeURIComponent(chars)}`, { headers: { 'User-Agent': UA } })).text();
  const url = css.match(/url\((https:[^)]+)\)\s*format\('woff2'\)/)?.[1];
  if (!url) throw new Error(`no woff2 for ${s.family}:\n${css}`);
  writeFileSync(join(out, s.file), Buffer.from(await (await fetch(url)).arrayBuffer()));
}
console.log('fonts written to', out);
