import { describe, expect, it } from 'vitest';

import { parseControlUiAllowedOrigins } from '../src/openclaw-control-ui-origin.js';

describe('parseControlUiAllowedOrigins', () => {
  it('accepts space- and comma-separated env strings', () => {
    expect(parseControlUiAllowedOrigins('https://one.example  https://two.example'))
      .toEqual(['https://one.example', 'https://two.example']);
    expect(parseControlUiAllowedOrigins('https://one.example,https://two.example/path'))
      .toEqual(['https://one.example', 'https://two.example/path']);
    expect(parseControlUiAllowedOrigins('https://one.example, https://two.example https://one.example'))
      .toEqual(['https://one.example', 'https://two.example']);
  });

  it('accepts JSON arrays and raw string arrays', () => {
    expect(parseControlUiAllowedOrigins('["https://a.example","tauri://localhost"]'))
      .toEqual(['https://a.example', 'tauri://localhost']);
    expect(parseControlUiAllowedOrigins([' https://a.example ', 'tauri://localhost']))
      .toEqual(['https://a.example', 'tauri://localhost']);
  });

  it('passes entries through verbatim (no scheme validation)', () => {
    // The env is a user-controlled full replace: the SDK splits and trims,
    // it does not police what counts as an origin.
    expect(parseControlUiAllowedOrigins('javascript:alert(1), ftp://x.example'))
      .toEqual(['javascript:alert(1)', 'ftp://x.example']);
    expect(parseControlUiAllowedOrigins('https://user:pw@example.com'))
      .toEqual(['https://user:pw@example.com']);
  });

  it('collapses to the wildcard when any entry is *', () => {
    expect(parseControlUiAllowedOrigins('*')).toEqual(['*']);
    expect(parseControlUiAllowedOrigins('https://a.example, *')).toEqual(['*']);
    expect(parseControlUiAllowedOrigins('["*","https://a.example"]')).toEqual(['*']);
  });

  it('drops empties rather than throwing', () => {
    expect(parseControlUiAllowedOrigins('["unterminated')).toEqual([]);
    expect(parseControlUiAllowedOrigins(' , , ')).toEqual([]);
    expect(parseControlUiAllowedOrigins(null)).toEqual([]);
    expect(parseControlUiAllowedOrigins(42)).toEqual([]);
    expect(parseControlUiAllowedOrigins(['', '  ', 'https://a.example'])).toEqual(['https://a.example']);
  });
});
