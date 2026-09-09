/**
 * `hyper configure` — write API credentials to ~/.hypercli/config.
 *
 * Non-interactive:  hyper configure --api-key sk_... [--api-url URL]
 * Interactive:      prompts with readline; empty input keeps current value.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { configure as saveConfig, getApiKey, getApiUrl } from '@hypercli.com/sdk';
import { parseCommandArgs } from '../core/argv.js';
import { UsageError } from '../core/errors.js';
import { renderGroupHelp } from '../core/help.js';
import type { CommandContext } from '../core/types.js';

export const name = 'configure';
export const summary = 'Configure your API key and API URL.';
export const usage = ['hyper configure [--api-key KEY] [--api-url URL]'];

function maskKey(key: string): string {
  return key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : '****';
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function run(ctx: CommandContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, {
    'api-key': { type: 'string' },
    'api-url': { type: 'string' },
  });
  if (parsed.help) {
    process.stdout.write(`${renderGroupHelp({ name, summary, usage, run })}\n`);
    return;
  }

  const currentKey = getApiKey();
  const currentUrl = getApiUrl();
  let apiKey = typeof parsed.values['api-key'] === 'string' ? parsed.values['api-key'].trim() : '';
  let apiUrl = typeof parsed.values['api-url'] === 'string' ? parsed.values['api-url'].trim() : '';

  if (!apiKey && !apiUrl) {
    if (!process.stdin.isTTY) {
      throw new UsageError('configure needs a TTY, or pass --api-key/--api-url');
    }
    ctx.output.info('Get your API key at https://hypercli.com/dashboard');
    if (currentKey) ctx.output.info(`Current API key: ${maskKey(currentKey)}`);
    apiKey = await prompt(`API key${currentKey ? ' (enter to keep current)' : ''}: `);
    apiUrl = await prompt('API URL (enter for default): ');
  }

  const finalKey = apiKey || currentKey;
  if (!finalKey) throw new UsageError('no API key provided');
  saveConfig(finalKey, apiUrl || undefined);

  const configFile = join(homedir(), '.hypercli', 'config');
  ctx.output.result(
    { configured: true, config_file: configFile, api_key: apiKey ? maskKey(finalKey) : undefined, api_url: apiUrl || undefined },
    `Config saved to ${configFile}\n  API key: ${apiKey ? maskKey(finalKey) : '(unchanged)'}\n  API URL: ${apiUrl || currentUrl}`,
  );
  ctx.output.info("Test your setup with: hyper me");
}
