import { createRequire } from 'node:module';

// Shared by source consumers and published ESM, including Node 18.
const nodeRequire = createRequire(import.meta.url);

export function getNodeRequire() {
  return nodeRequire;
}
