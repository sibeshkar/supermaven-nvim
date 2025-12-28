import { describe, test, expect } from "bun:test";
import {
  cleanCompletion,
  stripDuplicatePrefix,
  stripDuplicateSuffix,
  postprocessCompletion,
  buildResponseItems,
  buildStreamingTextItem,
  buildEndItem,
} from "../../src/postprocess";

describe("Completion Post-processing", () => {
  describe("cleanCompletion", () => {
    test("removes markdown code blocks with language", () => {
      const raw = "```python\nreturn x + y\n```";
      expect(cleanCompletion(raw)).toBe("return x + y");
    });

    test("removes markdown code blocks without language", () => {
      const raw = "```\nreturn x + y\n```";
      expect(cleanCompletion(raw)).toBe("return x + y");
    });

    test("removes single backtick wrappers", () => {
      const raw = "`return x + y`";
      expect(cleanCompletion(raw)).toBe("return x + y");
    });

    test("does not remove backticks with newlines", () => {
      const raw = "`line1\nline2`";
      expect(cleanCompletion(raw)).toBe("`line1\nline2`");
    });

    test("strips leading/trailing whitespace", () => {
      const raw = "  \n  return x + y  \n  ";
      expect(cleanCompletion(raw)).toBe("return x + y");
    });

    test("removes 'Here's the completion:' prefix", () => {
      const raw = "Here's the completion:\nreturn x + y";
      expect(cleanCompletion(raw)).toBe("return x + y");
    });

    test("removes 'The code is:' prefix", () => {
      const raw = "The code is:\nreturn x + y";
      expect(cleanCompletion(raw)).toBe("return x + y");
    });

    test("removes 'I would suggest:' prefix", () => {
      const raw = "I would suggest:\nreturn x + y";
      expect(cleanCompletion(raw)).toBe("return x + y");
    });

    test("removes 'You can use:' prefix", () => {
      const raw = "You can use:\nreturn x + y";
      expect(cleanCompletion(raw)).toBe("return x + y");
    });

    test("preserves internal newlines", () => {
      const raw = "if x:\n    return 1\nelse:\n    return 0";
      expect(cleanCompletion(raw)).toBe("if x:\n    return 1\nelse:\n    return 0");
    });

    test("handles empty input", () => {
      expect(cleanCompletion("")).toBe("");
    });

    test("handles whitespace-only input", () => {
      expect(cleanCompletion("   \n\t  ")).toBe("");
    });

    test("handles code block with complex content", () => {
      const raw = '```typescript\nconst fn = (x: number) => {\n  return x * 2;\n};\n```';
      expect(cleanCompletion(raw)).toBe(
        "const fn = (x: number) => {\n  return x * 2;\n};"
      );
    });
  });

  describe("stripDuplicatePrefix", () => {
    test("removes completion that repeats the prefix ending", () => {
      const prefix = "def foo():\n    ";
      const completion = "    return 42";
      expect(stripDuplicatePrefix(completion, prefix)).toBe("return 42");
    });

    test("handles no overlap", () => {
      const prefix = "def foo():";
      const completion = "return 42";
      expect(stripDuplicatePrefix(completion, prefix)).toBe("return 42");
    });

    test("handles full prefix repeated", () => {
      const prefix = "const x = ";
      const completion = "const x = 5";
      expect(stripDuplicatePrefix(completion, prefix)).toBe("5");
    });

    test("handles empty completion", () => {
      expect(stripDuplicatePrefix("", "prefix")).toBe("");
    });

    test("handles empty prefix", () => {
      expect(stripDuplicatePrefix("completion", "")).toBe("completion");
    });

    test("handles partial overlap", () => {
      const prefix = "function test() {\n  return ";
      const completion = "return true;\n}";
      expect(stripDuplicatePrefix(completion, prefix)).toBe("true;\n}");
    });
  });

  describe("stripDuplicateSuffix", () => {
    test("removes completion that repeats the suffix start", () => {
      const suffix = "\n    return x";
      const completion = "y = 5\n    return x";
      expect(stripDuplicateSuffix(completion, suffix)).toBe("y = 5");
    });

    test("handles no overlap", () => {
      const suffix = "\nreturn x";
      const completion = "y = 5";
      expect(stripDuplicateSuffix(completion, suffix)).toBe("y = 5");
    });

    test("handles empty completion", () => {
      expect(stripDuplicateSuffix("", "suffix")).toBe("");
    });

    test("handles empty suffix", () => {
      expect(stripDuplicateSuffix("completion", "")).toBe("completion");
    });

    test("handles partial overlap", () => {
      const suffix = ")\n}";
      const completion = "x + y)\n}";
      expect(stripDuplicateSuffix(completion, suffix)).toBe("x + y");
    });
  });

  describe("postprocessCompletion", () => {
    test("applies full pipeline", () => {
      const raw = "```python\n    return x + y\n```";
      const prefix = "def add(x, y):\n    ";
      const suffix = "\n";
      const result = postprocessCompletion(raw, prefix, suffix);
      expect(result).toBe("return x + y");
    });

    test("handles clean input with no issues", () => {
      const result = postprocessCompletion("return 42", "def f(): ", "");
      expect(result).toBe("return 42");
    });

    test("handles input with prefix overlap", () => {
      const result = postprocessCompletion("    print('hello')", "def f():\n    ", "");
      expect(result).toBe("print('hello')");
    });
  });

  describe("buildResponseItems", () => {
    test("wraps completion text in response items", () => {
      const items = buildResponseItems("return 42");
      expect(items).toEqual([
        { kind: "text", text: "return 42" },
        { kind: "end" },
      ]);
    });

    test("returns just end for empty completion", () => {
      const items = buildResponseItems("");
      expect(items).toEqual([{ kind: "end" }]);
    });

    test("handles multiline completion", () => {
      const completion = "if x:\n    return 1\nelse:\n    return 0";
      const items = buildResponseItems(completion);
      expect(items).toEqual([
        { kind: "text", text: completion },
        { kind: "end" },
      ]);
    });
  });

  describe("buildStreamingTextItem", () => {
    test("creates text item", () => {
      const item = buildStreamingTextItem("chunk");
      expect(item).toEqual({ kind: "text", text: "chunk" });
    });

    test("handles empty text", () => {
      const item = buildStreamingTextItem("");
      expect(item).toEqual({ kind: "text", text: "" });
    });
  });

  describe("buildEndItem", () => {
    test("creates end item", () => {
      const item = buildEndItem();
      expect(item).toEqual({ kind: "end" });
    });
  });
});
