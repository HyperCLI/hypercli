import { NextResponse } from 'next/server';

// x402scan discovery document
// Lists all x402-enabled resources for automatic indexing
export async function GET() {
  const discovery = {
    x402Version: 2,
    resources: [
      {
        url: "https://api.hypercli.com/agents/x402/solo",
        method: "POST",
        description: "Subscribe to Solo - 1 small agent, 25M TPD ($39/32 days)",
        network: "eip155:8453",
        payTo: "0x657baDC86C3169505435dc4DB34803CDd91446E0",
        minAmount: "10000",
        asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
      },
      {
        url: "https://api.hypercli.com/agents/x402/team",
        method: "POST",
        description: "Subscribe to Team - up to 3 medium agents, 50M pooled TPD ($79/32 days)",
        network: "eip155:8453",
        payTo: "0x657baDC86C3169505435dc4DB34803CDd91446E0",
        minAmount: "10000",
        asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
      },
      {
        url: "https://api.hypercli.com/agents/x402/pro",
        method: "POST",
        description: "Subscribe to Pro - up to 3 large agents, 100M pooled TPD ($149/32 days)",
        network: "eip155:8453",
        payTo: "0x657baDC86C3169505435dc4DB34803CDd91446E0",
        minAmount: "10000",
        asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
      }
    ]
  };

  return NextResponse.json(discovery);
}
