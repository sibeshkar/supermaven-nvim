import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { spawn, type Subprocess } from "bun";

describe("Protocol Integration", () => {
  let mockServer: ReturnType<typeof Bun.serve>;
  let proc: Subprocess<"pipe", "pipe", "pipe"> | null = null;
  const MOCK_PORT = 19876;

  beforeAll(async () => {
    // Create a mock LLM server that returns predictable completions
    mockServer = Bun.serve({
      port: MOCK_PORT,
      fetch: async (req) => {
        const url = new URL(req.url);
        const body = await req.json();

        // Chat completions endpoint
        if (url.pathname === "/v1/chat/completions") {
          if (body.stream) {
            // Streaming response
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
              async start(controller) {
                const chunks = ["return ", "42"];
                for (const chunk of chunks) {
                  const data = JSON.stringify({
                    choices: [{ delta: { content: chunk } }],
                  });
                  controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                  await new Promise((r) => setTimeout(r, 10));
                }
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
              },
            });
            return new Response(stream, {
              headers: { "Content-Type": "text/event-stream" },
            });
          } else {
            // Non-streaming response
            return Response.json({
              choices: [{ message: { content: "return 42" } }],
            });
          }
        }

        // Completions endpoint (FIM)
        if (url.pathname === "/v1/completions") {
          if (body.stream) {
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
              async start(controller) {
                const chunks = ["return ", "n * ", "factorial(n-1)"];
                for (const chunk of chunks) {
                  const data = JSON.stringify({
                    choices: [{ text: chunk }],
                  });
                  controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                  await new Promise((r) => setTimeout(r, 10));
                }
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
              },
            });
            return new Response(stream, {
              headers: { "Content-Type": "text/event-stream" },
            });
          } else {
            return Response.json({
              choices: [{ text: "return n * factorial(n-1)" }],
            });
          }
        }

        return new Response("Not found", { status: 404 });
      },
    });
  });

  afterAll(() => {
    mockServer?.stop();
  });

  afterEach(() => {
    if (proc) {
      proc.kill();
      proc = null;
    }
  });

  async function startAgent(): Promise<Subprocess<"pipe", "pipe", "pipe">> {
    proc = spawn({
      cmd: ["bun", "run", "src/index.ts"],
      cwd: import.meta.dir.replace("/tests/integration", ""),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        // Override config to use mock server
        SM_AGENT_TEST_URL: `http://localhost:${MOCK_PORT}/v1`,
      },
    });
    return proc;
  }

  function sendMessage(
    proc: Subprocess<"pipe", "pipe", "pipe">,
    msg: object
  ): void {
    // In Bun, stdin for subprocess is a FileSink, use write directly
    proc.stdin.write(JSON.stringify(msg) + "\n");
    proc.stdin.flush();
  }

  async function readMessages(
    proc: Subprocess<"pipe", "pipe", "pipe">,
    timeout = 2000
  ): Promise<object[]> {
    const messages: object[] = [];
    const decoder = new TextDecoder();
    let buffer = "";

    const startTime = Date.now();

    // Read available data with timeout
    while (Date.now() - startTime < timeout) {
      // Use ReadableStream interface
      const reader = proc.stdout.getReader();
      
      try {
        const readPromise = reader.read();
        const timeoutPromise = new Promise<{done: true, value: undefined}>((resolve) => 
          setTimeout(() => resolve({done: true, value: undefined}), 100)
        );
        
        const { done, value } = await Promise.race([readPromise, timeoutPromise]);
        
        if (done || !value) {
          reader.releaseLock();
          await new Promise(r => setTimeout(r, 50));
          continue;
        }

        buffer += decoder.decode(value, { stream: true });
        reader.releaseLock();

        while (buffer.includes("\n")) {
          const newlineIndex = buffer.indexOf("\n");
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.startsWith("SM-MESSAGE ")) {
            try {
              messages.push(JSON.parse(line.slice(11)));
            } catch {
              // Skip malformed messages
            }
          }
        }
        
        // If we got some messages, we can return early
        if (messages.length > 0) {
          await new Promise(r => setTimeout(r, 200)); // Wait a bit for more
        }
      } catch {
        reader.releaseLock();
        break;
      }
    }

    return messages;
  }

  test("responds to greeting with service_tier, activation_success, and metadata", async () => {
    const agent = await startAgent();

    sendMessage(agent, { kind: "greeting", allowGitignore: false });

    // Give some time for the response
    await new Promise((r) => setTimeout(r, 500));

    const messages = await readMessages(agent, 2000);

    const kinds = messages.map((m: any) => m.kind);
    expect(kinds).toContain("service_tier");
    expect(kinds).toContain("activation_success");
    expect(kinds).toContain("metadata");

    // Check service_tier has display
    const serviceTier = messages.find((m: any) => m.kind === "service_tier") as any;
    expect(serviceTier.display).toBeTruthy();

    // Check metadata has dustStrings
    const metadata = messages.find((m: any) => m.kind === "metadata") as any;
    expect(metadata.dustStrings).toBeInstanceOf(Array);
    expect(metadata.dustStrings.length).toBeGreaterThan(0);
  });

  test("ignores use_free_version without error", async () => {
    const agent = await startAgent();

    sendMessage(agent, { kind: "use_free_version" });

    // Give some time
    await new Promise((r) => setTimeout(r, 200));

    // Should not crash - process should still be running
    expect(agent.exitCode).toBeNull();
  });

  test("ignores logout without error", async () => {
    const agent = await startAgent();

    sendMessage(agent, { kind: "logout" });

    await new Promise((r) => setTimeout(r, 200));

    expect(agent.exitCode).toBeNull();
  });

  test("ignores inform_file_changed without error", async () => {
    const agent = await startAgent();

    sendMessage(agent, { kind: "inform_file_changed", path: "/test.py" });

    await new Promise((r) => setTimeout(r, 200));

    expect(agent.exitCode).toBeNull();
  });
});
