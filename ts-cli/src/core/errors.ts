/**
 * CLI errors and exit-code mapping.
 *
 * Exit codes (non-negotiable):
 *   0   success
 *   1   generic error (default)
 *   2   usage error (bad flags / bad arguments) — throw UsageError
 *   130 SIGINT (Ctrl+C) — handled by the entrypoint
 *
 * All errors print `error: <message>` to stderr, nothing to stdout.
 */

export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

export class UsageError extends CliError {
  constructor(message: string) {
    super(message, 2);
    this.name = 'UsageError';
  }
}

/** Print an error to stderr in the canonical `error: <message>` form. */
export function printError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`error: ${message}\n`);
}

/** Map any thrown value to a process exit code. */
export function exitCodeFor(err: unknown): number {
  if (err instanceof CliError) return err.exitCode;
  return 1;
}
