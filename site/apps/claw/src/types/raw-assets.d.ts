// Ambient module declarations for compile-time raw asset imports.
// Turbopack resolves these via `with { turbopackModuleType: "raw" }`
// attributes at the import site; webpack via next.config asset/source rules.
declare module "*.md" {
  const content: string;
  export default content;
}
