import { describe, expect, it } from 'vitest';
import { closestMatch } from '../src/core/help.js';

const CANDIDATES = [
  'agents',
  'compute',
  'configure',
  'flows',
  'knowledge',
  'me',
  'skills',
  'voice',
];

describe('closestMatch', () => {
  it('resolves an unambiguous prefix to the shortest match', () => {
    expect(closestMatch('comp', CANDIDATES)).toBe('compute');
    expect(closestMatch('ag', CANDIDATES)).toBe('agents');
  });

  it('picks the shortest prefix match', () => {
    expect(closestMatch('c', CANDIDATES)).toBe('compute');
  });

  it('falls back to a substring match', () => {
    expect(closestMatch('gent', CANDIDATES)).toBe('agents');
    expect(closestMatch('kill', CANDIDATES)).toBe('skills');
  });

  it('is case-insensitive', () => {
    expect(closestMatch('COMP', CANDIDATES)).toBe('compute');
  });

  it('returns undefined for empty or unrelated input', () => {
    expect(closestMatch('', CANDIDATES)).toBeUndefined();
    expect(closestMatch('zzz', CANDIDATES)).toBeUndefined();
  });
});
