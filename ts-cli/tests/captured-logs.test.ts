import { expect, it } from 'vitest';
import { capturedLogRenderer } from '../src/core/captured-logs.js';

it('renders verified append suffixes, marks rotation, and never guesses truncated overlap', () => {
  const text: string[] = [], notices: string[] = [];
  const render = capturedLogRenderer(value => text.push(value), value => notices.push(value));
  const capture = (body: string, file = 'one', truncated = false) => ({ source: 'stderr', generation: 'current',
    file_generation: file, launch_epoch: 1, content_base64: Buffer.from(body).toString('base64'), truncated, unavailable: null });
  const send = (value: ReturnType<typeof capture>) => render({ unavailable: null, captures: [value] });
  send(capture('first\n'));
  send(capture('first\n'));
  send(capture('first\nsecond\n'));
  send(capture('second\nthird\n', 'one', true));
  send(capture('rotated\n', 'two'));
  expect(text).toEqual(['first\n', 'second\n', 'rotated\n']);
  expect(notices.join('\n')).toContain('continuity unavailable');
  expect(notices.join('\n')).toContain('replacement generation');
});

it('distinguishes unavailable and empty captures', () => {
  const notices: string[] = [];
  const render = capturedLogRenderer(() => { throw new Error('unexpected content'); }, value => notices.push(value));
  render({ unavailable: 'offline', captures: [] });
  render({ unavailable: null, captures: [{ source: 'stdout', generation: 'previous', file_generation: 'one',
    launch_epoch: 1, content_base64: '', unavailable: null, truncated: false }] });
  expect(notices).toContain('runner logs unavailable: offline');
  expect(notices).toContain('stdout/previous: empty capture');
});

it('reports loss metadata even when captured bytes do not change', () => {
  const notices: string[] = [];
  const render = capturedLogRenderer(() => {}, value => notices.push(value));
  const capture = { source: 'stdout' as const, generation: 'current' as const, file_generation: 'one',
    launch_epoch: 1, content_base64: '', unavailable: null, truncated: false };
  render({ unavailable: null, captures: [capture] });
  render({ unavailable: null, captures: [{ ...capture, capture: { state: 'capturing', dropped_bytes: 12 }, diagnostics_dropped: 3 }] });
  expect(notices.join('\n')).toContain('capture dropped 12 bytes');
  expect(notices.join('\n')).toContain('3 diagnostics dropped');
});
