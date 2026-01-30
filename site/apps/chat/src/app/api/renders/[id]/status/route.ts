import { NextRequest, NextResponse } from "next/server";

const HYPERCLI_API = "https://api.hypercli.com";

export async function GET(
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

    const response = await fetch(`${HYPERCLI_API}/api/renders/${id}/status`, {
      headers: {
        Authorization: authHeader,
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("[Render Status API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch render status" },
      { status: 500 }
    );
  }
}
