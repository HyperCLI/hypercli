/**
 * The command contract every group implements against.
 *
 * ============================================================================
 * ctx contract (verbatim — all feature agents implement against this)
 * ============================================================================
 *
 *   ctx = {
 *     client(): Promise<HyperCLI>,   // lazily-built SDK client (see below)
 *     output: Output,                // see core/output.ts
 *     format: 'table' | 'json',      // resolved from --json / --output
 *     dev: boolean,                  // true when --dev was passed
 *   }
 *
 * In addition to ctx, run() receives:
 *
 *   args: string[],                  // raw argv remaining after the group name
 *
 * Rules for command implementers:
 *
 * - Parse `args` (the run() parameter, NOT ctx — ctx carries no argv) with
 *   `parseCommandArgs(args, options)` from core/argv.ts. Universal flags
 *   (--json, --dev, --help/-h, --output/-o) are always accepted; declare only
 *   your command-specific options. Unknown flags and bad values throw
 *   UsageError -> exit code 2.
 * - If the parsed `--help` flag is set, print your group's help and return.
 * - Call `ctx.client()` only when you actually need the API; it throws a
 *   CliError (exit 1) when no credential is configured.
 * - Emit results exclusively via `ctx.output.result(data, table?)`:
 *   --json prints exactly one JSON.stringify of `data` on stdout;
 *   table mode prints your aligned table. Progress goes to `ctx.output.info()`
 *   (stderr). Never call console.log / process.stdout directly.
 * - Throw `UsageError` for bad user input, `CliError` for expected failures.
 *   Anything else bubbles to the entrypoint: `error: <message>` on stderr,
 *   exit code 1.
 * - `run()` returns void (exit 0) or an explicit exit code number.
 *
 * ============================================================================
 */

import type { HyperCLI } from '@hypercli.com/sdk';
import type { Output, OutputFormat } from './output.js';

export interface CommandContext {
  /** Lazily-built SDK client. Construction is deferred until first call. */
  client(): Promise<HyperCLI>;
  /** Result/progress emitter honoring --json. See core/output.ts. */
  readonly output: Output;
  /** Resolved output format: 'table' (default) or 'json' (--json / -o json). */
  readonly format: OutputFormat;
  /** True when --dev was passed: route agent APIs at the dev API base. */
  readonly dev: boolean;
}

/**
 * A registered command group (also used for root commands — a root command
 * is just a group with no subcommands).
 */
export interface CommandGroup {
  /** Group name as typed on the command line, e.g. 'agents'. */
  readonly name: string;
  /** One-line description shown in root help. */
  readonly summary: string;
  /** Syntax lines shown in `hyper <name> --help`, e.g. 'hyper agents ls'. */
  readonly usage: readonly string[];
  /**
   * Execute the group. args = raw argv after the group name (the entrypoint
   * splices the group token out). Parse it with parseCommandArgs.
   */
  run(ctx: CommandContext, args: string[]): Promise<number | void>;
}
