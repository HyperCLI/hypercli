import type { CommandGroup } from '../core/types.js';
import { runAgentMetadata } from './metadata.js';

export const agent: CommandGroup = {
  name: 'agent',
  summary: 'Read or update canonical Agent semantic metadata.',
  usage: [
    'hyper agent <id> soul [-f <file>|-] [--json]',
    'hyper agent <id> role [value] [--json]',
  ],
  run: (ctx, args) => runAgentMetadata(ctx, args, agent),
};

export default agent;
