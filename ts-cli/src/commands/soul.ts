import type { CommandGroup } from '../core/types.js';
import { runSoulShorthand } from './metadata.js';

export const soul: CommandGroup = {
  name: 'soul',
  summary: 'Read or update the resolved Agent soul from Backend metadata.',
  usage: ['hyper soul [--agent <id>] [-f <file>|-] [--json]'],
  run: (ctx, args) => runSoulShorthand(ctx, args, soul),
};

export default soul;
