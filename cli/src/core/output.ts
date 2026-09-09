/**
 * Output discipline:
 *
 * - JSON mode: stdout receives exactly one `JSON.stringify` of the result
 *   plus a trailing newline. Nothing else may be written to stdout; progress
 *   and diagnostics go to stderr via `output.info()`.
 * - Table mode: human-readable aligned columns (see core/table.ts). Commands
 *   must pass an explicit TableData or a preformatted string; there is no
 *   auto-rendering of raw data.
 */

import { formatTable } from './table.js';

export type OutputFormat = 'table' | 'json';

export interface TableData {
  columns: string[];
  rows: unknown[][];
}

export interface Output {
  readonly format: OutputFormat;

  /**
   * Emit the command's result.
   * - json:  writes `JSON.stringify(data)` + '\n' to stdout. `table` ignored.
   * - table: writes the rendered table/string to stdout. In table mode you
   *   MUST pass `table` (TableData or preformatted string); without it the
   *   data is not rendered, only surfaced in JSON mode.
   */
  result(data: unknown, table?: TableData | string): void;

  /** Progress / diagnostic message to stderr. Never stdout. */
  info(message: string): void;
}

export function createOutput(format: OutputFormat): Output {
  return {
    format,
    result(data: unknown, table?: TableData | string): void {
      if (format === 'json') {
        process.stdout.write(`${JSON.stringify(data)}\n`);
        return;
      }
      const text =
        typeof table === 'string'
          ? table
          : table
            ? formatTable(table.columns, table.rows)
            : undefined;
      if (!text) return;
      process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
    },
    info(message: string): void {
      process.stderr.write(`${message}\n`);
    },
  };
}
