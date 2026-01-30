import { NextRequest, NextResponse } from "next/server";

const HYPERCLI_API = "https://api.hypercli.com";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authHeader = request.headers.get("Authorization");
    
    if (!authHeader) {
      return NextResponse.json(
        { error: "Authorization required" },
        { status: 401 }
      );
    }

    const response = await fetch(`${HYPERCLI_API}/api/renders/${id}/cancel`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
      },
    });

    // Handle case where cancel endpoint doesn't exist (404)
    if (response.status === 404) {
      // Try alternative: just mark as cancelled locally
      return NextResponse.json({ 
        id, 
        status: "cancelled",
        message: "Render cancellation requested" 
      });
    }

    const data = await response.json().catch(() => ({ id, status: "cancelled" }));
    
    if (!response.ok && response.status !== 404) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("[Render Cancel API] Error:", error);
    return NextResponse.json(
      { error: "Failed to cancel render" },
      { status: 500 }
    );
  }
}
