import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_WS_DIR =
  "/app/dist/extensions/slack/node_modules/ws";

const WRAPPER_FILE = "wrapper.mjs";

const REQUIRED_LIB_FILES: readonly string[] = [
  "stream.js",
  "extension.js",
  "permessage-deflate.js",
  "receiver.js",
  "sender.js",
  "subprotocol.js",
  "websocket.js",
  "websocket-server.js",
];

// Byte-identical to the payload written by patch_slack_ws_wrapper.js: the
// createRequire facade routes the eight vendored ws internals and the
// WebSocket default export through the CJS loader on Node 24. Do not change.
const WRAPPER_PAYLOAD = `import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const createWebSocketStream = require('./lib/stream.js');
const extension = require('./lib/extension.js');
const PerMessageDeflate = require('./lib/permessage-deflate.js');
const Receiver = require('./lib/receiver.js');
const Sender = require('./lib/sender.js');
const subprotocol = require('./lib/subprotocol.js');
const WebSocket = require('./lib/websocket.js');
const WebSocketServer = require('./lib/websocket-server.js');

export {
  createWebSocketStream,
  extension,
  PerMessageDeflate,
  Receiver,
  Sender,
  subprotocol,
  WebSocket,
  WebSocketServer
};

export default WebSocket;
`;

interface WsPackageJson {
  version?: string;
  exports?: Record<string, unknown>;
}

export function patchSlackWsWrapper(wsDir: string = DEFAULT_WS_DIR): void {
  const wrapperPath = join(wsDir, WRAPPER_FILE);

  if (!existsSync(wrapperPath)) {
    throw new Error(
      `refusing to create ${wrapperPath}: the vendored ws layout changed ` +
        `(wrapper.mjs is absent), so this patch must be re-evaluated`,
    );
  }

  const pkgPath = join(wsDir, "package.json");
  let pkg: WsPackageJson;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as WsPackageJson;
  } catch (err) {
    throw new Error(
      `cannot read ${pkgPath}: the vendored ws layout changed, ` +
        `so this patch must be re-evaluated (${String(err)})`,
    );
  }

  const dotExport = pkg.exports?.["."];
  const importTarget =
    typeof dotExport === "object" && dotExport !== null
      ? (dotExport as Record<string, unknown>)["import"]
      : undefined;
  if (importTarget !== "./wrapper.mjs") {
    throw new Error(
      `ws exports drift: expected exports["."].import to route to ` +
        `"./wrapper.mjs" but found ${JSON.stringify(importTarget)}; ` +
        `this patch must be re-evaluated`,
    );
  }

  const missing = REQUIRED_LIB_FILES.map((name) => `lib/${name}`).filter(
    (rel) => !existsSync(join(wsDir, rel)),
  );
  if (missing.length > 0) {
    throw new Error(
      `vendored ws is missing lib files required by the wrapper patch: ` +
        missing.join(", "),
    );
  }

  console.log(`patching ws@${pkg.version ?? "unknown"} at ${wrapperPath}`);
  writeFileSync(wrapperPath, WRAPPER_PAYLOAD);
}

function main(): void {
  patchSlackWsWrapper(process.env.PATCH_WS_TARGET_DIR ?? DEFAULT_WS_DIR);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
