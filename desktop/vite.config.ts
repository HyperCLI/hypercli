import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { join } from "node:path";
import { defineConfig } from "vite";
import { DEV_PROXY_PREFIX, PROXY_PREFIXES } from "./src/lib/endpoints";

/**
 * Dev proxy target.
 *
 * The API gateway allows both packaged origins (`http://tauri.localhost`,
 * `tauri://localhost`) but not the Vite dev origin `http://localhost:1420` —
 * measured on every route the app calls. So in dev the app talks to its own
 * origin and Vite forwards upstream, which takes CORS out of the picture
 * rather than working around it.
 *
 * Every proxied route lives under `/api` (e.g. `/api/agents/...` ->
 * `<target>/agents/...`), so in devtools backend traffic is visibly distinct
 * from app-served traffic. The proxy strips the prefix and only forwards.
 *
 * This is a plain pass-through. It deliberately does NOT re-implement any API
 * surface: the previous incarnation of this file ran ts-sdk in Node and served
 * the frontend a parallel implementation, which is why "works in dev, broken
 * when packaged" was possible at all. Dev and packaged now run the same client
 * code over the same protocol.
 */
const API_TARGET = process.env.HYPER_API_BASE ?? "https://api.hypercli.com";

const proxy = Object.fromEntries(
  PROXY_PREFIXES.map((prefix) => [
    `${DEV_PROXY_PREFIX}${prefix}`,
    {
      target: API_TARGET,
      changeOrigin: true,
      rewrite: (path: string) => path.slice(DEV_PROXY_PREFIX.length),
      configure: (server: { on: (event: string, fn: (req: unknown) => void) => void }) => {
        server.on("proxyReq", (proxyReq) => {
          // Present the upstream's own origin rather than the dev server's,
          // which is not on the gateway's allow-list. The browser sees a
          // same-origin response either way.
          (proxyReq as { setHeader: (k: string, v: string) => void }).setHeader("origin", API_TARGET);
        });
      },
    },
  ]),
);

const shim = (file: string) => join(import.meta.dirname, "src/shims", file);

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // Load-bearing, not leftover: ts-sdk's ACP client resolves
      // `NodeWebSocket ?? globalThis.WebSocket` (acp.ts) and so *prefers* the
      // `ws` import. Aliasing it to a native-WebSocket shim is what makes ACP
      // work in the browser bundle. Removing this breaks chat.
      { find: /^ws$/, replacement: join(import.meta.dirname, "src/ws-browser-shim.ts") },

      // ts-sdk imports these Node builtins at module scope, as BARE specifiers.
      // Match bare only: a `node:`-prefixed import is unambiguously Node code
      // (test helpers, config) and must resolve normally. Vite's default
      // replacement throws on *any* property access, so in dev the import
      // alone blanks the app, while the production build survives because the
      // export is never touched. Real shims make both modes behave the same.
      { find: /^path$/, replacement: shim("node-path.ts") },
      { find: /^fs$/, replacement: shim("node-fs.ts") },
      { find: /^node:crypto$/, replacement: shim("node-crypto.ts") },
    ],
  },
  define: {
    // Dev-only credential injection, so a plain browser tab runs the same code
    // paths as the packaged app instead of dead-ending at Tauri IPC. Guarded on
    // `command === "serve"`: this must never reach a shipped bundle, and an
    // empty string is what the app sees if the env var is unset.
    __HYPER_DEV_API_KEY__: JSON.stringify(
      command === "serve" ? (process.env.HYPER_API_KEY ?? process.env.HYPERCLI_API_KEY ?? "") : "",
    ),
    __HYPER_DEV_API_BASE__: JSON.stringify(
      command === "serve" ? `${API_TARGET.replace(/\/+$/, "")}/agents` : "",
    ),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // WebSockets are not proxied: they are not CORS-gated, so they dial the
    // real host directly in both dev and packaged, using the `ws_url` each
    // token response hands back.
    proxy,
  },
  build: {
    target: "es2022",
  },
}));
