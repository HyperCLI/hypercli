import { HTTPClient } from "@hypercli.com/sdk/http";
import { API_BASE_URL } from "@/lib/api";

export interface TrialCheckoutRequest {
  successUrl?: string;
  cancelUrl?: string;
}

export interface TrialCheckoutResponse {
  checkoutUrl: string;
  checkoutSessionId: string | null;
  checkoutAttemptId: string | null;
}

export class TrialCheckoutError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly detail: string,
    public readonly method: string,
    public readonly url: string,
  ) {
    super(`Trial checkout failed: ${detail}`);
    this.name = "TrialCheckoutError";
  }
}

function resolveAgentsApiBaseUrl(origin?: string): string {
  if (!API_BASE_URL.startsWith("/")) return API_BASE_URL.replace(/\/+$/, "");
  if (origin) return `${origin.replace(/\/+$/, "")}${API_BASE_URL}`;
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${API_BASE_URL}`;
  }
  return API_BASE_URL.replace(/\/+$/, "");
}

export async function startTrial(
  token: string,
  request: TrialCheckoutRequest = {},
  options: { origin?: string } = {},
): Promise<TrialCheckoutResponse> {
  const method = "POST";
  const baseUrl = resolveAgentsApiBaseUrl(options.origin);
  const url = `${baseUrl}/stripe/trial`;
  const client = new HTTPClient(baseUrl, token);
  let data: any;
  try {
    data = await client.post("/stripe/trial", {
      ...(request.successUrl !== undefined ? { success_url: request.successUrl } : {}),
      ...(request.cancelUrl !== undefined ? { cancel_url: request.cancelUrl } : {}),
    });
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) {
      const apiError = error as { statusCode?: unknown; detail?: unknown; url?: unknown };
      throw new TrialCheckoutError(
        typeof apiError.statusCode === "number" ? apiError.statusCode : 500,
        String(apiError.detail || "Request failed"),
        method,
        typeof apiError.url === "string" ? apiError.url : url,
      );
    }
    throw error;
  }

  const checkoutUrl = String(data?.checkout_url || "");
  if (!checkoutUrl) {
    throw new TrialCheckoutError(502, "Stripe returned an incomplete trial checkout", method, url);
  }
  return {
    checkoutUrl,
    checkoutSessionId: data?.session_id ? String(data.session_id) : null,
    checkoutAttemptId: data?.checkout_attempt_id ? String(data.checkout_attempt_id) : null,
  };
}
