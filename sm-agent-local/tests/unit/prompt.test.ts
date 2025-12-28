import { describe, test, expect } from "bun:test";
import {
  detectFimFormat,
  buildFimPrompt,
  buildChatPrompt,
  buildPrompt,
} from "../../src/prompt";
import type { CompletionContext } from "../../src/types";

describe("Prompt Building", () => {
  const sampleContext: CompletionContext = {
    prefix: "def fibonacci(n):\n    if n <= 1:\n        return n\n    ",
    suffix: "\n    return fibonacci(n-1) + fibonacci(n-2)",
    language: "python",
    filePath: "/fib.py",
  };

  describe("detectFimFormat", () => {
    test("detects qwen format for Qwen models", () => {
      expect(detectFimFormat("qwen/qwen3-coder-30b")).toBe("qwen");
      expect(detectFimFormat("Qwen2.5-Coder-7B")).toBe("qwen");
      expect(detectFimFormat("qwen-coder")).toBe("qwen");
    });

    test("detects qwen format for DeepSeek models", () => {
      expect(detectFimFormat("deepseek/deepseek-coder")).toBe("qwen");
      expect(detectFimFormat("deepseek-coder-6.7b")).toBe("qwen");
      expect(detectFimFormat("DeepSeek-V2")).toBe("qwen");
    });

    test("detects qwen format for StarCoder models", () => {
      expect(detectFimFormat("starcoder2-15b")).toBe("qwen");
      expect(detectFimFormat("bigcode/starcoder")).toBe("qwen");
    });

    test("detects qwen format for Devstral", () => {
      expect(detectFimFormat("mistralai/devstral-2512:free")).toBe("qwen");
    });

    test("detects qwen format for Kat-Coder", () => {
      expect(detectFimFormat("kwaipilot/kat-coder-pro:free")).toBe("qwen");
    });

    test("detects codellama format for CodeLlama models", () => {
      expect(detectFimFormat("codellama-13b")).toBe("codellama");
      expect(detectFimFormat("CodeLlama-34b-Instruct")).toBe("codellama");
      expect(detectFimFormat("meta/codellama-70b")).toBe("codellama");
    });

    test("returns null for non-FIM models", () => {
      expect(detectFimFormat("gpt-4")).toBe(null);
      expect(detectFimFormat("gpt-3.5-turbo")).toBe(null);
      expect(detectFimFormat("claude-3-opus")).toBe(null);
      expect(detectFimFormat("llama-2-70b")).toBe(null);
      expect(detectFimFormat("mistral-7b")).toBe(null);
    });

    test("returns null for empty model name", () => {
      expect(detectFimFormat("")).toBe(null);
    });
  });

  describe("buildFimPrompt", () => {
    test("builds Qwen/DeepSeek/StarCoder FIM format", () => {
      const prompt = buildFimPrompt(sampleContext, "qwen");
      expect(prompt).toBe(
        "<fim_prefix>def fibonacci(n):\n    if n <= 1:\n        return n\n    " +
          "<fim_suffix>\n    return fibonacci(n-1) + fibonacci(n-2)<fim_middle>"
      );
    });

    test("builds CodeLlama FIM format", () => {
      const prompt = buildFimPrompt(sampleContext, "codellama");
      expect(prompt).toContain("<PRE> ");
      expect(prompt).toContain(" <SUF>");
      expect(prompt).toContain(" <MID>");
      expect(prompt).toBe(
        "<PRE> def fibonacci(n):\n    if n <= 1:\n        return n\n    " +
          " <SUF>\n    return fibonacci(n-1) + fibonacci(n-2) <MID>"
      );
    });

    test("handles empty prefix", () => {
      const ctx: CompletionContext = {
        prefix: "",
        suffix: "hello world",
        language: "text",
        filePath: "/test.txt",
      };
      const prompt = buildFimPrompt(ctx, "qwen");
      expect(prompt).toBe("<fim_prefix><fim_suffix>hello world<fim_middle>");
    });

    test("handles empty suffix", () => {
      const ctx: CompletionContext = {
        prefix: "hello world",
        suffix: "",
        language: "text",
        filePath: "/test.txt",
      };
      const prompt = buildFimPrompt(ctx, "qwen");
      expect(prompt).toBe("<fim_prefix>hello world<fim_suffix><fim_middle>");
    });

    test("handles empty prefix and suffix", () => {
      const ctx: CompletionContext = {
        prefix: "",
        suffix: "",
        language: "text",
        filePath: "/test.txt",
      };
      const prompt = buildFimPrompt(ctx, "qwen");
      expect(prompt).toBe("<fim_prefix><fim_suffix><fim_middle>");
    });
  });

  describe("buildChatPrompt", () => {
    test("returns two messages (system and user)", () => {
      const messages = buildChatPrompt(sampleContext);
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("system");
      expect(messages[1].role).toBe("user");
    });

    test("system prompt instructs code-only output", () => {
      const messages = buildChatPrompt(sampleContext);
      const systemContent = messages[0].content.toLowerCase();
      expect(systemContent).toContain("only");
      expect(systemContent).toContain("code");
      expect(systemContent).toContain("cursor");
    });

    test("system prompt warns against explanations", () => {
      const messages = buildChatPrompt(sampleContext);
      const systemContent = messages[0].content.toLowerCase();
      expect(systemContent).toContain("not");
      expect(
        systemContent.includes("explanation") || systemContent.includes("comment")
      ).toBe(true);
    });

    test("user prompt contains CURSOR marker", () => {
      const messages = buildChatPrompt(sampleContext);
      expect(messages[1].content).toContain("<CURSOR>");
    });

    test("user prompt includes prefix and suffix", () => {
      const messages = buildChatPrompt(sampleContext);
      expect(messages[1].content).toContain(sampleContext.prefix);
      expect(messages[1].content).toContain(sampleContext.suffix);
    });

    test("user prompt includes language", () => {
      const messages = buildChatPrompt(sampleContext);
      expect(messages[1].content).toContain("python");
    });

    test("handles different languages", () => {
      const tsContext: CompletionContext = {
        prefix: "function greet(",
        suffix: ")",
        language: "typescript",
        filePath: "/greet.ts",
      };
      const messages = buildChatPrompt(tsContext);
      expect(messages[1].content).toContain("typescript");
    });
  });

  describe("buildPrompt", () => {
    test("returns FIM prompt for FIM-capable models", () => {
      const result = buildPrompt(sampleContext, "qwen/qwen3-coder-30b");
      expect(result.type).toBe("fim");
      if (result.type === "fim") {
        expect(result.prompt).toContain("<fim_prefix>");
        expect(result.prompt).toContain("<fim_suffix>");
        expect(result.prompt).toContain("<fim_middle>");
      }
    });

    test("returns chat prompt for non-FIM models", () => {
      const result = buildPrompt(sampleContext, "gpt-4");
      expect(result.type).toBe("chat");
      if (result.type === "chat") {
        expect(result.messages).toHaveLength(2);
        expect(result.messages[0].role).toBe("system");
      }
    });

    test("returns chat prompt for empty model name", () => {
      const result = buildPrompt(sampleContext, "");
      expect(result.type).toBe("chat");
    });

    test("uses codellama format for CodeLlama models", () => {
      const result = buildPrompt(sampleContext, "codellama-13b");
      expect(result.type).toBe("fim");
      if (result.type === "fim") {
        expect(result.prompt).toContain("<PRE>");
        expect(result.prompt).toContain("<SUF>");
        expect(result.prompt).toContain("<MID>");
      }
    });
  });
});
