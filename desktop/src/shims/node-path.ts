// Browser stand-in for the Node `path` builtin.
//
// ts-sdk imports `basename` at module scope (files.ts, job/comfyui.ts). Vite
// replaces bare Node builtins with a stub that throws on *any* property access,
// so that import alone blanks the app in dev — while the production build gets
// away with it because the throw only happens if the export is touched. Same
// code, different failure, which is exactly the dev/packaged split we are
// trying to remove.
//
// `basename` needs no filesystem, so implement it rather than stub it.
export function basename(input: string, ext?: string): string {
  const normalized = String(input).replace(/[\/]+$/, "");
  const name = normalized.slice(Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\")) + 1);
  return ext && name.endsWith(ext) && name !== ext ? name.slice(0, -ext.length) : name;
}

export function extname(input: string): string {
  const name = basename(input);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

export function join(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/{2,}/g, "/");
}

export default { basename, extname, join };
