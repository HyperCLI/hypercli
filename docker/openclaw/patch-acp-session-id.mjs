// OpenClaw 2026.9.8's ACP newSession returns an ephemeral UUID while its
// session/list returns the persisted gateway key. Use the gateway's OWN key
// resolver before publishing the new identity; never infer aliases in clients.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function patchSessionIdentity(source, resolverFile, resolverExport) {
  const before = /const sessionId = randomUUID\(\);\s*const meta = parseSessionMeta\(params\["_meta"\]\);\s*const sessionKey = await this\.resolveSessionKeyFromMeta\(\{\s*meta,\s*fallbackKey: `acp-bridge:\$\{sessionId\}`\s*\}\);/g;
  if ([...source.matchAll(before)].length !== 1 || !source.includes("getRuntimeConfig")) {
    throw new Error("OpenClaw ACP newSession source changed; review identity patch");
  }
  if (!/^session-store-key-[\w-]+\.mjs$/.test(resolverFile) || !/^\w+$/.test(resolverExport)) {
    throw new Error("Unexpected OpenClaw session-key resolver export");
  }
  return `import { ${resolverExport} as hypercliResolveSessionStoreKey } from "./${resolverFile}";\n` + source.replace(before,
    `const generatedSessionId = randomUUID();
    const meta = parseSessionMeta(params["_meta"]);
    const sessionKey = hypercliResolveSessionStoreKey({
      cfg: getRuntimeConfig(),
      sessionKey: await this.resolveSessionKeyFromMeta({
        meta,
        fallbackKey: \`acp-bridge:\${generatedSessionId}\`
      })
    });
    const sessionId = sessionKey;`);
}

export function patchInstalledOpenClaw(root) {
  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  if (version !== "2026.9.8") throw new Error(`Review ACP identity patch for OpenClaw ${version}`);
  const dist = join(root, "dist");
  const resolvers = readdirSync(dist).filter((name) => /^session-store-key-[\w-]+\.mjs$/.test(name));
  if (resolvers.length !== 1) throw new Error("Expected one OpenClaw session-key resolver");
  const resolverFile = resolvers[0];
  const resolver = readFileSync(join(dist, resolverFile), "utf8");
  const exported = resolver.match(/\bresolveSessionStoreKey as (\w+)\b/g) ?? [];
  if (exported.length !== 1) throw new Error("Expected exported native session-key resolver");
  const resolverExport = exported[0].split(" ").at(-1);
  const candidates = readdirSync(dist).filter((name) => /^server-[\w-]+\.mjs$/.test(name))
    .map((name) => ({ name, source: readFileSync(join(dist, name), "utf8") }))
    .filter(({ source }) => source.includes("async newSession(params)")
      && source.includes("fallbackKey: `acp-bridge:${sessionId}`"));
  if (candidates.length !== 1) throw new Error("Expected one OpenClaw ACP lifecycle bundle");
  const { name, source } = candidates[0];
  writeFileSync(join(dist, name), patchSessionIdentity(source, resolverFile, resolverExport));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("usage: patch-acp-session-id.mjs OPENCLAW_ROOT");
  patchInstalledOpenClaw(process.argv[2]);
}
