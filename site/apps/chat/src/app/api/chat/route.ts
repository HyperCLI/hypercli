import { NextRequest, NextResponse } from "next/server";

// Use Gemini Flash for fast responses
// Free tier: 60 requests/minute, 1M tokens/day (with billing enabled)
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// Get API key from environment
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

// HyperCLI API for tool execution
const HYPERCLI_API = "https://api.hypercli.com";

// Tool definitions for Gemini format
const TOOLS = {
  functionDeclarations: [
    {
      name: "text_to_image",
      description: "Generate an image from a text prompt. Uses HiDream or Flux models. Costs ~$0.01-0.03 per image.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Detailed description of the image to generate",
          },
          width: {
            type: "number",
            description: "Image width (default: 1024)",
          },
          height: {
            type: "number",
            description: "Image height (default: 1024)",
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: "text_to_video",
      description: "Generate a video from a text prompt. Uses Wan 2.2 model. Costs ~$0.05-0.15 per video.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Detailed description of the video to generate",
          },
          width: {
            type: "number",
            description: "Video width (default: 640)",
          },
          height: {
            type: "number",
            description: "Video height (default: 640)",
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: "image_to_video",
      description: "Animate a static image into a video. Requires an image URL.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Description of the motion/animation to apply",
          },
          image_url: {
            type: "string",
            description: "URL of the image to animate",
          },
        },
        required: ["prompt", "image_url"],
      },
    },
    {
      name: "check_balance",
      description: "Check the user's HyperCLI account balance",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  ],
};

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

// System prompt for the assistant
const SYSTEM_PROMPT = `You are a helpful AI assistant for HyperCLI, a GPU cloud platform.
You can help users with:
- Generating images using AI (text_to_image tool)
- Generating videos using AI (text_to_video tool)
- Animating images into videos (image_to_video tool)
- Checking their account balance (check_balance tool)

When users ask to create images or videos, use the appropriate tool.
Be concise and helpful. Format responses nicely with markdown when appropriate.`;

// Execute a tool call against HyperCLI API
async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  authToken: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  console.log(`[Tools] Executing ${toolName} with args:`, args);

  try {
    switch (toolName) {
      case "text_to_image": {
        const response = await fetch(`${HYPERCLI_API}/api/flow/text-to-image`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            prompt: args.prompt,
            width: args.width || 1024,
            height: args.height || 1024,
          }),
        });
        const data = await response.json();
        console.log(`[Tools] text_to_image response:`, JSON.stringify(data));
        if (!response.ok) {
          return { success: false, error: data.detail || data.error || "Failed to create image" };
        }
        return { success: true, result: data };
      }

      case "text_to_video": {
        const response = await fetch(`${HYPERCLI_API}/api/flow/text-to-video`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            prompt: args.prompt,
            width: args.width || 640,
            height: args.height || 640,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          return { success: false, error: data.detail || data.error || "Failed to create video" };
        }
        return { success: true, result: data };
      }

      case "image_to_video": {
        const response = await fetch(`${HYPERCLI_API}/api/flow/image-to-video`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            prompt: args.prompt,
            image_url: args.image_url,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          return { success: false, error: data.detail || data.error || "Failed to animate image" };
        }
        return { success: true, result: data };
      }

      case "check_balance": {
        const response = await fetch(`${HYPERCLI_API}/api/balance`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });
        const data = await response.json();
        if (!response.ok) {
          return { success: false, error: data.detail || "Failed to check balance" };
        }
        return {
          success: true,
          result: {
            balance: data.balance,
            rewards_balance: data.rewards_balance,
            total_balance: data.total_balance,
            available_balance: data.available_balance,
          },
        };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    console.error(`[Tools] Error executing ${toolName}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Tool execution failed",
    };
  }
}

// Convert messages to Gemini format
function messagesToGeminiFormat(messages: Message[]) {
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

  // Filter out system messages and convert to Gemini format
  const chatMessages = messages.filter((m) => m.role !== "system");

  for (const msg of chatMessages) {
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    });
  }

  return contents;
}

export async function POST(request: NextRequest) {
  try {
    // Check for API key
    if (!GEMINI_API_KEY) {
      return NextResponse.json(
        {
          error: {
            message: "GEMINI_API_KEY not configured. Please add it to your .env.local file.",
            code: "missing_api_key",
          },
        },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { messages, execute_tools = true } = body as {
      messages: Message[];
      execute_tools?: boolean;
    };

    // Get user's auth token for tool execution
    const authHeader = request.headers.get("Authorization");
    const authToken = authHeader?.replace("Bearer ", "") || "";

    console.log("[Chat API] Received", messages.length, "messages");

    // Convert to Gemini format
    const contents = messagesToGeminiFormat(messages);

    // Call Gemini API
    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        tools: [TOOLS],
        generationConfig: {
          temperature: 0.7,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 1024,
        },
      }),
    });

    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.json().catch(() => ({}));
      console.error("[Chat API] Gemini error:", errorData);
      return NextResponse.json(
        {
          error: {
            message: errorData.error?.message || `Gemini API error: ${geminiResponse.status}`,
            code: "gemini_error",
          },
        },
        { status: geminiResponse.status }
      );
    }

    const geminiData = await geminiResponse.json();
    console.log("[Chat API] Gemini response:", JSON.stringify(geminiData).substring(0, 500));

    // Extract the response
    const candidate = geminiData.candidates?.[0];
    if (!candidate) {
      return NextResponse.json(
        { error: { message: "No response from Gemini", code: "no_response" } },
        { status: 500 }
      );
    }

    const parts = candidate.content?.parts || [];

    // Check for function calls
    const functionCalls = parts.filter((p: { functionCall?: unknown }) => p.functionCall);
    const textParts = parts.filter((p: { text?: string }) => p.text);

    // If there are function calls and execute_tools is true, execute them
    if (functionCalls.length > 0 && execute_tools && authToken) {
      const toolResults: Array<{
        tool: string;
        success: boolean;
        result?: unknown;
        error?: string;
      }> = [];

      for (const fc of functionCalls) {
        const { name, args } = fc.functionCall as { name: string; args: Record<string, unknown> };
        const result = await executeToolCall(name, args || {}, authToken);
        toolResults.push({ tool: name, ...result });
      }

      // Return OpenAI-compatible format with tool results
      return NextResponse.json({
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "gemini-2.0-flash",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: textParts.map((p: { text: string }) => p.text).join("\n") || null,
              tool_calls: functionCalls.map((fc: { functionCall: { name: string; args: Record<string, unknown> } }, i: number) => ({
                id: `call_${i}`,
                type: "function",
                function: {
                  name: fc.functionCall.name,
                  arguments: JSON.stringify(fc.functionCall.args),
                },
              })),
            },
            finish_reason: "tool_calls",
          },
        ],
        tool_results: toolResults,
      });
    }

    // Return regular text response in OpenAI-compatible format
    const content = textParts.map((p: { text: string }) => p.text).join("\n");

    return NextResponse.json({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "gemini-2.0-flash",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: content || "I apologize, but I couldn't generate a response. Please try again.",
          },
          finish_reason: "stop",
        },
      ],
    });
  } catch (error) {
    console.error("[Chat API] Error:", error);
    return NextResponse.json(
      {
        error: {
          message: error instanceof Error ? error.message : "Unknown error",
          code: "internal_error",
        },
      },
      { status: 500 }
    );
  }
}
