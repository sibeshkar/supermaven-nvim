// Protocol parsing and formatting for sm-agent messages

import type { IncomingMessage, OutgoingMessage, StateUpdateItem } from "./types";

const VALID_INCOMING_KINDS = [
  "greeting",
  "state_update",
  "inform_file_changed",
  "use_free_version",
  "logout",
] as const;

function validateUpdate(update: unknown): StateUpdateItem {
  if (typeof update !== "object" || update === null) {
    throw new Error("Invalid update item");
  }

  const obj = update as Record<string, unknown>;

  if (obj.kind === "file_update") {
    if (typeof obj.path !== "string" || typeof obj.content !== "string") {
      throw new Error("file_update missing 'path' or 'content'");
    }
    return { kind: "file_update", path: obj.path, content: obj.content };
  }

  if (obj.kind === "cursor_update") {
    if (typeof obj.path !== "string" || typeof obj.offset !== "number") {
      throw new Error("cursor_update missing 'path' or 'offset'");
    }
    return { kind: "cursor_update", path: obj.path, offset: obj.offset };
  }

  throw new Error(`Unknown update kind: ${obj.kind}`);
}

/**
 * Parse a JSON string into an IncomingMessage.
 * Throws if the JSON is invalid or the message kind is unknown.
 */
export function parseIncomingMessage(input: string): IncomingMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error(`Invalid JSON: ${input}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Expected object, got: ${typeof parsed}`);
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.kind !== "string") {
    throw new Error(`Missing or invalid 'kind' field`);
  }

  if (!VALID_INCOMING_KINDS.includes(obj.kind as (typeof VALID_INCOMING_KINDS)[number])) {
    throw new Error(`Unknown message kind: ${obj.kind}`);
  }

  // Type-specific validation
  switch (obj.kind) {
    case "greeting":
      return {
        kind: "greeting",
        allowGitignore: Boolean(obj.allowGitignore),
      };

    case "state_update":
      if (typeof obj.newId !== "string") {
        throw new Error("state_update missing 'newId'");
      }
      if (!Array.isArray(obj.updates)) {
        throw new Error("state_update missing 'updates' array");
      }
      return {
        kind: "state_update",
        newId: obj.newId,
        updates: obj.updates.map(validateUpdate),
      };

    case "inform_file_changed":
      if (typeof obj.path !== "string") {
        throw new Error("inform_file_changed missing 'path'");
      }
      return {
        kind: "inform_file_changed",
        path: obj.path,
      };

    case "use_free_version":
      return { kind: "use_free_version" };

    case "logout":
      return { kind: "logout" };

    default:
      throw new Error(`Unknown message kind: ${obj.kind}`);
  }
}

/**
 * Format an OutgoingMessage as a string with the SM-MESSAGE prefix.
 * Includes trailing newline.
 */
export function formatOutgoingMessage(msg: OutgoingMessage): string {
  return `SM-MESSAGE ${JSON.stringify(msg)}\n`;
}
