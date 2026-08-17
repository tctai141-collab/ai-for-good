import Anthropic from "@anthropic-ai/sdk";

/**
 * Advisor model backend.
 *
 * Replaces the original self-hosted OpenClaw gateway, which was a VM that no
 * longer exists. The browser app and `/api/founder-os/chat` still speak the
 * OpenAI-style `choices[].delta.content` SSE shape, so this module translates
 * between that wire format and the Anthropic Messages API.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

/**
 * Sprint Buddy replies are short coaching turns, so we run without thinking at
 * low effort: lower latency and cost, and `max_tokens` then bounds the visible
 * reply rather than reply-plus-reasoning. Raise ANTHROPIC_EFFORT if advice
 * quality matters more than turnaround.
 */
const EFFORT = (process.env.ANTHROPIC_EFFORT || "low") as "low" | "medium" | "high";

/**
 * Guards against the model emitting internal XML in visible output, a known
 * behaviour when thinking is disabled. Deliberately generic — naming thinking
 * tags explicitly is measurably less effective.
 */
const OUTPUT_GUARDRAIL = "Do not include internal or system XML tags in your response.";

export type ChatMessage = { role: string; content: string };

export class AdvisorNotConfiguredError extends Error {
  constructor() {
    super(
      "ANTHROPIC_API_KEY is not set. The advisor cannot answer without it. " +
        "Add it to .env (local) or the service environment (deployed).",
    );
    this.name = "AdvisorNotConfiguredError";
  }
}

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AdvisorNotConfiguredError();
  if (!cachedClient) {
    cachedClient = new Anthropic({
      apiKey,
      // Overridable so the integration tests can point at a local stand-in and
      // exercise this path without reaching the real API. Unset in production.
      ...(process.env.ANTHROPIC_BASE_URL?.trim()
        ? { baseURL: process.env.ANTHROPIC_BASE_URL.trim() }
        : {}),
      // A founder is waiting on this in a chat window. Failing in a few
      // seconds beats the SDK's default retry ladder holding the request open.
      maxRetries: 1,
      timeout: 30_000,
    });
  }
  return cachedClient;
}

/**
 * The Messages API only accepts user/assistant turns, requires the first turn
 * to be `user`, and rejects empty content. Any system-role turns the caller
 * passed inline are folded into the system prompt instead of dropped.
 */
function normalize(messages: ChatMessage[]): {
  turns: Anthropic.MessageParam[];
  inlineSystem: string[];
} {
  const inlineSystem: string[] = [];
  const turns: Anthropic.MessageParam[] = [];

  for (const message of messages) {
    const content = (message.content || "").trim();
    if (!content) continue;
    if (message.role === "system") {
      inlineSystem.push(content);
      continue;
    }
    if (message.role !== "user" && message.role !== "assistant") continue;
    // Anthropic rejects a conversation that opens on an assistant turn.
    if (turns.length === 0 && message.role === "assistant") continue;
    turns.push({ role: message.role, content });
  }

  return { turns, inlineSystem };
}

type AdvisorRequest = {
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
};

function buildParams(request: AdvisorRequest): Anthropic.MessageCreateParamsNonStreaming {
  const { turns, inlineSystem } = normalize(request.messages);
  if (turns.length === 0) throw new Error("No user message to respond to.");

  const system = [request.system, ...inlineSystem, OUTPUT_GUARDRAIL]
    .filter(Boolean)
    .join("\n\n");

  return {
    model: MODEL,
    max_tokens: request.maxTokens,
    system,
    messages: turns,
    thinking: { type: "disabled" },
    output_config: { effort: EFFORT },
  };
}

/** Single-shot reply. Returns the assistant's text. */
export async function advisorReply(request: AdvisorRequest): Promise<string> {
  const response = await getClient().messages.create(buildParams(request));

  if (response.stop_reason === "refusal") {
    throw new Error("The advisor declined to answer this request.");
  }

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function sseChunk(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

/**
 * Streaming reply, re-encoded as OpenAI-style SSE so existing browser and
 * server-side consumers keep working unchanged.
 *
 * `onText` receives every token as it is emitted, which the check-in flow uses
 * to accumulate the full reply for persistence without re-reading the stream.
 */
export function advisorReplyStream(
  request: AdvisorRequest,
  onText?: (text: string) => void,
): ReadableStream<Uint8Array> {
  const params = buildParams(request);
  const client = getClient();
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = client.messages.stream(params);
        for await (const event of stream) {
          if (event.type !== "content_block_delta") continue;
          if (event.delta.type !== "text_delta") continue;
          const text = event.delta.text;
          if (!text) continue;
          onText?.(text);
          controller.enqueue(encoder.encode(sseChunk(text)));
        }

        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          controller.enqueue(
            encoder.encode(sseChunk("\n\n[The advisor declined to answer this request.]")),
          );
        }
      } catch (err) {
        console.error("Advisor stream failed:", err);
        const message =
          err instanceof AdvisorNotConfiguredError
            ? err.message
            : "The advisor is unavailable right now. Please try again.";
        controller.enqueue(encoder.encode(sseChunk(`\n\n[${message}]`)));
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });
}
