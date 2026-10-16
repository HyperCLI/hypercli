import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { expect, it } from 'vitest';

const id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const snapshot = (text: string, file = 'one', truncated = false) => ({ event: 'captured_logs', agent_id: id,
  transport: 'runner', logs: text, unavailable: null, captures: [{ assignment_id: id,
    source: 'stderr', generation: 'current', file_generation: file, launch_epoch: 2,
    content_base64: Buffer.from(text).toString('base64'), truncated, unavailable: null,
    capture: { state: 'capturing', dropped_bytes: 0 }, diagnostics_dropped: 0,
    runner_version: '0.8.5', runner_revision: null, executable_sha256: null }] });

async function runLogs(args: string[], frames: unknown[]) {
  const home = await mkdtemp(join(tmpdir(), 'hyper-logs-'));
  let base = '', socketUrl = '';
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url?.endsWith('/logs/token')
      ? { agent_id: id, token: 'test-token', expires_at: '2099-01-01T00:00:00Z', ws_url: base.replace('http:', 'ws:') + `/logs/${id}` }
      : { id, name: 'test', runtime: 'opencode', state: 'RUNNING' }));
  });
  const ws = new WebSocketServer({ server });
  let child: ReturnType<typeof spawn> | undefined;
  const timers: ReturnType<typeof setTimeout>[] = [];
  ws.on('connection', (socket, req) => {
    socketUrl = req.url!;
    frames.forEach((frame, index) => timers.push(setTimeout(() => {
      if (socket.readyState === 1) socket.send(JSON.stringify(frame));
    }, 25 * (index + 1))));
    if (args.includes('--follow')) timers.push(setTimeout(() => child!.kill('SIGINT'), 25 * frames.length + 200));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', 'agents', 'logs', id, ...args], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, HYPER_HOME: home,
        HYPER_API_KEY: 'test-only', HYPER_API_BASE: base, HYPER_AGENTS_API_BASE: base }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout!.on('data', data => { stdout += data; });
    child.stderr!.on('data', data => { stderr += data; });
    timers.push(setTimeout(() => child!.kill('SIGKILL'), 4000));
    const [code] = await once(child, 'close');
    return { code, stdout, stderr, socketUrl };
  } finally {
    timers.forEach(clearTimeout);
    for (const client of ws.clients) client.terminate();
    await new Promise<void>(resolve => ws.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
}

it('preserves capture bytes and metadata in one-shot JSON without history_end', async () => {
  const frame = snapshot('first\n');
  const result = await runLogs(['--json'], [frame]);
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ transport: 'runner', captures: frame.captures, logs: 'first\n' });
});

it('does not append whole replacement tails during human follow', async () => {
  const result = await runLogs(['--follow'], [snapshot('first\n'), snapshot('first\n'),
    snapshot('first\nsecond\n'), snapshot('second\nthird\n', 'one', true), snapshot('rotated\n', 'two')]);
  expect(result.code, result.stderr).toBe(130);
  expect(result.stdout).toBe('first\nsecond\nrotated\n');
  expect(result.stderr).toContain('continuity unavailable');
  expect(result.stderr).toContain('replacement generation');
});

it('streams distinct JSON replacement snapshots with metadata', async () => {
  const result = await runLogs(['--follow', '--json'], [snapshot('a'), snapshot('a'), snapshot('ab')]);
  expect(result.code, result.stderr).toBe(130);
  const values = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  expect(values.map(value => value.logs)).toEqual(['a', 'ab']);
  expect(values[1].captures[0].file_generation).toBe('one');
});

it.each(['unsupported', 'offline', 'unavailable'])('reports %s rather than empty logs', async unavailable => {
  const result = await runLogs(['--json'], [{ event: 'captured_logs', agent_id: id, transport: 'runner', logs: null, unavailable, captures: [] }]);
  expect(result.code, result.stderr).toBe(1);
  expect(JSON.parse(result.stdout).unavailable).toBe(unavailable);
  expect(result.stderr).toContain(unavailable);
});

it('preserves empty available capture as distinct from unavailable', async () => {
  const result = await runLogs(['--json'], [snapshot('')]);
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ logs: '', unavailable: null });
});

it('surfaces server errors without fabricating a snapshot', async () => {
  const result = await runLogs(['--json'], [{ event: 'error', detail: 'runner unavailable' }]);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('runner unavailable');
});

it('forwards bounded source/generation selection through the SDK', async () => {
  const result = await runLogs(['--source', 'stderr', '--generation', 'previous', '--max-bytes', '2048', '--max-lines', '30'], [snapshot('')]);
  expect(result.code, result.stderr).toBe(0);
  const query = new URL(result.socketUrl, 'http://localhost').searchParams;
  expect(Object.fromEntries(['source', 'generation', 'max_bytes', 'max_lines'].map(key => [key, query.get(key)])))
    .toEqual({ source: 'stderr', generation: 'previous', max_bytes: '2048', max_lines: '30' });
});

it.each([['--source', 'bad'], ['--generation', 'bad'], ['--max-bytes', '65537'], ['--max-lines', '0']])(
  'rejects invalid %s %s before subscribing', async (flag, value) => {
    const result = await runLogs([flag, value], []);
    expect(result.code).toBe(2);
    expect(result.socketUrl).toBe('');
  });

it('retains hosted history behavior', async () => {
  const result = await runLogs(['--json'], [{ event: 'log', log: 'hosted line' }, { event: 'history_end' }]);
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual(['hosted line']);
});
