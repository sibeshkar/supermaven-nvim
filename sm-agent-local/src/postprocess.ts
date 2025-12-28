// Post-processing for LLM completion output

import type { ResponseItem } from "./types";

/**
 * Clean raw LLM output to extract just the completion code.
 * Removes markdown formatting, explanatory text, etc.
 */
export function cleanCompletion(raw: string): string {
  let result = raw;

  // Remove markdown code blocks (```language\n...\n```)
  const codeBlockMatch = result.match(/```[\w]*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    result = codeBlockMatch[1];
  }

  // Remove single backtick wrappers (`...`)
  if (result.startsWith("`") && result.endsWith("`") && !result.includes("\n")) {
    result = result.slice(1, -1);
  }

  // Remove common prefixes that LLMs add
  const prefixPatterns = [
    /^here'?s?\s+(the\s+)?(code|completion|answer)[:\s]*/i,
    /^the\s+(code|completion)\s+(is|would be)[:\s]*/i,
    /^i\s+would\s+(suggest|recommend|add)[:\s]*/i,
    /^you\s+(can|could|should)\s+(use|add|write)[:\s]*/i,
    /^completion[:\s]*/i,
  ];

  for (const pattern of prefixPatterns) {
    result = result.replace(pattern, "");
  }

  // Trim whitespace
  result = result.trim();

  return result;
}

/**
 * Remove overlap between completion and prefix ending.
 * Sometimes the LLM repeats part of the prefix.
 */
export function stripDuplicatePrefix(completion: string, prefix: string): string {
  if (!completion || !prefix) return completion;

  // Get the last line or last N characters of prefix
  const prefixEnd = prefix.slice(-100);

  // Find overlap at the start of completion
  for (let i = Math.min(prefixEnd.length, completion.length); i > 0; i--) {
    const prefixTail = prefixEnd.slice(-i);
    const completionHead = completion.slice(0, i);

    if (prefixTail === completionHead) {
      return completion.slice(i);
    }
  }

  return completion;
}

/**
 * Remove overlap between completion and suffix start.
 * Sometimes the LLM includes part of the suffix.
 */
export function stripDuplicateSuffix(completion: string, suffix: string): string {
  if (!completion || !suffix) return completion;

  // Get the first line or first N characters of suffix
  const suffixStart = suffix.slice(0, 100);

  // Find overlap at the end of completion
  for (let i = Math.min(suffixStart.length, completion.length); i > 0; i--) {
    const suffixHead = suffixStart.slice(0, i);
    const completionTail = completion.slice(-i);

    if (suffixHead === completionTail) {
      return completion.slice(0, -i);
    }
  }

  return completion;
}

/**
 * Full post-processing pipeline for LLM output.
 */
export function postprocessCompletion(
  raw: string,
  prefix: string,
  suffix: string
): string {
  let result = cleanCompletion(raw);
  result = stripDuplicatePrefix(result, prefix);
  result = stripDuplicateSuffix(result, suffix);
  return result;
}

/**
 * Build response items array from completion text.
 */
export function buildResponseItems(completion: string): ResponseItem[] {
  if (!completion) {
    return [{ kind: "end" }];
  }

  return [{ kind: "text", text: completion }, { kind: "end" }];
}

/**
 * Build a streaming response item (text only, no end marker).
 */
export function buildStreamingTextItem(text: string): ResponseItem {
  return { kind: "text", text };
}

/**
 * Build the end marker item.
 */
export function buildEndItem(): ResponseItem {
  return { kind: "end" };
}
