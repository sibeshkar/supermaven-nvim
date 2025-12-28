#!/usr/bin/env bun
// sm-agent-local - Drop-in replacement for sm-agent using local LLMs
//
// This binary speaks the same stdio protocol as sm-agent but uses
// LM Studio or OpenRouter for completions instead of Supermaven's cloud.

import { parseIncomingMessage, formatOutgoingMessage } from "./protocol";
import { extractContext } from "./context";
import { createBackend } from "./backend";
import { buildStreamingTextItem, buildEndItem, StreamingPostprocessor } from "./postprocess";
import { CONFIG, getBackendConfig } from "./config";
import type {
  IncomingMessage,
  StateUpdateMessage,
  OutgoingMessage,
} from "./types";

// Track pending requests for cancellation
const pendingRequests = new Map<string, AbortController>();

// Create the backend
const backend = createBackend(getBackendConfig());

/**
 * Send a message to the plugin via stdout.
 */
function send(msg: OutgoingMessage): void {
  process.stdout.write(formatOutgoingMessage(msg));
}

/**
 * Send initial messages on greeting.
 */
function handleGreeting(): void {
  // Tell the plugin we're running
  send({
    kind: "service_tier",
    display: `Local (${CONFIG.backend})`,
  });

  // Send activation success to dismiss any popups
  send({ kind: "activation_success" });

  // Send metadata with dust strings
  send({
    kind: "metadata",
    dustStrings: CONFIG.dustStrings,
  });
}

/**
 * Handle a state update (completion request).
 */
async function handleStateUpdate(msg: StateUpdateMessage): Promise<void> {
  const stateId = msg.newId;

  // Cancel any older pending requests
  for (const [id, controller] of pendingRequests) {
    if (parseInt(id) < parseInt(stateId)) {
      controller.abort();
      pendingRequests.delete(id);
    }
  }

  // Create abort controller for this request
  const controller = new AbortController();
  pendingRequests.set(stateId, controller);

  try {
    // Extract context from updates
    const context = extractContext(msg.updates);

    // Skip if no meaningful content
    if (!context.prefix && !context.suffix) {
      send({
        kind: "response",
        stateId,
        items: [{ kind: "end" }],
      });
      return;
    }

    // Stream completion with postprocessing to strip markdown fences
    const postprocessor = new StreamingPostprocessor();

    for await (const chunk of backend.streamComplete(context, controller.signal)) {
      if (controller.signal.aborted) {
        break;
      }

      // Process chunk through postprocessor (strips markdown fences)
      const processed = postprocessor.process(chunk);
      if (processed) {
        send({
          kind: "response",
          stateId,
          items: [buildStreamingTextItem(processed)],
        });
      }
    }

    // Flush any remaining buffered content
    if (!controller.signal.aborted) {
      const remaining = postprocessor.flush();
      if (remaining) {
        send({
          kind: "response",
          stateId,
          items: [buildStreamingTextItem(remaining)],
        });
      }

      // Send end marker
      send({
        kind: "response",
        stateId,
        items: [buildEndItem()],
      });
    }
  } catch (error) {
    if (error instanceof Error && error.name !== "AbortError") {
      console.error(`[sm-agent-local] Error handling state ${stateId}:`, error);
    }

    // Send empty response on error
    send({
      kind: "response",
      stateId,
      items: [{ kind: "end" }],
    });
  } finally {
    pendingRequests.delete(stateId);
  }
}

/**
 * Handle an incoming message.
 */
async function handleMessage(msg: IncomingMessage): Promise<void> {
  switch (msg.kind) {
    case "greeting":
      handleGreeting();
      break;

    case "state_update":
      // Don't await - handle asynchronously so we can process new messages
      handleStateUpdate(msg).catch((err) => {
        console.error("[sm-agent-local] Unhandled error:", err);
      });
      break;

    case "inform_file_changed":
      // Could be used for multi-file context in the future
      break;

    case "use_free_version":
    case "logout":
      // No-op for local backend
      break;
  }
}

/**
 * Main entry point - read from stdin and process messages.
 */
async function main(): Promise<void> {
  console.error(`[sm-agent-local] Starting with backend: ${CONFIG.backend}`);

  const decoder = new TextDecoder();
  let buffer = "";

  // Read from stdin
  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk);

    // Process complete lines
    while (buffer.includes("\n")) {
      const newlineIndex = buffer.indexOf("\n");
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      if (line.trim()) {
        try {
          const msg = parseIncomingMessage(line);
          await handleMessage(msg);
        } catch (error) {
          console.error("[sm-agent-local] Parse error:", error);
        }
      }
    }
  }
}

// Run
main().catch((error) => {
  console.error("[sm-agent-local] Fatal error:", error);
  process.exit(1);
});
