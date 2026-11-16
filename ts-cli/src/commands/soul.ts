import type { CommandGroup } from '../core/types.js';
import { runSoulShorthand } from './metadata.js';

export const soul: CommandGroup = {
  name: 'soul',
  summary: 'Read canonical SOUL or update it with agents:* owner access (runtime self-writes denied).',
  usage: ['hyper soul [--agent <id>] [-f <file>|-] [--json]'],
  run: (ctx, args) => runSoulShorthand(ctx, args, soul),
};

export default soul;
