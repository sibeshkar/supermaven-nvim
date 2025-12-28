import { describe, test, expect } from "bun:test";
import { createBackend } from "../../src/backend";
import type { CompletionContext } from "../../src/types";

describe("LM Studio Live Tests", () => {
  async function isLMStudioRunning(): Promise<boolean> {
    try {
      const res = await fetch("http://localhost:1234/v1/models", {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  test("lists available models", async () => {
    if (!(await isLMStudioRunning())) {
      console.log("Skipping: LM Studio not running");
      return;
    }

    const res = await fetch("http://localhost:1234/v1/models");
    const data = (await res.json()) as { data: { id: string }[] };

    expect(data.data).toBeInstanceOf(Array);
    expect(data.data.length).toBeGreaterThan(0);

    console.log(
      "Available models:",
      data.data.map((m) => m.id)
    );
  });

  test("completes code with loaded model (chat)", async () => {
    if (!(await isLMStudioRunning())) {
      console.log("Skipping: LM Studio not running");
      return;
    }

    const backend = createBackend({
      baseUrl: "http://localhost:1234/v1",
      model: "", // Use whatever is loaded
      maxTokens: 64,
      temperature: 0.2,
    });

    const context: CompletionContext = {
      prefix: "# Python function to calculate sum of a list\ndef sum_list(numbers):\n    ",
      suffix: "",
      language: "python",
      filePath: "/sum.py",
    };

    const completion = await backend.complete(context);

    console.log("LM Studio completion:", completion);

    expect(completion).toBeTruthy();
    expect(completion.length).toBeGreaterThan(0);
  });

  test("streaming completion with loaded model", async () => {
    if (!(await isLMStudioRunning())) {
      console.log("Skipping: LM Studio not running");
      return;
    }

    const backend = createBackend({
      baseUrl: "http://localhost:1234/v1",
      model: "",
      maxTokens: 32,
      temperature: 0.2,
    });

    const context: CompletionContext = {
      prefix: "function multiply(a: number, b: number): number {\n    ",
      suffix: "\n}",
      language: "typescript",
      filePath: "/multiply.ts",
    };

    const chunks: string[] = [];
    for await (const chunk of backend.streamComplete(context)) {
      chunks.push(chunk);
    }

    const fullCompletion = chunks.join("");
    console.log("LM Studio streaming completion:", fullCompletion);

    expect(chunks.length).toBeGreaterThan(0);
    expect(fullCompletion).toBeTruthy();
  });

  test("FIM completion with qwen-coder model if available", async () => {
    if (!(await isLMStudioRunning())) {
      console.log("Skipping: LM Studio not running");
      return;
    }

    // Check if qwen-coder is available
    const models = (await fetch("http://localhost:1234/v1/models").then((r) =>
      r.json()
    )) as { data: { id: string }[] };

    const qwenModel = models.data.find(
      (m) => m.id.toLowerCase().includes("qwen") && m.id.toLowerCase().includes("coder")
    );

    if (!qwenModel) {
      console.log("Skipping FIM test: qwen-coder not available");
      return;
    }

    console.log("Testing FIM with model:", qwenModel.id);

    const backend = createBackend({
      baseUrl: "http://localhost:1234/v1",
      model: qwenModel.id,
      maxTokens: 64,
      temperature: 0.2,
    });

    const context: CompletionContext = {
      prefix: "def greet(name):\n    ",
      suffix: '\n    return message',
      language: "python",
      filePath: "/greet.py",
    };

    const completion = await backend.complete(context);

    console.log("FIM completion:", completion);

    expect(completion).toBeTruthy();
    // The completion should define 'message' since suffix uses it
    expect(
      completion.includes("message") ||
        completion.includes("=") ||
        completion.includes("f\"") ||
        completion.includes("f'")
    ).toBe(true);
  });
});
