import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(here, '..');

// Site workspaces consume @hypercli.com/sdk via file: -> dist/. When src
// moves ahead without a rebuild, apps and their test suites silently run
// stale code (missing exports, old behavior). This guard fails loudly.
describe('dist export parity', () => {
  const entries = Object.entries(pkg.exports as Record<string, { import?: string }>)
    .filter(([, target]) => typeof target.import === 'string' && target.import.endsWith('.js'))
    .map(([subpath, target]) => ({
      subpath,
      src: resolve(sdkRoot, target.import!.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts')),
      dist: resolve(sdkRoot, target.import!),
    }));

  for (const { subpath, src, dist } of entries) {
    it(`${subpath || '.'} exports match src and dist`, async () => {
      const srcModule = await import(src);
      const distModule = await import(dist);
      const srcKeys = Object.keys(srcModule).sort();
      const distKeys = Object.keys(distModule).sort();
      expect(
        distKeys,
        `ts-sdk dist is stale for ${subpath || '.'} — run: npm --prefix ts-sdk run build`,
      ).toEqual(srcKeys);
    });
  }
});
