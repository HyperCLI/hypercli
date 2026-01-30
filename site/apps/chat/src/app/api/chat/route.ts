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
      description: "Check the user's HyperCLI account balance. Shows available credits.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "list_renders",
      description: "List the user's recent renders (images and videos). Shows status, type, and creation time.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of renders to show (default: 10, max: 50)",
          },
        },
      },
    },
    {
      name: "get_render_status",
      description: "Get the status of a specific render by its ID. Shows progress, result URL if complete, or error if failed.",
      parameters: {
        type: "object",
        properties: {
          render_id: {
            type: "string",
            description: "The unique ID of the render to check",
          },
        },
        required: ["render_id"],
      },
    },
    {
      name: "get_pricing",
      description: "Get pricing information for HyperCLI services including image generation, video generation, and GPU instances.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "list_templates",
      description: "List available ComfyUI templates for advanced image/video generation workflows.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "Filter by category: 'image', 'video', or 'all' (default: 'all')",
          },
        },
      },
    },
  ],
};

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

// System prompt for the assistant
const SYSTEM_PROMPT = `You are a helpful AI assistant for HyperCLI, a GPU cloud platform for AI image and video generation.

You can help users with:
- **Creating images** from text prompts (text_to_image) - Uses Flux/HiDream models
- **Creating videos** from text prompts (text_to_video) - Uses Wan 2.2 model  
- **Animating images** into videos (image_to_video) - Bring static images to life
- **Checking balance** (check_balance) - See available credits
- **Viewing render history** (list_renders) - See past creations and their status
- **Checking render status** (get_render_status) - Track a specific render's progress
- **Getting pricing info** (get_pricing) - See costs for different services
- **Browsing templates** (list_templates) - Discover advanced ComfyUI workflows

When users ask to create images or videos, use the appropriate tool and provide helpful context about the generation.
Be concise and friendly. Use markdown formatting for better readability.
When showing lists or pricing, use tables or bullet points.
If a render is in progress, let them know they can check back or ask for status updates.`;

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
            currency: "USD",
          },
        };
      }

      case "list_renders": {
        const limit = Math.min(Number(args.limit) || 10, 50);
        const response = await fetch(`${HYPERCLI_API}/api/renders?limit=${limit}`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });
        const data = await response.json();
        if (!response.ok) {
          return { success: false, error: data.detail || "Failed to fetch renders" };
        }
        // Format renders for display
        const renders = Array.isArray(data) ? data : data.renders || [];
        return {
          success: true,
          result: {
            count: renders.length,
            renders: renders.map((r: Record<string, unknown>) => ({
              id: r.id,
              type: r.type || r.render_type || "unknown",
              status: r.status || r.state || "unknown",
              prompt: r.prompt ? String(r.prompt).substring(0, 100) + (String(r.prompt).length > 100 ? "..." : "") : null,
              result_url: r.result_url || null,
              created_at: r.created_at,
              cost: r.cost || null,
            })),
          },
        };
      }

      case "get_render_status": {
        const renderId = args.render_id as string;
        if (!renderId) {
          return { success: false, error: "render_id is required" };
        }
        const response = await fetch(`${HYPERCLI_API}/api/renders/${renderId}/status`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });
        const data = await response.json();
        if (!response.ok) {
          return { success: false, error: data.detail || "Failed to get render status" };
        }
        return {
          success: true,
          result: {
            id: data.id || renderId,
            status: data.status || data.state,
            progress: data.progress || null,
            result_url: data.result_url || null,
            error: data.error || null,
            created_at: data.created_at,
            completed_at: data.completed_at || null,
          },
        };
      }

      case "get_pricing": {
        // Return static pricing info (could be fetched from API if available)
        return {
          success: true,
          result: {
            image_generation: {
              text_to_image: {
                model: "Flux / HiDream",
                cost_per_image: "$0.01 - $0.03",
                typical_time: "5-15 seconds",
                resolutions: ["512x512", "768x768", "1024x1024", "1024x1536"],
              },
            },
            video_generation: {
              text_to_video: {
                model: "Wan 2.2",
                cost_per_video: "$0.05 - $0.15",
                typical_time: "30-90 seconds",
                resolutions: ["480x480", "640x640", "720x720"],
              },
              image_to_video: {
                model: "Wan 2.2",
                cost_per_video: "$0.05 - $0.15",
                typical_time: "30-90 seconds",
                description: "Animate any static image",
              },
            },
            gpu_instances: {
              description: "Run your own ComfyUI workflows",
              pricing: "Pay per minute of GPU time",
              gpu_types: ["RTX 4090", "A100", "H100"],
            },
            note: "Prices may vary based on complexity and resolution. Check hypercli.com for current rates.",
          },
        };
      }

      case "list_templates": {
        const category = (args.category as string) || "all";
        // Return curated list of popular templates
        const templates = [
          { name: "flux-schnell", category: "image", description: "Fast image generation with Flux Schnell", cost: "~$0.01" },
          { name: "flux-dev", category: "image", description: "High quality image generation with Flux Dev", cost: "~$0.02" },
          { name: "hidream-full", category: "image", description: "HiDream full quality images", cost: "~$0.03" },
          { name: "wan-2.2-t2v", category: "video", description: "Text to video with Wan 2.2", cost: "~$0.10" },
          { name: "wan-2.2-i2v", category: "video", description: "Image to video animation", cost: "~$0.10" },
          { name: "sdxl-lightning", category: "image", description: "Ultra-fast SDXL generation", cost: "~$0.01" },
        ];
        
        const filtered = category === "all" 
          ? templates 
          : templates.filter(t => t.category === category);
        
        return {
          success: true,
          result: {
            category: category,
            count: filtered.length,
            templates: filtered,
            note: "Use text_to_image or text_to_video for quick generation, or visit hypercli.com/playground for advanced templates.",
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

      // Build function response parts for Gemini
      const functionResponseParts: Array<{ functionResponse: { name: string; response: { result: unknown } } }> = [];

      for (const fc of functionCalls) {
        const { name, args } = fc.functionCall as { name: string; args: Record<string, unknown> };
        const result = await executeToolCall(name, args || {}, authToken);
        toolResults.push({ tool: name, ...result });
        
        // Add to function responses for Gemini follow-up
        functionResponseParts.push({
          functionResponse: {
            name,
            response: { result: result.success ? result.result : { error: result.error } },
          },
        });
      }

      // Send tool results back to Gemini to get a human-readable response
      // This is the "multi-turn" function calling pattern
      const followUpContents = [
        ...contents,
        // The model's response with function calls
        { role: "model", parts: parts },
        // The function results
        { role: "user", parts: functionResponseParts },
      ];

      const followUpResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: followUpContents,
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

      let finalContent = "";
      if (followUpResponse.ok) {
        const followUpData = await followUpResponse.json();
        console.log("[Chat API] Gemini follow-up response:", JSON.stringify(followUpData).substring(0, 500));
        const followUpParts = followUpData.candidates?.[0]?.content?.parts || [];
        const followUpTextParts = followUpParts.filter((p: { text?: string }) => p.text);
        finalContent = followUpTextParts.map((p: { text: string }) => p.text).join("\n");
      } else {
        console.error("[Chat API] Gemini follow-up error:", await followUpResponse.text());
      }

      // Return OpenAI-compatible format with tool results and final response
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
              content: finalContent || textParts.map((p: { text: string }) => p.text).join("\n") || null,
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
