import { describe, expect, it } from 'vitest';
import { cellText, formatTable } from '../src/core/table.js';

describe('formatTable', () => {
  it('aligns columns to the widest cell with two-space separators', () => {
    const out = formatTable(
      ['NAME', 'STATUS'],
      [
        ['alpha', 'running'],
        ['b', 'stopped'],
      ],
    );
    expect(out).toBe(['NAME   STATUS', 'alpha  running', 'b      stopped'].join('\n'));
  });

  it('renders null/undefined as empty and trims trailing padding', () => {
    const out = formatTable(['A', 'B'], [['x', null], ['longer', undefined]]);
    expect(out).toBe(['A       B', 'x', 'longer'].join('\n'));
  });

  it('stringifies non-string cells', () => {
    expect(cellText(3)).toBe('3');
    expect(cellText(true)).toBe('true');
    expect(cellText({ a: 1 })).toBe('{"a":1}');
    expect(cellText(null)).toBe('');
  });
});
