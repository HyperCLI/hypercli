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
  it('reports the release version from the published manifest', async () => {
    const root = await import('../dist/index.js');
    expect(root.APP_VERSION).toBe(pkg.version);
  });
  it('exports the flat Agent surface and pi defaults from root and agents entry points', async () => {
    const root = await import('../dist/index.js');
    const agents = await import('../dist/agents.js');
    expect(root.Agent).toBe(agents.Agent);
    // CodingAgent collapsed into Agent: no runtime export remains, only the
    // deprecated type alias (types do not exist at runtime).
    expect(root.CodingAgent).toBeUndefined();
    expect(agents.CodingAgent).toBeUndefined();
    expect(root.DEFAULT_PI_IMAGE).toBe(agents.DEFAULT_CODING_AGENT_IMAGES.pi);
    expect(root.DEFAULT_PI_ENV).toBe(agents.DEFAULT_PI_ENV);
    expect(root.DEFAULT_PI_ENV).toEqual({});
    const agent = root.Agent.fromDict({ id: 'pi-1', runtime: 'pi', state: 'RUNNING' });
    expect(agent).toBeInstanceOf(root.Agent);
    expect(agent.runtime).toBe('pi');
    // The single flat factory plus the one remaining deprecated facade alias.
    expect(root.Deployments.prototype.createAgent).toBeTypeOf('function');
    expect(root.Deployments.prototype.createCodingAgent).toBeTypeOf('function');
    expect(root.Deployments.prototype.createOpenClaw).toBeUndefined();
    expect(root.Deployments.prototype.createHermesAgent).toBeUndefined();
    expect(root.Deployments.prototype.createPi).toBeUndefined();
    expect(root.Deployments.prototype.createOpenCode).toBeUndefined();
    expect(root.Deployments.prototype.startOpenClaw).toBeUndefined();
    expect(root.Deployments.prototype.startHermesAgent).toBeUndefined();
    expect(root.Deployments.prototype.createOpenClawPro).toBeUndefined();
  });

  it('exports the persona registry and default paths from the root entry point', async () => {
    const root = await import('../dist/index.js');
    expect(root.DEFAULT_PERSONA_SOUL_PATH).toBe('.hypercli/SOUL.md');
    expect(root.DEFAULT_PERSONA_USER_PATH).toBe('.hypercli/USER.md');
    expect(root.AGENT_PERSONA_PROFILES.openclaw_acp).toBe(root.AGENT_PERSONA_PROFILES['openclaw-pro']);
    expect(root.resolveAgentPersonaProfile('openclaw_acp')).toBeInstanceOf(root.OpenClawPersonaProfile);
    expect(root.resolveAgentPersonaProfile('hermes_acp')).toBeInstanceOf(root.HermesPersonaProfile);
    expect(root.resolveAgentPersonaProfile('opencode')).toBeInstanceOf(root.DefaultPersonaProfile);
  });

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
