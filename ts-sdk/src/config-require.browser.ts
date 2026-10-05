// Browser/default resolution must not import Node builtins, even transitively.
export function getNodeRequire(): null {
  return null;
}
