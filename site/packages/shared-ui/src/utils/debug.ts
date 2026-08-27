// Debug logging helper - logs in development or when explicitly enabled.
// Dev servers (next dev / vitest) always log; production bundles stay silent
// unless NEXT_PUBLIC_AUTH_DEBUG=true is set. Keep this helper out of hot
// render paths in prod: guard expensive argument construction behind
// `isDebugLogging()` when the args are not already in scope.
const DEBUG =
  process.env.NEXT_PUBLIC_AUTH_DEBUG === 'true' ||
  process.env.NODE_ENV !== 'production'

export const isDebugLogging = () => DEBUG

export const debugLog = (...args: any[]) => {
  if (DEBUG) {
    console.log(...args)
  }
}
