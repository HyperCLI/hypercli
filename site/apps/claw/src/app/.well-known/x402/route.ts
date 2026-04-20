import { NextResponse } from 'next/server';

// x402scan discovery document
// Lists all x402-enabled resources for automatic indexing
export async function GET() {
  const discovery = {
    x402Version: 2,
    resources: [
      {
        url: "https://api.hypercli.com/agents/x402/basic",
        method: "POST",
        description: "Subscribe to Basic - 1 small agent, 50M TPD ($20/32 days)",
        network: "eip155:8453",
        payTo: "0x657baDC86C3169505435dc4DB34803CDd91446E0",
        minAmount: "10000",
        asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
      },
      {
        url: "https://api.hypercli.com/agents/x402/plus",
        method: "POST",
        description: "Subscribe to Plus - 1 medium agent, 100M TPD ($40/32 days)",
        network: "eip155:8453",
        payTo: "0x657baDC86C3169505435dc4DB34803CDd91446E0",
        minAmount: "10000",
        asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
      },
      {
        url: "https://api.hypercli.com/agents/x402/pro",
        method: "POST",
        description: "Subscribe to Pro - 1 large agent, 250M TPD ($100/32 days)",
        network: "eip155:8453",
        payTo: "0x657baDC86C3169505435dc4DB34803CDd91446E0",
        minAmount: "10000",
        asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
      },
      {
        url: "https://api.hypercli.com/agents/x402/team",
        method: "POST",
        description: "Subscribe to Team - up to 2 large agents, 500M TPD ($200/32 days)",
        network: "eip155:8453",
        payTo: "0x657baDC86C3169505435dc4DB34803CDd91446E0",
        minAmount: "10000",
        asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
      },
      {
        url: "https://api.hypercli.com/agents/x402/_bundle",
        method: "POST",
        description: "Purchase an explicit bundle checkout such as { large: 2 }",
        network: "eip155:8453",
        payTo: "0x657baDC86C3169505435dc4DB34803CDd91446E0",
        minAmount: "10000",
        asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
      }
    ]
  };

  return NextResponse.json(discovery);
}
