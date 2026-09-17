import { describe, expect, it } from 'vitest';
import { parseCommandArgs, parseUniversal, resolveFormat } from '../src/core/argv.js';
import { UsageError } from '../src/core/errors.js';

describe('parseUniversal', () => {
  it('finds the group name among flags without rejecting unknown ones', () => {
    const parsed = parseUniversal(['--json', 'agents', 'ls', '--limit', '10']);
    expect(parsed.positionals[0]).toBe('agents');
    expect(parsed.format).toBe('json');
    expect(parsed.dev).toBe(false);
  });

  it('resolves --dev and -o json', () => {
    const parsed = parseUniversal(['status', '--dev', '-o', 'json']);
    expect(parsed.dev).toBe(true);
    expect(parsed.format).toBe('json');
  });

  it('firstPositionalIndex indexes the group token, not a flag value', () => {
    // Value-consuming flag before the group: splicing at firstPositionalIndex
    // removes the right token; textually searching would hit the flag value.
    const parsed = parseUniversal(['-o', 'json', 'agents', 'ls']);
    expect(parsed.positionals[0]).toBe('agents');
    expect(parsed.firstPositionalIndex).toBe(2);

    expect(parseUniversal(['agents']).firstPositionalIndex).toBe(0);
    expect(parseUniversal(['--json']).firstPositionalIndex).toBe(-1);
  });

  it('resolveFormat rejects unknown formats', () => {
    expect(() => resolveFormat({ output: 'yaml' })).toThrow(UsageError);
    expect(resolveFormat({ output: 'table' })).toBe('table');
    expect(resolveFormat({ json: true })).toBe('json');
  });
});

describe('parseCommandArgs', () => {
  it('accepts universal and declared options plus positionals', () => {
    const parsed = parseCommandArgs(['show', 'hyper', '--json'], {});
    expect(parsed.positionals).toEqual(['show', 'hyper']);
    expect(parsed.format).toBe('json');
    expect(parsed.help).toBe(false);
  });

  it('parses declared string and boolean options', () => {
    const parsed = parseCommandArgs(['--api-key', 'sk_x', '--force'], {
      'api-key': { type: 'string' },
      force: { type: 'boolean', default: false },
    });
    expect(parsed.values['api-key']).toBe('sk_x');
    expect(parsed.values.force).toBe(true);
  });

  it('throws UsageError (exit 2) on unknown flags and missing values', () => {
    expect(() => parseCommandArgs(['--nope'], {})).toThrow(UsageError);
    expect(() => parseCommandArgs(['--api-key'], { 'api-key': { type: 'string' } })).toThrow(UsageError);
    try {
      parseCommandArgs(['--nope'], {});
    } catch (err) {
      expect((err as UsageError).exitCode).toBe(2);
    }
  });

  it('-h maps to help', () => {
    expect(parseCommandArgs(['-h'], {}).help).toBe(true);
  });
});
