import type { CommandGroup } from '../core/types.js';
import { runUserProfile } from './metadata.js';

export const user: CommandGroup = {
  name: 'user',
  summary: 'Read canonical USER or update it with Backend user-family write access.',
  usage: ['hyper user [-f <file>|-] [--json]'],
  run: (ctx, args) => runUserProfile(ctx, args, user),
};

export default user;
