// Stub for Node.js `fs` module — used by @hypercli.com/sdk's comfyui.js
// which is never actually called in the browser.
export function readFileSync() {
  throw new Error("fs.readFileSync is not available in the browser");
}
export default { readFileSync };
