import { describe, expect, it } from 'vitest';

import {
  mergeControlUiAllowedOrigins,
  normalizeControlUiOrigin,
  parseControlUiAllowedOrigins,
} from '../src/openclaw-control-ui-origin.js';

describe('normalizeControlUiOrigin', () => {
  it('canonicalizes http(s) URLs to their origin', () => {
    expect(normalizeControlUiOrigin(' https://agents.hypercli.com/path?token=secret#frag '))
      .toBe('https://agents.hypercli.com');
    expect(normalizeControlUiOrigin('http://localhost:1420/')).toBe('http://localhost:1420');
    expect(normalizeControlUiOrigin('https://example.com:443/x')).toBe('https://example.com');
  });

  it('keeps tauri origins verbatim (URL.origin cannot represent them)', () => {
    expect(normalizeControlUiOrigin('tauri://localhost')).toBe('tauri://localhost');
    expect(normalizeControlUiOrigin('tauri://localhost/')).toBe('tauri://localhost');
  });

  it('lowercases the tauri host (the gateway lowercases before exact-matching)', () => {
    expect(normalizeControlUiOrigin('tauri://LOCALHOST')).toBe('tauri://localhost');
  });

  it('rejects schemes outside the allowlist instead of reflecting them', () => {
    expect(normalizeControlUiOrigin('ftp://example.com')).toBeNull();
    expect(normalizeControlUiOrigin('javascript:alert(1)')).toBeNull();
    expect(normalizeControlUiOrigin('data:text/plain,secret')).toBeNull();
  });

  it('rejects credentialed and unparseable URLs', () => {
    expect(normalizeControlUiOrigin('https://user:token-secret@example.com')).toBeNull();
    expect(normalizeControlUiOrigin('https://user@example.com')).toBeNull();
    expect(normalizeControlUiOrigin('not a url')).toBeNull();
    expect(normalizeControlUiOrigin('')).toBeNull();
    expect(normalizeControlUiOrigin(undefined)).toBeNull();
    expect(normalizeControlUiOrigin(42)).toBeNull();
  });
});

describe('parseControlUiAllowedOrigins', () => {
  it('accepts space- and comma-separated env strings', () => {
    expect(parseControlUiAllowedOrigins('https://one.example  https://two.example'))
      .toEqual(['https://one.example', 'https://two.example']);
    expect(parseControlUiAllowedOrigins('https://one.example,https://two.example/path'))
      .toEqual(['https://one.example', 'https://two.example']);
    expect(parseControlUiAllowedOrigins('https://one.example, https://two.example https://one.example'))
      .toEqual(['https://one.example', 'https://two.example']);
  });

  it('accepts JSON arrays and raw string arrays', () => {
    expect(parseControlUiAllowedOrigins('["https://a.example","tauri://localhost"]'))
      .toEqual(['https://a.example', 'tauri://localhost']);
    expect(parseControlUiAllowedOrigins(['https://a.example/file', 'ftp://nope.example']))
      .toEqual(['https://a.example']);
  });

  it('drops garbage rather than throwing', () => {
    expect(parseControlUiAllowedOrigins('["unterminated')).toEqual([]);
    expect(parseControlUiAllowedOrigins('javascript:alert(1), https://ok.example'))
      .toEqual(['https://ok.example']);
    expect(parseControlUiAllowedOrigins(null)).toEqual([]);
    expect(parseControlUiAllowedOrigins(42)).toEqual([]);
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

  it('produces an empty list when nothing is expressible', () => {
    expect(mergeControlUiAllowedOrigins([], 'ftp://nope.example', undefined)).toEqual([]);
  });
});
