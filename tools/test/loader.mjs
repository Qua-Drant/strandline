// Minimal ESM loader hook so Node `node --test` resolves bundler-style extensionless `.ts` imports in `src/`.
import { register } from 'node:module';

const hookSource = `
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL && !/\\.[a-z0-9]+$/i.test(specifier)) {
    for (const ext of ['.ts', '.tsx']) {
      const candidate = new URL(specifier + ext, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
`;

register('data:text/javascript,' + encodeURIComponent(hookSource), import.meta.url);
