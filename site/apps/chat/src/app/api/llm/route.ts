import { NextRequest, NextResponse } from "next/server";

const LLM_API_URL = "https://api.hypercli.com/v1";
// Use environment variable for API key - must be set in production
const C3_API_KEY = process.env.C3_API_KEY || "";

export async function POST(request: NextRequest) {
  if (!C3_API_KEY) {
    console.error("[LLM Proxy] C3_API_KEY environment variable not set");
    return NextResponse.json(
      { error: "LLM service not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    
    const response = await fetch(`${LLM_API_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${C3_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    // For non-streaming responses
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("[LLM Proxy] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
