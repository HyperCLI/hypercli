import { describe, expect, it } from 'vitest';

import {
  CONTROL_UI_ALLOWED_ORIGIN_WILDCARD,
  mergeControlUiAllowedOrigins,
  normalizeControlUiOrigin,
  parseControlUiAllowedOrigins,
} from '../src/openclaw-control-ui-origin.js';

describe('normalizeControlUiOrigin (display only, not the env contract)', () => {
  it('canonicalizes http(s) URLs to their origin', () => {
    expect(normalizeControlUiOrigin(' https://agents.hypercli.com/path?token=secret#frag '))
      .toBe('https://agents.hypercli.com');
    expect(normalizeControlUiOrigin('http://localhost:1420/')).toBe('http://localhost:1420');
  });

  it('keeps tauri origins verbatim and lowercases the host', () => {
    expect(normalizeControlUiOrigin('tauri://localhost/')).toBe('tauri://localhost');
    expect(normalizeControlUiOrigin('tauri://LOCALHOST')).toBe('tauri://localhost');
  });

  it('passes the wildcard through', () => {
    expect(normalizeControlUiOrigin('*')).toBe(CONTROL_UI_ALLOWED_ORIGIN_WILDCARD);
  });

  it('rejects non-display and credentialed URLs', () => {
    expect(normalizeControlUiOrigin('javascript:alert(1)')).toBeNull();
    expect(normalizeControlUiOrigin('https://user:pw@example.com')).toBeNull();
    expect(normalizeControlUiOrigin('not a url')).toBeNull();
    expect(normalizeControlUiOrigin(42)).toBeNull();
  });
});

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
    expect(parseControlUiAllowedOrigins('*')).toEqual([CONTROL_UI_ALLOWED_ORIGIN_WILDCARD]);
    expect(parseControlUiAllowedOrigins('https://a.example, *'))
      .toEqual([CONTROL_UI_ALLOWED_ORIGIN_WILDCARD]);
    expect(parseControlUiAllowedOrigins('["*","https://a.example"]'))
      .toEqual([CONTROL_UI_ALLOWED_ORIGIN_WILDCARD]);
  });

  it('drops empties rather than throwing', () => {
    expect(parseControlUiAllowedOrigins('["unterminated')).toEqual([]);
    expect(parseControlUiAllowedOrigins(' , , ')).toEqual([]);
    expect(parseControlUiAllowedOrigins(null)).toEqual([]);
    expect(parseControlUiAllowedOrigins(42)).toEqual([]);
    expect(parseControlUiAllowedOrigins(['', '  ', 'https://a.example'])).toEqual(['https://a.example']);
  });
});

describe('mergeControlUiAllowedOrigins', () => {
  it('unions mixed sources, deduplicated in first-seen order', () => {
    expect(mergeControlUiAllowedOrigins(
      ['https://console.hypercli.com'],
      'https://old.example https://console.hypercli.com',
      '["tauri://localhost"]',
      undefined,
      null,
    )).toEqual([
      'https://console.hypercli.com',
      'https://old.example',
      'tauri://localhost',
    ]);
  });

  it('collapses to the wildcard when any source carries it', () => {
    expect(mergeControlUiAllowedOrigins('https://a.example', '*')).toEqual(['*']);
    expect(mergeControlUiAllowedOrigins('*', 'https://a.example')).toEqual(['*']);
  });

  it('produces an empty list for no sources', () => {
    expect(mergeControlUiAllowedOrigins([], undefined, null)).toEqual([]);
  });
});
