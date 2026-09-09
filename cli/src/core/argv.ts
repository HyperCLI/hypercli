/**
 * argv parsing on node:util parseArgs. No commander/yargs/typer.
 *
 * Universal flags understood everywhere:
 *   --json            machine output (single JSON.stringify on stdout)
 *   --output, -o FMT  'table' (default) or 'json'
 *   --dev             use the dev API base
 *   --help, -h        print help
 *
 * parseUniversal()  — non-strict top-level scan used by the entrypoint to
 *                     find the group name and global flags without rejecting
 *                     group-specific options.
 * parseCommandArgs()— strict parse inside a command group; merges the
 *                     universal options with group-specific ones and maps
 *                     parse failures to UsageError (exit 2).
 */

import { parseArgs, type ParseArgsConfig } from 'node:util';
import { UsageError } from './errors.js';
import type { OutputFormat } from './output.js';

type Options = NonNullable<ParseArgsConfig['options']>;

export const UNIVERSAL_OPTIONS: Options = {
  json: { type: 'boolean', default: false },
  output: { type: 'string', short: 'o' },
  dev: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
};

/**
 * Parsed argv shape shared by parseUniversal() and parseCommandArgs(). The
 * parsing behavior differs (non-strict vs strict) but the result shape is
 * identical.
 */
export interface ParsedArgs {
  values: Record<string, unknown>;
  positionals: string[];
  format: OutputFormat;
  dev: boolean;
  help: boolean;
}

/** Back-compat aliases — same shape as ParsedArgs. */
export type ParsedUniversal = ParsedArgs;
export type ParsedCommand = ParsedArgs;

/** Resolve the output format from --json / --output. */
export function resolveFormat(values: Record<string, unknown>): OutputFormat {
  const output = typeof values.output === 'string' ? values.output : undefined;
  if (values.json === true || output === 'json') return 'json';
  if (output !== undefined && output !== 'table') {
    throw new UsageError(`unknown output format '${output}' (expected 'table' or 'json')`);
  }
  return 'table';
}

/** Non-strict scan of full argv: never throws on unknown flags. */
export function parseUniversal(argv: string[]): ParsedUniversal {
  const { values, positionals } = parseArgs({
    args: argv,
    options: UNIVERSAL_OPTIONS,
    strict: false,
    allowPositionals: true,
  });
  return {
    values: values as Record<string, unknown>,
    positionals,
    format: resolveFormat(values as Record<string, unknown>),
    dev: values.dev === true,
    help: values.help === true,
  };
}

/**
 * Strict parse for inside a command group. Universal options are always
 * allowed; pass only group-specific options. Bad flags -> UsageError.
 */
export function parseCommandArgs(
  args: string[],
  options: Options = {},
  config: { allowPositionals?: boolean } = {},
): ParsedCommand {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: { ...UNIVERSAL_OPTIONS, ...options },
      allowPositionals: config.allowPositionals ?? true,
      strict: true,
    });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  const values = parsed.values as Record<string, unknown>;
  return {
    values,
    positionals: parsed.positionals,
    format: resolveFormat(values),
    dev: values.dev === true,
    help: values.help === true,
  };
}
