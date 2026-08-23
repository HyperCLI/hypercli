import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserHyperCLI } from '../src/browser.js';
import { BrowserJobs } from '../src/browser-jobs.js';
import type { HTTPClient } from '../src/http.js';

function importDeclarationHasRuntimeBinding(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  if (!clause.namedBindings) return false;
  if (ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings.elements.some((element) => !element.isTypeOnly);
}

function exportDeclarationHasRuntimeBinding(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return false;
  if (!node.exportClause) return true;
  if (!ts.isNamedExports(node.exportClause)) return true;
  return node.exportClause.elements.some((element) => !element.isTypeOnly);
}

function runtimeModuleSpecifiers(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      importDeclarationHasRuntimeBinding(node)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      exportDeclarationHasRuntimeBinding(node)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

async function browserRuntimeGraph(entry: string): Promise<{
  files: Set<string>;
  nodeBuiltins: Set<string>;
  externals: Set<string>;
}> {
  const files = new Set<string>();
  const nodeBuiltins = new Set<string>();
  const externals = new Set<string>();

  const visit = async (fileName: string): Promise<void> => {
    if (files.has(fileName)) return;
    files.add(fileName);
    const source = await readFile(fileName, 'utf8');
    for (const specifier of runtimeModuleSpecifiers(source, fileName)) {
      if (specifier.startsWith('node:')) {
        nodeBuiltins.add(specifier);
        continue;
      }
      if (!specifier.startsWith('.')) {
        externals.add(specifier);
        continue;
      }
      const sourceSpecifier = specifier.replace(/\.js$/, '.ts');
      await visit(resolve(dirname(fileName), sourceSpecifier));
    }
  };

  await visit(entry);
  return { files, nodeBuiltins, externals };
}

describe('browser entry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, 'WebSocket');
  });

  it('does not pull Node-only deployment modules into browser bundles', async () => {
    const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
    const graph = await browserRuntimeGraph(resolve(sourceRoot, 'browser.ts'));

    expect([...graph.nodeBuiltins]).toEqual([]);
    expect([...graph.externals]).not.toContain('ws');
    expect(graph.files.has(resolve(sourceRoot, 'agents.ts'))).toBe(false);
    expect(graph.files.has(resolve(sourceRoot, 'agent.ts'))).toBe(true);
    expect(graph.files.has(resolve(sourceRoot, 'agent-slots.ts'))).toBe(true);
    expect(graph.files.has(resolve(sourceRoot, 'browser-jobs.ts'))).toBe(true);
    expect(graph.files.has(resolve(sourceRoot, 'jobs.ts'))).toBe(false);
  });

  it('exposes a browser-safe jobs client', () => {
    const client = new BrowserHyperCLI({
      apiUrl: 'https://api.hypercli.com',
      token: 'jwt',
    });

    expect(client.jobs).toBeInstanceOf(BrowserJobs);
    expect(typeof client.jobs.lifecycleStream).toBe('function');
    expect(typeof client.jobs.metricsStream).toBe('function');
  });

  it('streams browser job metrics over job-key scoped websocket URLs', async () => {
    const sockets: FakeBrowserWebSocket[] = [];
    class TestWebSocket extends FakeBrowserWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    }
    vi.stubGlobal('WebSocket', TestWebSocket);
    const jobs = new BrowserJobs(fakeJobsHttp());

    const stream = jobs.metricsStream('job-1', { interval: 7 });
    const next = stream.next();

    await waitUntil(() => sockets[0] !== undefined);
    expect(sockets[0]?.url).toBe('wss://api.hypercli.com/orchestra/ws/metrics/jobs/job-key?interval=7');
    sockets[0]?.emit('message', {
      data: JSON.stringify({
        event: 'metrics_snapshot',
        data: {
          gpus: [{ index: 0, name: 'L40S', utilization_gpu_percent: 42, memory_used_mb: 100, memory_total_mb: 200 }],
          system: { cpu_percent: 5, cpu_cores: 8, memory_used_mb: 1024, memory_limit_mb: 2048 },
        },
      }),
    });

    await expect(next).resolves.toMatchObject({
      done: false,
      value: {
        gpus: [{ index: 0, name: 'L40S', utilization: 42, memoryUsed: 100, memoryTotal: 200 }],
        system: { cpuPercent: 5, cpuCores: 8, memoryUsed: 1024, memoryLimit: 2048 },
      },
    });
    await stream.return(undefined);
    expect(sockets[0]?.closed).toBe(true);
  });

  it('streams browser job lifecycle over job-key scoped websocket URLs', async () => {
    const sockets: FakeBrowserWebSocket[] = [];
    class TestWebSocket extends FakeBrowserWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    }
    vi.stubGlobal('WebSocket', TestWebSocket);
    const jobs = new BrowserJobs(fakeJobsHttp());

    const stream = jobs.lifecycleStream('job-1');
    const next = stream.next();

    await waitUntil(() => sockets[0] !== undefined);
    expect(sockets[0]?.url).toBe('wss://api.hypercli.com/orchestra/ws/lifecycle/job-key');
    sockets[0]?.emit('message', {
      data: JSON.stringify({ event: 'runtime_extended', job_id: 'job-1', runtime: 900 }),
    });

    await expect(next).resolves.toMatchObject({
      done: false,
      value: {
        event: 'runtime_extended',
        jobId: 'job-1',
        runtime: 900,
      },
    });
    await stream.return(undefined);
  });
});

class FakeBrowserWebSocket {
  readonly listeners: Record<string, Array<(event: any) => void>> = {};
  closed = false;

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (event: any) => void): void {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((candidate) => candidate !== listener);
  }

  emit(type: string, event: any): void {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }

  close(): void {
    this.closed = true;
    this.emit('close', {});
  }
}

function fakeJobsHttp(): HTTPClient {
  return {
    base: 'https://api.hypercli.com',
    get: vi.fn().mockResolvedValue({
      job_id: 'job-1',
      job_key: 'job-key',
      state: 'running',
      gpu_type: 'l40s',
      gpu_count: 1,
      region: 'us',
      interruptible: true,
      price_per_hour: 1,
      price_per_second: 1 / 3600,
      docker_image: 'ubuntu',
      runtime: 600,
    }),
  } as unknown as HTTPClient;
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(predicate()).toBe(true);
}
