import { NextResponse } from 'next/server';

// x402scan discovery document
// Lists all x402-enabled resources for automatic indexing
export async function GET() {
  const discovery = {
    x402Version: 2,
    resources: [
      {
        url: "https://api.hyperclaw.app/api/x402/1aiu",
        method: "POST",
        description: "Subscribe to 1 AIU - 50,000 TPM, 1,000 RPM ($25/32 days)",
        network: "eip155:8453",
        payTo: "0x657baDC86C3169505435dc4DB34803CDd91446E0",
        minAmount: "10000",
        asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
      },
      {
        url: "https://api.hyperclaw.app/api/x402/5aiu",
        method: "POST",
        description: "Subscribe to 5 AIU - 250,000 TPM, 5,000 RPM ($100/32 days)",
        network: "eip155:8453",
        payTo: "0x657baDC86C3169505435dc4DB34803CDd91446E0",
        minAmount: "10000",
        asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
      },
      {
        url: "https://api.hyperclaw.app/api/x402/10aiu",
        method: "POST",
        description: "Subscribe to 10 AIU - 500,000 TPM, 10,000 RPM ($175/32 days)",
        network: "eip155:8453",
        payTo: "0x657baDC86C3169505435dc4DB34803CDd91446E0",
        minAmount: "10000",
        asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
      }
    ]
  };

  return NextResponse.json(discovery);
}
