import type { CommandGroup } from '../core/types.js';
import { runUserProfile } from './metadata.js';

export const user: CommandGroup = {
  name: 'user',
  summary: 'Read or update the account profile Markdown from Backend metadata.',
  usage: ['hyper user [-f <file>|-] [--json]'],
  run: (ctx, args) => runUserProfile(ctx, args, user),
};

export default user;
