import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildChatIntegrationConfig } from '../src/connectors.js';
import type { ChatIntegration } from '../src/chat-integrations.js';

const fixtures = JSON.parse(readFileSync(new URL('../../tests/fixtures/chat-integrations.json', import.meta.url), 'utf8'));
for (const test of fixtures.valid) {
  it(test.name, () => {
    const input = structuredClone(test.values);
    expect(buildChatIntegrationConfig(test.integration, input)).toEqual(test.expected);
    expect(input).toEqual(test.values);
  });
}
for (const test of fixtures.invalid) {
  it(test.name, () => {
    expect(() => buildChatIntegrationConfig(test.integration as ChatIntegration, test.values)).toThrow();
    try { buildChatIntegrationConfig(test.integration, test.values); }
    catch (error) { expect(String(error)).not.toContain('synthetic-private'); }
  });
}
