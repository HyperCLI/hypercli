/**
 * The one place that builds the SDK client.
 *
 * Construction honors the SDK config precedence exactly:
 *   product key:  HYPER_API_KEY > HYPERCLI_API_KEY > ~/.hypercli/config
 *   agents key:   user key first, then HYPER_AGENTS_API_KEY fallback
 *   apiUrl:       HYPER_API_BASE / HYPERCLI_API_URL / config / default
 *   agents base:  AGENTS_API_BASE_URL, else dev base when --dev is set
 *
 * Throws (as a plain Error, mapped to exit 1 by the entrypoint) when no
 * credential is configured.
 */

import {
  HyperCLI,
  getAgentApiKey,
  getAgentsApiBaseUrl,
  getApiKey,
  getApiUrl,
} from '@hypercli.com/sdk';

export function createClient(dev: boolean): HyperCLI {
  return new HyperCLI({
    apiKey: getApiKey(),
    agentApiKey: getAgentApiKey(),
    apiUrl: getApiUrl(),
    agentsApiBaseUrl: getAgentsApiBaseUrl(dev),
    agentDev: dev,
  });
}

/** Lazily-built singleton for CommandContext.client(). */
export function lazyClient(dev: boolean): () => Promise<HyperCLI> {
  let cached: HyperCLI | undefined;
  return async () => {
    if (!cached) cached = createClient(dev);
    return cached;
  };
}
