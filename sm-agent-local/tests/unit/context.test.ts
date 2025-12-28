import { describe, test, expect } from "bun:test";
import { extractContext, detectLanguage } from "../../src/context";
import type { StateUpdateItem } from "../../src/types";

describe("Context Extraction", () => {
  describe("extractContext", () => {
    test("extracts prefix and suffix from cursor offset", () => {
      const updates: StateUpdateItem[] = [
        { kind: "file_update", path: "/test.py", content: "def foo():\n    pass" },
        { kind: "cursor_update", path: "/test.py", offset: 15 },
      ];
      const ctx = extractContext(updates);
      expect(ctx.prefix).toBe("def foo():\n    ");
      expect(ctx.suffix).toBe("pass");
      expect(ctx.filePath).toBe("/test.py");
    });

    test("handles cursor at start of file", () => {
      const updates: StateUpdateItem[] = [
        { kind: "file_update", path: "/test.py", content: "hello" },
        { kind: "cursor_update", path: "/test.py", offset: 0 },
      ];
      const ctx = extractContext(updates);
      expect(ctx.prefix).toBe("");
      expect(ctx.suffix).toBe("hello");
    });

    test("handles cursor at end of file", () => {
      const updates: StateUpdateItem[] = [
        { kind: "file_update", path: "/test.py", content: "hello" },
        { kind: "cursor_update", path: "/test.py", offset: 5 },
      ];
      const ctx = extractContext(updates);
      expect(ctx.prefix).toBe("hello");
      expect(ctx.suffix).toBe("");
    });

    test("handles cursor in middle of line", () => {
      const updates: StateUpdateItem[] = [
        { kind: "file_update", path: "/test.js", content: "const x = 123;" },
        { kind: "cursor_update", path: "/test.js", offset: 10 },
      ];
      const ctx = extractContext(updates);
      expect(ctx.prefix).toBe("const x = ");
      expect(ctx.suffix).toBe("123;");
    });

    test("handles empty file", () => {
      const updates: StateUpdateItem[] = [
        { kind: "file_update", path: "/test.py", content: "" },
        { kind: "cursor_update", path: "/test.py", offset: 0 },
      ];
      const ctx = extractContext(updates);
      expect(ctx.prefix).toBe("");
      expect(ctx.suffix).toBe("");
    });

    test("handles updates in reverse order (cursor before file)", () => {
      const updates: StateUpdateItem[] = [
        { kind: "cursor_update", path: "/test.py", offset: 5 },
        { kind: "file_update", path: "/test.py", content: "hello world" },
      ];
      const ctx = extractContext(updates);
      expect(ctx.prefix).toBe("hello");
      expect(ctx.suffix).toBe(" world");
    });

    test("clamps cursor offset to file bounds (negative)", () => {
      const updates: StateUpdateItem[] = [
        { kind: "file_update", path: "/test.py", content: "hello" },
        { kind: "cursor_update", path: "/test.py", offset: -5 },
      ];
      const ctx = extractContext(updates);
      expect(ctx.prefix).toBe("");
      expect(ctx.suffix).toBe("hello");
    });

    test("clamps cursor offset to file bounds (beyond end)", () => {
      const updates: StateUpdateItem[] = [
        { kind: "file_update", path: "/test.py", content: "hello" },
        { kind: "cursor_update", path: "/test.py", offset: 100 },
      ];
      const ctx = extractContext(updates);
      expect(ctx.prefix).toBe("hello");
      expect(ctx.suffix).toBe("");
    });

    test("truncates prefix to maxPrefixChars", () => {
      const longContent = "a".repeat(20000);
      const updates: StateUpdateItem[] = [
        { kind: "file_update", path: "/test.py", content: longContent },
        { kind: "cursor_update", path: "/test.py", offset: 15000 },
      ];
      const ctx = extractContext(updates, { maxPrefixChars: 8000 });
      expect(ctx.prefix.length).toBe(8000);
      // Should keep the END of the prefix (most relevant to cursor)
      expect(ctx.prefix).toBe("a".repeat(8000));
    });

    test("truncates suffix to maxSuffixChars", () => {
      const longContent = "a".repeat(20000);
      const updates: StateUpdateItem[] = [
        { kind: "file_update", path: "/test.py", content: longContent },
        { kind: "cursor_update", path: "/test.py", offset: 5000 },
      ];
      const ctx = extractContext(updates, { maxSuffixChars: 2000 });
      expect(ctx.suffix.length).toBe(2000);
      // Should keep the START of the suffix (most relevant to cursor)
      expect(ctx.suffix).toBe("a".repeat(2000));
    });

    test("handles multiline content correctly", () => {
      const content = "line1\nline2\nline3\nline4";
      const updates: StateUpdateItem[] = [
        { kind: "file_update", path: "/test.py", content },
        { kind: "cursor_update", path: "/test.py", offset: 12 }, // After "line2\n"
      ];
      const ctx = extractContext(updates);
      expect(ctx.prefix).toBe("line1\nline2\n");
      expect(ctx.suffix).toBe("line3\nline4");
    });
  });

  describe("detectLanguage", () => {
    const testCases: [string, string][] = [
      ["/test.py", "python"],
      ["/test.ts", "typescript"],
      ["/test.tsx", "typescript"],
      ["/test.js", "javascript"],
      ["/test.jsx", "javascript"],
      ["/test.lua", "lua"],
      ["/test.rs", "rust"],
      ["/test.go", "go"],
      ["/test.rb", "ruby"],
      ["/test.java", "java"],
      ["/test.c", "c"],
      ["/test.cpp", "cpp"],
      ["/test.h", "c"],
      ["/test.hpp", "cpp"],
      ["/test.swift", "swift"],
      ["/test.kt", "kotlin"],
      ["/test.scala", "scala"],
      ["/test.php", "php"],
      ["/test.html", "html"],
      ["/test.css", "css"],
      ["/test.json", "json"],
      ["/test.yaml", "yaml"],
      ["/test.yml", "yaml"],
      ["/test.md", "markdown"],
      ["/test.sh", "bash"],
      ["/test.sql", "sql"],
      ["/unknown.xyz", "text"],
      ["/noextension", "text"],
      ["/.hidden", "text"],
    ];

    for (const [path, expected] of testCases) {
      test(`detects ${expected} from ${path}`, () => {
        expect(detectLanguage(path)).toBe(expected);
      });
    }

    test("handles uppercase extensions", () => {
      expect(detectLanguage("/test.PY")).toBe("python");
      expect(detectLanguage("/test.JS")).toBe("javascript");
    });

    test("handles paths with multiple dots", () => {
      expect(detectLanguage("/some.test.spec.ts")).toBe("typescript");
      expect(detectLanguage("/file.min.js")).toBe("javascript");
    });
  });
});
