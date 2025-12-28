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

// ============================================================================
// Streaming Postprocessor
// ============================================================================

// Opening fence pattern: ```lang\n or ```\n at the start (newline required)
const OPENING_FENCE_PATTERN = /^```\w*\n/;

// Closing fence pattern: ``` at the end (with optional newline before)
const CLOSING_FENCE_PATTERN = /\n?```\s*$/;

/**
 * Streaming postprocessor that handles:
 * 1. Markdown code fences that arrive in chunks during streaming
 * 2. Duplicate prefix stripping (when LLM echoes back part of the context)
 *
 * The challenge: When streaming, we might receive:
 *   chunk1: "\`\`\`py"
 *   chunk2: "thon\ndef"
 *   chunk3: " foo():\n"
 *   ...
 *   chunkN: "\n\`\`\`"
 *
 * And the LLM might echo back the prefix:
 *   prefix ends with: "def multiply(x, y):\n    "
 *   LLM returns: "def multiply(x, y):\n    return x * y"
 *   We want: "return x * y"
 *
 * This class buffers initial content to detect/strip opening fences
 * and duplicate prefixes, and watches for closing fences at the end.
 */
export class StreamingPostprocessor {
  private buffer: string = "";
  private openingStripped: boolean = false;
  private prefixStripped: boolean = false;
  private readonly maxBufferSize: number = 50;
  private readonly prefixEnd: string;
  private readonly maxPrefixCheckSize: number = 150;

  /**
   * Create a streaming postprocessor.
   * @param prefix - Optional prefix text (last ~100 chars before cursor).
   *                 If provided, will strip any overlap at the start of output.
   */
  constructor(prefix?: string) {
    // Keep the last 100 chars of prefix for overlap detection
    this.prefixEnd = prefix ? prefix.slice(-100) : "";
    // If no prefix, mark as already stripped
    this.prefixStripped = !this.prefixEnd;
  }

  /**
   * Process an incoming chunk and return the text to emit (if any).
   * May return empty string if buffering.
   */
  process(chunk: string): string {
    this.buffer += chunk;

    // If we haven't stripped the opening fence yet, check if we have enough
    if (!this.openingStripped) {
      // Look for opening fence pattern (requires newline to be complete)
      const match = this.buffer.match(OPENING_FENCE_PATTERN);
      if (match) {
        // Found complete opening fence, strip it
        this.buffer = this.buffer.slice(match[0].length);
        this.openingStripped = true;
      } else if (this.buffer.length >= this.maxBufferSize) {
        // Buffer full, no opening fence found - just pass through
        this.openingStripped = true;
      } else if (!this.buffer.startsWith("`")) {
        // Doesn't start with backtick, no fence coming
        this.openingStripped = true;
      } else if (this.buffer.includes("\n") && !this.buffer.match(/^```\w*\n/)) {
        // Has a newline but doesn't match fence pattern - not a fence
        this.openingStripped = true;
      } else {
        // Still buffering, waiting for newline to complete potential fence
        return "";
      }
    }

    // If we haven't stripped the duplicate prefix yet, check for overlap
    if (!this.prefixStripped) {
      // Buffer enough content to detect overlap (up to prefixEnd length + some margin)
      if (this.buffer.length < this.maxPrefixCheckSize && this.buffer.length < this.prefixEnd.length) {
        // Keep buffering to accumulate enough for overlap detection
        return "";
      }

      // Now check for overlap between prefixEnd and buffer start
      this.buffer = this.stripOverlap(this.buffer, this.prefixEnd);
      this.prefixStripped = true;
    }

    // Return buffered content, keeping potential closing fence chars
    // We keep the last few chars in case closing fence spans chunks
    const keepChars = 4; // Length of "\n```"
    if (this.buffer.length <= keepChars) {
      return "";
    }

    const toEmit = this.buffer.slice(0, -keepChars);
    this.buffer = this.buffer.slice(-keepChars);
    return toEmit;
  }

  /**
   * Flush remaining buffer, stripping any closing fence.
   * Call this when the stream ends.
   */
  flush(): string {
    // If we never got enough content to check prefix, do it now
    if (!this.prefixStripped && this.prefixEnd) {
      this.buffer = this.stripOverlap(this.buffer, this.prefixEnd);
      this.prefixStripped = true;
    }

    let result = this.buffer;
    this.buffer = "";

    // Strip closing fence if present
    result = result.replace(CLOSING_FENCE_PATTERN, "");

    return result;
  }

  /**
   * Reset the processor state.
   */
  reset(): void {
    this.buffer = "";
    this.openingStripped = false;
    this.prefixStripped = !this.prefixEnd;
  }

  /**
   * Strip overlap between completion start and prefix end.
   * If the completion starts with text that matches the end of the prefix,
   * remove that overlapping portion.
   *
   * Example:
   *   prefixEnd: "def multiply(x, y):\n    "
   *   completion: "def multiply(x, y):\n    return x * y"
   *   result: "return x * y"
   */
  private stripOverlap(completion: string, prefixEnd: string): string {
    if (!completion || !prefixEnd) return completion;

    // Find overlap: check if prefixEnd's tail matches completion's head
    // We try from longest possible overlap down to 1 char
    const maxOverlap = Math.min(prefixEnd.length, completion.length);

    for (let i = maxOverlap; i > 0; i--) {
      const prefixTail = prefixEnd.slice(-i);
      const completionHead = completion.slice(0, i);

      if (prefixTail === completionHead) {
        return completion.slice(i);
      }
    }

    return completion;
  }
}
