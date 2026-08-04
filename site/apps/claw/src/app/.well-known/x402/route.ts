import { NextRequest, NextResponse } from "next/server";
import { API_BASE_URL } from "@/lib/api";
import { createPublicHyperAgentClient } from "@/lib/agent-client";

// x402scan discovery document
// Lists all x402-enabled resources for automatic indexing
export async function GET(request: NextRequest) {
  const agentsBaseUrl = new URL(API_BASE_URL, request.nextUrl.origin).toString().replace(/\/+$/, "");

  try {
    // HyperAgent.plans() and the public plans.json route share the backend's
    // PUBLIC_PLANS_JSON seed; discovery deliberately uses the SDK boundary.
    const plans = await createPublicHyperAgentClient(request.nextUrl.origin).plans();
    const resources = plans.flatMap((plan) => {
      const id = plan.id.trim();
      const name = plan.name.trim();
      if (!id || !name) return [];
      return [{
        url: `${agentsBaseUrl}/x402/${encodeURIComponent(id)}`,
        method: "POST",
        description: `Subscribe to ${name}`,
        network: "eip155:8453",
        payTo: "0x657baDC86C3169505435dc4DB34803CDd91446E0",
        minAmount: "10000",
        asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      }];
    });

    return NextResponse.json({ x402Version: 2, resources });
  } catch {
    return NextResponse.json(
      { x402Version: 2, resources: [], error: "Plan catalog unavailable" },
      { status: 503 },
    );
  }
}
