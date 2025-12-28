import { describe, test, expect } from "bun:test";
import { parseIncomingMessage, formatOutgoingMessage } from "../../src/protocol";

describe("Protocol Parser", () => {
  describe("parseIncomingMessage", () => {
    test("parses greeting message", () => {
      const input = '{"kind": "greeting", "allowGitignore": false}';
      const result = parseIncomingMessage(input);
      expect(result).toEqual({ kind: "greeting", allowGitignore: false });
    });

    test("parses greeting with allowGitignore true", () => {
      const input = '{"kind": "greeting", "allowGitignore": true}';
      const result = parseIncomingMessage(input);
      expect(result).toEqual({ kind: "greeting", allowGitignore: true });
    });

    test("parses state_update with file and cursor", () => {
      const input = JSON.stringify({
        kind: "state_update",
        newId: "42",
        updates: [
          { kind: "cursor_update", path: "/test.py", offset: 15 },
          { kind: "file_update", path: "/test.py", content: "def hello():\n    " },
        ],
      });
      const result = parseIncomingMessage(input);
      expect(result.kind).toBe("state_update");
      if (result.kind === "state_update") {
        expect(result.newId).toBe("42");
        expect(result.updates).toHaveLength(2);
        expect(result.updates[0]).toEqual({
          kind: "cursor_update",
          path: "/test.py",
          offset: 15,
        });
        expect(result.updates[1]).toEqual({
          kind: "file_update",
          path: "/test.py",
          content: "def hello():\n    ",
        });
      }
    });

    test("parses state_update with empty updates", () => {
      const input = JSON.stringify({
        kind: "state_update",
        newId: "1",
        updates: [],
      });
      const result = parseIncomingMessage(input);
      expect(result.kind).toBe("state_update");
      if (result.kind === "state_update") {
        expect(result.updates).toHaveLength(0);
      }
    });

    test("parses inform_file_changed", () => {
      const input = '{"kind": "inform_file_changed", "path": "/foo.js"}';
      const result = parseIncomingMessage(input);
      expect(result).toEqual({ kind: "inform_file_changed", path: "/foo.js" });
    });

    test("parses use_free_version", () => {
      const input = '{"kind": "use_free_version"}';
      const result = parseIncomingMessage(input);
      expect(result).toEqual({ kind: "use_free_version" });
    });

    test("parses logout", () => {
      const input = '{"kind": "logout"}';
      const result = parseIncomingMessage(input);
      expect(result).toEqual({ kind: "logout" });
    });

    test("throws on invalid JSON", () => {
      expect(() => parseIncomingMessage("not json")).toThrow("Invalid JSON");
    });

    test("throws on non-object", () => {
      expect(() => parseIncomingMessage('"string"')).toThrow("Expected object");
      expect(() => parseIncomingMessage("123")).toThrow("Expected object");
      expect(() => parseIncomingMessage("null")).toThrow("Expected object");
    });

    test("throws on missing kind", () => {
      expect(() => parseIncomingMessage('{"foo": "bar"}')).toThrow("kind");
    });

    test("throws on unknown message kind", () => {
      expect(() => parseIncomingMessage('{"kind": "unknown"}')).toThrow(
        "Unknown message kind"
      );
    });

    test("throws on state_update missing newId", () => {
      const input = JSON.stringify({
        kind: "state_update",
        updates: [],
      });
      expect(() => parseIncomingMessage(input)).toThrow("newId");
    });

    test("throws on state_update missing updates", () => {
      const input = JSON.stringify({
        kind: "state_update",
        newId: "1",
      });
      expect(() => parseIncomingMessage(input)).toThrow("updates");
    });

    test("throws on invalid update kind", () => {
      const input = JSON.stringify({
        kind: "state_update",
        newId: "1",
        updates: [{ kind: "invalid_update" }],
      });
      expect(() => parseIncomingMessage(input)).toThrow("Unknown update kind");
    });
  });

  describe("formatOutgoingMessage", () => {
    test("formats response with SM-MESSAGE prefix", () => {
      const msg = { kind: "response" as const, stateId: "1", items: [] };
      const result = formatOutgoingMessage(msg);
      expect(result).toBe('SM-MESSAGE {"kind":"response","stateId":"1","items":[]}\n');
    });

    test("formats response with text and end items", () => {
      const msg = {
        kind: "response" as const,
        stateId: "42",
        items: [
          { kind: "text" as const, text: "return x" },
          { kind: "end" as const },
        ],
      };
      const result = formatOutgoingMessage(msg);
      expect(result).toContain("SM-MESSAGE");
      expect(result).toContain('"stateId":"42"');
      expect(result).toContain('"kind":"text"');
      expect(result).toContain('"text":"return x"');
      expect(result).toContain('"kind":"end"');
      expect(result.endsWith("\n")).toBe(true);
    });

    test("formats service_tier message", () => {
      const msg = { kind: "service_tier" as const, display: "Local LLM" };
      const result = formatOutgoingMessage(msg);
      expect(result).toContain("SM-MESSAGE");
      expect(result).toContain('"kind":"service_tier"');
      expect(result).toContain('"display":"Local LLM"');
      expect(result.endsWith("\n")).toBe(true);
    });

    test("formats activation_success message", () => {
      const msg = { kind: "activation_success" as const };
      const result = formatOutgoingMessage(msg);
      expect(result).toBe('SM-MESSAGE {"kind":"activation_success"}\n');
    });

    test("formats metadata with dustStrings", () => {
      const msg = {
        kind: "metadata" as const,
        dustStrings: ["//", "#", "--"],
      };
      const result = formatOutgoingMessage(msg);
      expect(result).toContain("SM-MESSAGE");
      expect(result).toContain('"kind":"metadata"');
      expect(result).toContain('"dustStrings":["//","#","--"]');
      expect(result.endsWith("\n")).toBe(true);
    });
  });
});
