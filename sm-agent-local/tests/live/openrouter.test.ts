import { describe, test, expect, beforeAll } from "bun:test";
import { createBackend } from "../../src/backend";
import type { CompletionContext } from "../../src/types";

// Load env vars from ~/Sync/.env
import "../setup";

describe("OpenRouter Live Tests", () => {
  const apiKey = process.env.OPENROUTER_API_KEY;

  function skipIfNoKey(): boolean {
    if (!apiKey) {
      console.log("Skipping OpenRouter tests: OPENROUTER_API_KEY not set");
      return true;
    }
    return false;
  }

  test("completes Python function with devstral model", async () => {
    if (skipIfNoKey()) return;

    const backend = createBackend({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: apiKey!,
      model: "mistralai/devstral-2512:free",
      maxTokens: 64,
      temperature: 0.2,
    });

    const context: CompletionContext = {
      prefix: "def factorial(n):\n    if n <= 1:\n        return 1\n    ",
      suffix: "",
      language: "python",
      filePath: "/factorial.py",
    };

    const completion = await backend.complete(context);

    console.log("Devstral completion:", completion);

    expect(completion).toBeTruthy();
    expect(completion.length).toBeGreaterThan(0);
    // Should contain something related to factorial/recursion
    expect(
      completion.toLowerCase().includes("return") ||
        completion.toLowerCase().includes("factorial") ||
        completion.toLowerCase().includes("n")
    ).toBe(true);
  });

  test("completes TypeScript function with kat-coder model", async () => {
    if (skipIfNoKey()) return;

    const backend = createBackend({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: apiKey!,
      model: "kwaipilot/kat-coder-pro:free",
      maxTokens: 64,
      temperature: 0.2,
    });

    const context: CompletionContext = {
      prefix: "function greet(name: string): string {\n    ",
      suffix: "\n}",
      language: "typescript",
      filePath: "/greet.ts",
    };

    const completion = await backend.complete(context);

    console.log("Kat-Coder completion:", completion);

    expect(completion).toBeTruthy();
    expect(completion.length).toBeGreaterThan(0);
  });

  test("streaming completion works", async () => {
    if (skipIfNoKey()) return;

    const backend = createBackend({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: apiKey!,
      model: "mistralai/devstral-2512:free",
      maxTokens: 32,
      temperature: 0.2,
    });

    const context: CompletionContext = {
      prefix: "# Python function to add two numbers\ndef add(a, b):\n    ",
      suffix: "",
      language: "python",
      filePath: "/add.py",
    };

    const chunks: string[] = [];
    for await (const chunk of backend.streamComplete(context)) {
      chunks.push(chunk);
      console.log("Chunk:", JSON.stringify(chunk));
    }

    const fullCompletion = chunks.join("");
    console.log("Full streaming completion:", fullCompletion);

    expect(chunks.length).toBeGreaterThan(0);
    expect(fullCompletion).toBeTruthy();
  });

  test("handles API errors gracefully", async () => {
    // Use an invalid API key
    const backend = createBackend({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "invalid-api-key-12345",
      model: "mistralai/devstral-2512:free",
      maxTokens: 32,
      temperature: 0.2,
    });

    const context: CompletionContext = {
      prefix: "test",
      suffix: "",
      language: "text",
      filePath: "/test.txt",
    };

    // Should not throw, but return empty completion
    const completion = await backend.complete(context);
    expect(completion).toBe("");
  });
});
