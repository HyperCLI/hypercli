import { describe, expect, it } from 'vitest';
import type WebSocket from 'ws';
import { ShellSession } from '../src/jobs.js';

function makeShellSocket() {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {};
  return {
    sent: [] as string[],
    closed: false,
    on(event: string, handler: (...args: any[]) => void) {
      (handlers[event] ??= []).push(handler);
      return this;
    },
    send(data: unknown) {
      this.sent.push(String(data));
    },
    close() {
      this.closed = true;
    },
    emit(event: string, ...args: any[]) {
      for (const handler of handlers[event] ?? []) handler(...args);
    },
  } as unknown as WebSocket & {
    sent: string[];
    closed: boolean;
    emit: (event: string, ...args: any[]) => void;
  };
}

describe('ShellSession', () => {
  it('sends stdin data while open', () => {
    const ws = makeShellSocket();
    const session = new ShellSession(ws);
    session.send('ls -la\n');
    expect(ws.sent).toEqual(['ls -la\n']);
    expect(session.closed).toBe(false);
  });

  it('sends xterm resize escape sequence', () => {
    const ws = makeShellSocket();
    const session = new ShellSession(ws);
    session.resize(120, 35);
    expect(ws.sent).toEqual(['\x1b[8;35;120t']);
  });

  it('dispatches text output to onOutput and decodes binary frames', () => {
    const ws = makeShellSocket();
    const outputs: string[] = [];
    new ShellSession(ws, (data) => outputs.push(data));
    ws.emit('message', 'text-line');
    ws.emit('message', Buffer.from('binary-bytes'));
    expect(outputs).toEqual(['text-line', 'binary-bytes']);
  });

  it('ignores output after close', () => {
    const ws = makeShellSocket();
    const outputs: string[] = [];
    const session = new ShellSession(ws, (data) => outputs.push(data));
    session.close();
    ws.emit('message', 'late');
    expect(outputs).toEqual([]);
    expect(session.closed).toBe(true);
  });

  it('invokes onClose with the close reason', () => {
    const ws = makeShellSocket();
    const closes: string[] = [];
    const session = new ShellSession(ws, undefined, (reason) => closes.push(reason));
    ws.emit('close', 1000, Buffer.from('done'));
    expect(closes).toEqual(['done']);
    expect(session.closed).toBe(true);
    expect(() => session.send('x')).not.toThrow();
  });

  it('invokes onClose with the error message on socket error', () => {
    const ws = makeShellSocket();
    const closes: string[] = [];
    new ShellSession(ws, undefined, (reason) => closes.push(reason));
    ws.emit('error', new Error('connection reset'));
    expect(closes).toEqual(['connection reset']);
  });
});
