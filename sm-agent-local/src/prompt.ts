// Prompt building for FIM and chat-based completions

import type { CompletionContext, ChatMessage, FimFormat } from "./types";

/**
 * FIM token formats for different model families.
 */
const FIM_TOKENS = {
  qwen: {
    prefix: "<fim_prefix>",
    suffix: "<fim_suffix>",
    middle: "<fim_middle>",
  },
  codellama: {
    prefix: "<PRE> ",
    suffix: " <SUF>",
    middle: " <MID>",
  },
} as const;

/**
 * Patterns to detect FIM-capable models.
 */
const FIM_PATTERNS: { format: FimFormat; pattern: RegExp }[] = [
  { format: "qwen", pattern: /qwen|deepseek|starcoder|devstral|kat-coder/i },
  { format: "codellama", pattern: /codellama/i },
];

/**
 * Detect the FIM format supported by a model based on its name.
 * Returns null if the model doesn't support FIM (use chat fallback).
 */
export function detectFimFormat(modelName: string): FimFormat {
  for (const { format, pattern } of FIM_PATTERNS) {
    if (pattern.test(modelName)) {
      return format;
    }
  }
  return null;
}

/**
 * Build a FIM prompt for models that support fill-in-the-middle.
 * Used with /v1/completions endpoint.
 */
export function buildFimPrompt(
  context: CompletionContext,
  format: "qwen" | "codellama"
): string {
  const tokens = FIM_TOKENS[format];
  return `${tokens.prefix}${context.prefix}${tokens.suffix}${context.suffix}${tokens.middle}`;
}

/**
 * Build chat messages for pseudo-FIM using chat completions.
 * Used with /v1/chat/completions endpoint for models without native FIM.
 */
export function buildChatPrompt(context: CompletionContext): ChatMessage[] {
  const systemPrompt = `You are a code completion assistant. Your task is to complete the code at the cursor position marked with <CURSOR>.

Rules:
- Output ONLY the code that should be inserted at the cursor position
- Do NOT include any explanations, comments about what you're doing, or markdown formatting
- Do NOT repeat code that already exists before or after the cursor
- Do NOT wrap your response in code blocks or backticks
- Match the existing code style, indentation, and conventions
- If you cannot provide a meaningful completion, output nothing`;

  const userPrompt = `Complete the following ${context.language} code at the <CURSOR> position:

${context.prefix}<CURSOR>${context.suffix}`;

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
}

/**
 * Build the appropriate prompt based on model capabilities.
 * Returns either a FIM string (for /v1/completions) or chat messages (for /v1/chat/completions).
 */
export function buildPrompt(
  context: CompletionContext,
  modelName: string
): { type: "fim"; prompt: string } | { type: "chat"; messages: ChatMessage[] } {
  const fimFormat = detectFimFormat(modelName);

  if (fimFormat) {
    return {
      type: "fim",
      prompt: buildFimPrompt(context, fimFormat),
    };
  }

  return {
    type: "chat",
    messages: buildChatPrompt(context),
  };
}
