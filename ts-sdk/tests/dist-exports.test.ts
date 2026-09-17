import { beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(here, '..');

function prototypeMethods(value: unknown): string[] {
  if (typeof value !== 'function' || !value.prototype) return [];
  return Object.getOwnPropertyNames(value.prototype)
    .filter((name) => name !== 'constructor')
    .sort();
}

// CI jobs that run tests without a prior build step still need a dist to
// compare against; build once when it is missing.
beforeAll(() => {
  if (!existsSync(resolve(sdkRoot, 'dist/index.js'))) {
    execSync('npm run build', { cwd: sdkRoot, stdio: 'inherit' });
  }
}, 180_000);

// Site workspaces consume @hypercli.com/sdk via file: -> dist/. When src
// moves ahead without a rebuild, apps and their test suites silently run
// stale code (missing exports, old behavior). This guard fails loudly.
describe('dist export parity', () => {
  const entries = Object.entries(pkg.exports as Record<string, { import?: string }>)
    .filter(([, target]) => typeof target.import === 'string' && target.import.endsWith('.js'))
    .map(([subpath, target]) => {
      const importPath = target.import as string;
      return {
        subpath,
        src: resolve(sdkRoot, importPath.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts')),
        dist: resolve(sdkRoot, importPath),
      };
    });

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

      const srcExports = srcModule as Record<string, unknown>;
      const distExports = distModule as Record<string, unknown>;
      for (const exportName of srcKeys) {
        const srcMethods = prototypeMethods(srcExports[exportName]);
        const distMethods = prototypeMethods(distExports[exportName]);
        if (srcMethods.length === 0 && distMethods.length === 0) continue;
        expect(
          distMethods,
          `ts-sdk dist class ${exportName} is stale for ${subpath || '.'} — run: npm --prefix ts-sdk run build`,
        ).toEqual(srcMethods);
      }
    });
  }
});
