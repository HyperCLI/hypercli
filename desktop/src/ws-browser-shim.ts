// Browser shim for the Node `ws` package. The SDK's ACP client selects
// `NodeWebSocket ?? globalThis.WebSocket`; exporting the native class keeps
// that fallback honest while the dev server serves the real bridge.
const NativeWebSocket = globalThis.WebSocket;
export default NativeWebSocket;
export { NativeWebSocket as WebSocket };
