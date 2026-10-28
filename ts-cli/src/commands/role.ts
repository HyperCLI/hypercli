import type { CommandGroup } from '../core/types.js';
import { runRoleShorthand } from './metadata.js';

export const role: CommandGroup = {
  name: 'role',
  summary: 'Read or set the resolved Agent role identifier (not a role document).',
  usage: ['hyper role [--agent <id>] [value] [--json]'],
  run: (ctx, args) => runRoleShorthand(ctx, args, role),
};

export default role;
