import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildChatIntegrationConfig } from '../src/connectors.js';
import type { ChatIntegration } from '../src/chat-integrations.js';

const fixtures = JSON.parse(readFileSync(new URL('../../tests/fixtures/chat-integrations.json', import.meta.url), 'utf8'));
for (const integration of ['buzz', 'teams', 'telegram'] as const) {
  for (const valid of [true, false]) {
    for (const authority of fixtures.urlAuthorities[valid ? 'valid' : 'invalid']) {
      it(`${integration} URL authority ${authority} accepted=${valid}`, () => {
        const template = fixtures.valid.find((test: any) => test.integration === integration
          && (integration !== 'telegram' || test.values.TELEGRAM_MODE === 'webhook'));
        const values = { ...template.values };
        const url = `${integration === 'buzz' ? 'wss' : 'https'}://${authority}/`;
        values[integration === 'buzz' ? 'BUZZ_RELAY_URL' : integration === 'teams' ? 'TEAMS_TRUSTED_SERVICE_BASES' : 'TELEGRAM_WEBHOOK_URL']
          = integration === 'teams' ? JSON.stringify([url]) : url;
        if (valid) expect(() => buildChatIntegrationConfig(integration, values)).not.toThrow();
        else expect(() => buildChatIntegrationConfig(integration, values)).toThrow();
      });
    }
  }
}
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
