// OpenAI-compatible backend for LM Studio / OpenRouter

import type {
  CompletionContext,
  BackendConfig,
  CompletionBackend,
  ChatMessage,
} from "./types";
import { buildPrompt, detectFimFormat } from "./prompt";
import { postprocessCompletion } from "./postprocess";

/**
 * Create an OpenAI-compatible completion backend.
 */
export function createBackend(config: BackendConfig): CompletionBackend {
  return {
    complete: (context, signal) => complete(config, context, signal),
    streamComplete: (context, signal) => streamComplete(config, context, signal),
  };
}

/**
 * Non-streaming completion request.
 */
async function complete(
  config: BackendConfig,
  context: CompletionContext,
  signal?: AbortSignal
): Promise<string> {
  try {
    const promptData = buildPrompt(context, config.model);
    let raw: string;

    if (promptData.type === "fim") {
      raw = await completionRequest(config, promptData.prompt, signal);
    } else {
      raw = await chatCompletionRequest(config, promptData.messages, signal);
    }

    return postprocessCompletion(raw, context.prefix, context.suffix);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return "";
    }
    console.error("[sm-agent-local] Completion error:", error);
    return "";
  }
}

/**
 * Streaming completion generator.
 */
async function* streamComplete(
  config: BackendConfig,
  context: CompletionContext,
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  try {
    const promptData = buildPrompt(context, config.model);
    let stream: AsyncGenerator<string>;

    if (promptData.type === "fim") {
      stream = streamCompletionRequest(config, promptData.prompt, signal);
    } else {
      stream = streamChatCompletionRequest(config, promptData.messages, signal);
    }

    let accumulated = "";
    for await (const chunk of stream) {
      accumulated += chunk;
      yield chunk;
    }

    // Note: Post-processing happens on the accumulated result
    // For streaming, we yield raw chunks and let the consumer handle final cleanup
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return;
    }
    console.error("[sm-agent-local] Stream error:", error);
  }
}

/**
 * Make a /v1/completions request (for FIM models).
 */
async function completionRequest(
  config: BackendConfig,
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  // For OpenRouter, add required headers
  if (config.baseUrl.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = "https://github.com/supermaven-nvim";
    headers["X-Title"] = "sm-agent-local";
  }

  const body: Record<string, unknown> = {
    prompt,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    stream: false,
  };

  // Only include model if specified
  if (config.model) {
    body.model = config.model;
  }

  const response = await fetch(`${config.baseUrl}/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Completion request failed: ${response.status} ${text}`);
  }

  const data = await response.json() as {
    choices?: { text?: string }[];
  };

  return data.choices?.[0]?.text ?? "";
}

/**
 * Make a /v1/chat/completions request (for chat models).
 */
async function chatCompletionRequest(
  config: BackendConfig,
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  if (config.baseUrl.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = "https://github.com/supermaven-nvim";
    headers["X-Title"] = "sm-agent-local";
  }

  const body: Record<string, unknown> = {
    messages,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    stream: false,
  };

  if (config.model) {
    body.model = config.model;
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Chat completion request failed: ${response.status} ${text}`);
  }

  const data = await response.json() as {
    choices?: { message?: { content?: string } }[];
  };

  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Streaming /v1/completions request.
 */
async function* streamCompletionRequest(
  config: BackendConfig,
  prompt: string,
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  if (config.baseUrl.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = "https://github.com/supermaven-nvim";
    headers["X-Title"] = "sm-agent-local";
  }

  const body: Record<string, unknown> = {
    prompt,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    stream: true,
  };

  if (config.model) {
    body.model = config.model;
  }

  const response = await fetch(`${config.baseUrl}/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Streaming completion request failed: ${response.status} ${text}`);
  }

  yield* parseSSEStream(response.body!, "text");
}

/**
 * Streaming /v1/chat/completions request.
 */
async function* streamChatCompletionRequest(
  config: BackendConfig,
  messages: ChatMessage[],
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  if (config.baseUrl.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = "https://github.com/supermaven-nvim";
    headers["X-Title"] = "sm-agent-local";
  }

  const body: Record<string, unknown> = {
    messages,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    stream: true,
  };

  if (config.model) {
    body.model = config.model;
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Streaming chat request failed: ${response.status} ${text}`);
  }

  yield* parseSSEStream(response.body!, "chat");
}

/**
 * Parse Server-Sent Events stream and yield content chunks.
 */
async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
  type: "text" | "chat"
): AsyncGenerator<string, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith(":")) continue;

        // Parse data lines
        if (trimmed.startsWith("data: ")) {
          const data = trimmed.slice(6);

          // Skip [DONE] marker
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            let content: string | undefined;

            if (type === "chat") {
              content = parsed.choices?.[0]?.delta?.content;
            } else {
              content = parsed.choices?.[0]?.text;
            }

            if (content) {
              yield content;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
