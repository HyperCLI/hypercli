/**
 * The one place that builds the SDK client.
 *
 * Construction honors the SDK config precedence exactly:
 *   product key:  HYPER_API_KEY > $HYPER_HOME/config or ~/.hypercli/config
 *   agents key:   product key first, then HYPER_AGENTS_API_KEY fallback
 *   apiUrl:       HYPER_API_BASE / config / default
 *   agents base:  derived from the selected product base
 *
 * The retired HYPERCLI_API_URL / AGENTS_API_BASE_URL override envs are no
 * longer read anywhere; derive-only resolution lives in the SDK config.
 *
 * Throws (as a plain Error, mapped to exit 1 by the entrypoint) when no
 * credential is configured.
 */

import {
  HyperCLI,
  getAgentApiKey,
  getApiKey,
  getApiUrl,
} from '@hypercli.com/sdk';

/** Lazily-built singleton for CommandContext.client(). */
export function lazyClient(): () => Promise<HyperCLI> {
  let cached: HyperCLI | undefined;
  return async () => {
    if (!cached) {
      cached = new HyperCLI({
        apiKey: getApiKey(),
        agentApiKey: getAgentApiKey(),
        apiUrl: getApiUrl(),
      });
    }
    return cached;
  };
}
