import { createRequire } from 'node:module';

// Native ESM has no global require, including on supported Node 18 runtimes.
const nodeRequire = createRequire(import.meta.url);

export function getNodeRequire(): ReturnType<typeof createRequire> {
  return nodeRequire;
}
