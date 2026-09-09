/**
 * Tiny aligned-column table printer. No dependencies.
 *
 * formatTable(['NAME', 'STATUS'], [['alpha', 'running'], ['beta', null]])
 * =>
 *   NAME   STATUS
 *   alpha  running
 *   beta
 *
 * Columns are padded with spaces to the widest cell, separated by two spaces.
 * No ANSI escapes are emitted, so widths are plain string lengths.
 */

export type TableCell = string | number | boolean | null | undefined;

/** Render a cell to display text: null/undefined -> '', objects -> JSON. */
export function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'string') return cell;
  if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell);
  return JSON.stringify(cell);
}

/** Format rows into aligned columns. Returns a single string, lines joined by '\n'. */
export function formatTable(columns: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const header = columns.map((c) => cellText(c));
  const body = rows.map((row) => row.map((cell) => cellText(cell)));

  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => (row[i] ?? '').length)),
  );

  const renderRow = (cells: string[]): string =>
    cells.map((cell, i) => (i < cells.length - 1 ? cell.padEnd(widths[i]) : cell)).join('  ').replace(/\s+$/, '');

  const lines = [renderRow(header)];
  for (const row of body) lines.push(renderRow(row));
  return lines.join('\n');
}

