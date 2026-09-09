// Browser stand-in for the Node `fs` builtin.
//
// ts-sdk's upload helpers take either a path (Node) or bytes (browser). Only
// the path branch touches `fs`, and this app always passes bytes — but the
// import is at module scope, so it must resolve to something that does not
// throw until actually called.
function unavailable(name: string): never {
  throw new Error(
    `fs.${name} is not available in the desktop app. Pass file contents as bytes rather than a path.`,
  );
}

export function readFileSync(): never {
  return unavailable("readFileSync");
}

export function existsSync(): boolean {
  return false;
}

export default { readFileSync, existsSync };
