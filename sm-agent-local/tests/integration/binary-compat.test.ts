/**
 * Binary Compatibility Proof Test
 *
 * This test verifies that our sm-agent-local binary behaves the same as
 * the real sm-agent binary from a protocol perspective.
 *
 * Prerequisites:
 * 1. Real sm-agent binary at ~/.supermaven/binary/v20/macosx-aarch64/sm-agent
 * 2. Valid ~/.supermaven/config.json with API key
 * 3. LM Studio running at localhost:1234 with a model loaded
 * 4. Internet connection for real sm-agent
 *
 * Run with: bun test tests/integration/binary-compat.test.ts --timeout 180000
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { homedir } from "os";
import { existsSync } from "fs";

// ============================================================================
// Configuration
// ============================================================================

const REAL_BINARY_PATH = `${homedir()}/.supermaven/binary/v20/macosx-aarch64/sm-agent`;
const LM_STUDIO_URL = "http://localhost:1234/v1";

// Timeouts (real binary needs network connection time)
const GREETING_TIMEOUT_MS = 15000;
const COMPLETION_TIMEOUT_MS = 30000;

// ============================================================================
// Types
// ============================================================================

interface SmMessage {
  kind: string;
  [key: string]: unknown;
}

interface BinaryHandle {
  proc: Subprocess<"pipe", "pipe", "pipe">;
  name: "real" | "local";
  messages: SmMessage[];
  buffer: string;
  readLoopPromise: Promise<void>;
}

// ============================================================================
// Test Infrastructure
// ============================================================================

/**
 * Check if LM Studio is reachable
 */
async function checkLmStudio(): Promise<boolean> {
  try {
    const response = await fetch(`${LM_STUDIO_URL}/models`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Start a binary and begin async read loop.
 * Mirrors Lua plugin's pattern: spawn -> read_start -> greeting
 */
function startBinary(type: "real" | "local"): BinaryHandle {
  let proc: Subprocess<"pipe", "pipe", "pipe">;

  if (type === "real") {
    proc = spawn({
      cmd: [REAL_BINARY_PATH, "stdio"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } else {
    proc = spawn({
      cmd: ["bun", "run", "src/index.ts"],
      cwd: import.meta.dir.replace("/tests/integration", ""),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  const handle: BinaryHandle = {
    proc,
    name: type,
    messages: [],
    buffer: "",
    readLoopPromise: Promise.resolve(),
  };

  // Start async read loop (like Lua's read_start)
  handle.readLoopPromise = runReadLoop(handle);

  return handle;
}

/**
 * Async read loop running in background.
 * Continuously reads stdout and parses SM-MESSAGE lines.
 */
async function runReadLoop(handle: BinaryHandle): Promise<void> {
  const decoder = new TextDecoder();

  try {
    // Use for-await to read stream chunks
    for await (const chunk of handle.proc.stdout) {
      const text = decoder.decode(chunk, { stream: true });
      handle.buffer += text;

      // Process complete lines
      while (handle.buffer.includes("\n")) {
        const idx = handle.buffer.indexOf("\n");
        const line = handle.buffer.slice(0, idx);
        handle.buffer = handle.buffer.slice(idx + 1);

        if (line.startsWith("SM-MESSAGE ")) {
          try {
            const json = JSON.parse(line.slice(11));
            handle.messages.push(json);
          } catch (e) {
            console.error(`[${handle.name}] Parse error:`, e);
          }
        } else if (line.trim()) {
          // Log non-SM-MESSAGE lines (startup logs, etc.)
          console.log(`[${handle.name}] ${line}`);
        }
      }
    }
  } catch (e) {
    // Stream closed or error - this is expected on shutdown
    if (!(e instanceof Error) || !e.message.includes("stream")) {
      console.error(`[${handle.name}] Read loop error:`, e);
    }
  }
}

/**
 * Send a message to a binary via stdin.
 */
function sendMessage(handle: BinaryHandle, msg: object): void {
  const line = JSON.stringify(msg) + "\n";
  handle.proc.stdin.write(line);
  handle.proc.stdin.flush();
}

/**
 * Wait until we have messages with all specified kinds, or timeout.
 */
async function waitForKinds(
  handle: BinaryHandle,
  kinds: string[],
  timeout: number
): Promise<SmMessage[]> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const foundKinds = new Set(handle.messages.map((m) => m.kind));

    if (kinds.every((k) => foundKinds.has(k))) {
      // Wait a bit more for additional messages
      await new Promise((r) => setTimeout(r, 300));
      return [...handle.messages];
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  return [...handle.messages];
}

/**
 * Wait for response messages with "end" item for a specific stateId.
 */
async function waitForResponseEnd(
  handle: BinaryHandle,
  stateId: string,
  timeout: number
): Promise<SmMessage[]> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    // Look for response with "end" item
    for (const msg of handle.messages) {
      if (msg.kind === "response" && msg.stateId === stateId) {
        const items = msg.items as Array<{ kind: string }>;
        if (items.some((item) => item.kind === "end")) {
          await new Promise((r) => setTimeout(r, 100));
          return [...handle.messages];
        }
      }
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  return [...handle.messages];
}

/**
 * Get messages received since a given index.
 */
function getNewMessages(handle: BinaryHandle, sinceIndex: number): SmMessage[] {
  return handle.messages.slice(sinceIndex);
}

/**
 * Collect all text from response messages for a given stateId.
 */
function collectCompletionText(messages: SmMessage[], stateId: string): string {
  let text = "";
  for (const msg of messages) {
    if (msg.kind === "response" && msg.stateId === stateId) {
      const items = msg.items as Array<{ kind: string; text?: string }>;
      for (const item of items) {
        if (item.kind === "text" && item.text) {
          text += item.text;
        }
      }
    }
  }
  return text;
}

/**
 * Stop a binary gracefully.
 */
function stopBinary(handle: BinaryHandle): void {
  try {
    handle.proc.stdin.end();
  } catch {
    // Ignore
  }
  try {
    handle.proc.kill();
  } catch {
    // Ignore
  }
}

// ============================================================================
// Test Data
// ============================================================================

const GREETING_MESSAGE = {
  kind: "greeting",
  allowGitignore: false,
};

// ============================================================================
// Tests
// ============================================================================

describe("Binary Compatibility", () => {
  let realBinary: BinaryHandle;
  let localBinary: BinaryHandle;

  beforeAll(async () => {
    // Check real binary exists
    if (!existsSync(REAL_BINARY_PATH)) {
      throw new Error(
        `Real sm-agent binary not found at ${REAL_BINARY_PATH}\n` +
          `Please ensure supermaven-nvim has downloaded the binary.`
      );
    }

    // Check LM Studio is running
    const lmStudioOk = await checkLmStudio();
    if (!lmStudioOk) {
      throw new Error(
        `LM Studio not reachable at ${LM_STUDIO_URL}\n` +
          `Please start LM Studio and load a model.`
      );
    }

    console.log("Starting binaries...");

    // Start both binaries
    realBinary = startBinary("real");
    localBinary = startBinary("local");

    // Small delay for process startup
    await new Promise((r) => setTimeout(r, 500));

    // Send greeting (like Lua plugin does after starting read loop)
    console.log("Sending greeting messages...");
    sendMessage(realBinary, GREETING_MESSAGE);
    sendMessage(localBinary, GREETING_MESSAGE);

    // Wait for connections to establish
    console.log("Waiting for binaries to connect...\n");
    await new Promise((r) => setTimeout(r, 3000));
  });

  afterAll(() => {
    console.log("\nCleaning up...");
    if (realBinary) stopBinary(realBinary);
    if (localBinary) stopBinary(localBinary);
  });

  describe("Greeting Response", () => {
    test("local binary returns greeting response kinds immediately", async () => {
      // Local binary returns: service_tier, activation_success, metadata
      // (Real binary defers connection until first state_update, so we test local only here)

      const localMessages = await waitForKinds(
        localBinary,
        ["service_tier", "activation_success", "metadata"],
        GREETING_TIMEOUT_MS
      );

      console.log(`Local binary: ${localMessages.length} messages`);

      const localKinds = [...new Set(localMessages.map((m) => m.kind))];
      console.log(`Local kinds: ${JSON.stringify(localKinds)}`);

      // Local binary should have service_tier, activation_success, metadata
      expect(localKinds).toContain("service_tier");
      expect(localKinds).toContain("activation_success");
      expect(localKinds).toContain("metadata");

      // Check local service_tier has display
      const localServiceTier = localMessages.find(
        (m) => m.kind === "service_tier"
      );
      console.log(
        `\nLocal service_tier.display: "${localServiceTier?.display}"`
      );
      expect(localServiceTier?.display).toBeTruthy();

      // Check local metadata has dustStrings
      const localMetadata = localMessages.find((m) => m.kind === "metadata");
      expect(Array.isArray(localMetadata?.dustStrings)).toBe(true);
    });

    test("real binary connects and returns user_status on first state_update", async () => {
      // Real binary only connects to Supermaven servers on first state_update
      // This is different from local binary but matches the plugin's usage pattern

      const beforeReal = realBinary.messages.length;

      // Trigger connection with a simple state_update
      const code = "# test\n";
      const stateUpdate = {
        kind: "state_update",
        newId: "greeting-test",
        updates: [
          { kind: "file_update", path: "/tmp/greeting-test.py", content: code },
          { kind: "cursor_update", path: "/tmp/greeting-test.py", offset: code.length },
        ],
      };

      sendMessage(realBinary, stateUpdate);

      // Wait for connection messages
      await waitForKinds(realBinary, ["user_status"], GREETING_TIMEOUT_MS);

      const realMessages = getNewMessages(realBinary, beforeReal);
      const realKinds = [...new Set(realMessages.map((m) => m.kind))];

      console.log(`Real binary: ${realMessages.length} messages after state_update`);
      console.log(`Real kinds: ${JSON.stringify(realKinds)}`);

      // Real binary should have connection_status and user_status
      expect(realKinds).toContain("connection_status");
      expect(realKinds).toContain("user_status");

      // Check user_status has tier
      const userStatus = realMessages.find((m) => m.kind === "user_status");
      console.log(`\nReal user_status.tier: "${userStatus?.tier}"`);
      expect(userStatus?.tier).toBeTruthy();
    });
  });

  describe("State Update Response", () => {
    test("both binaries return response with correct stateId and items", async () => {
      const beforeReal = realBinary.messages.length;
      const beforeLocal = localBinary.messages.length;

      // Simple completion request: "def add(a, b):\n    "
      // Content length = 19 bytes
      const code = "def add(a, b):\n    ";

      const stateUpdate = {
        kind: "state_update",
        newId: "1",
        updates: [
          { kind: "file_update", path: "/tmp/test.py", content: code },
          { kind: "cursor_update", path: "/tmp/test.py", offset: code.length },
        ],
      };

      console.log("\nSending state_update (stateId: 1)...");
      sendMessage(realBinary, stateUpdate);
      sendMessage(localBinary, stateUpdate);

      // Wait for responses with "end" marker
      await Promise.all([
        waitForResponseEnd(realBinary, "1", COMPLETION_TIMEOUT_MS),
        waitForResponseEnd(localBinary, "1", COMPLETION_TIMEOUT_MS),
      ]);

      const realNew = getNewMessages(realBinary, beforeReal);
      const localNew = getNewMessages(localBinary, beforeLocal);

      console.log(`Real binary: ${realNew.length} new messages`);
      console.log(`Local binary: ${localNew.length} new messages`);

      // Filter to response messages WITH stateId "1" specifically
      const realResponses = realNew.filter(
        (m) => m.kind === "response" && m.stateId === "1"
      );
      const localResponses = localNew.filter(
        (m) => m.kind === "response" && m.stateId === "1"
      );

      expect(realResponses.length).toBeGreaterThan(0);
      expect(localResponses.length).toBeGreaterThan(0);

      // Check stateId and items array
      for (const resp of realResponses) {
        expect(resp.stateId).toBe("1");
        expect(Array.isArray(resp.items)).toBe(true);
      }
      for (const resp of localResponses) {
        expect(resp.stateId).toBe("1");
        expect(Array.isArray(resp.items)).toBe(true);
      }

      // Check items have valid kinds
      // Real binary can also return "barrier" items
      const validKinds = ["text", "end", "delete", "dedent", "barrier"];
      for (const resp of [...realResponses, ...localResponses]) {
        const items = resp.items as Array<{ kind: string }>;
        for (const item of items) {
          expect(validKinds).toContain(item.kind);
        }
      }
    });
  });

  describe("Completion Content", () => {
    test("capture and compare completions", async () => {
      const beforeReal = realBinary.messages.length;
      const beforeLocal = localBinary.messages.length;

      const code = "def multiply(x, y):\n    ";

      const stateUpdate = {
        kind: "state_update",
        newId: "2",
        updates: [
          { kind: "file_update", path: "/tmp/test.py", content: code },
          { kind: "cursor_update", path: "/tmp/test.py", offset: code.length },
        ],
      };

      console.log("\nSending state_update (stateId: 2) for multiply...");
      sendMessage(realBinary, stateUpdate);
      sendMessage(localBinary, stateUpdate);

      await Promise.all([
        waitForResponseEnd(realBinary, "2", COMPLETION_TIMEOUT_MS),
        waitForResponseEnd(localBinary, "2", COMPLETION_TIMEOUT_MS),
      ]);

      const realCompletion = collectCompletionText(
        getNewMessages(realBinary, beforeReal),
        "2"
      );
      const localCompletion = collectCompletionText(
        getNewMessages(localBinary, beforeLocal),
        "2"
      );

      console.log("\n" + "=".repeat(60));
      console.log("COMPLETION COMPARISON");
      console.log("=".repeat(60));
      console.log("\nInput code:");
      console.log("```python");
      console.log(code);
      console.log("```");
      console.log("\n--- Real sm-agent (Supermaven) ---");
      console.log(
        `"${realCompletion.slice(0, 200)}${realCompletion.length > 200 ? "..." : ""}"`
      );
      console.log("\n--- Local sm-agent (LM Studio) ---");
      console.log(
        `"${localCompletion.slice(0, 200)}${localCompletion.length > 200 ? "..." : ""}"`
      );
      console.log("=".repeat(60));

      // Both should return non-empty completions
      expect(realCompletion.length).toBeGreaterThan(0);
      expect(localCompletion.length).toBeGreaterThan(0);

      // Basic sanity: both should contain "return" for this function
      expect(realCompletion.toLowerCase()).toContain("return");
      expect(localCompletion.toLowerCase()).toContain("return");
    });
  });

  describe("Multiple Sequential Requests", () => {
    test("both binaries handle multiple state updates", async () => {
      const functions = [
        { id: "10", code: "def square(x):\n    ", name: "square" },
        { id: "11", code: "def double(x):\n    ", name: "double" },
        { id: "12", code: "def is_positive(n):\n    ", name: "is_positive" },
      ];

      console.log("\nSending 3 sequential state updates...");

      const results: Array<{
        id: string;
        name: string;
        real: string;
        local: string;
      }> = [];

      for (const { id, code, name } of functions) {
        const beforeReal = realBinary.messages.length;
        const beforeLocal = localBinary.messages.length;

        const stateUpdate = {
          kind: "state_update",
          newId: id,
          updates: [
            { kind: "file_update", path: "/tmp/test.py", content: code },
            {
              kind: "cursor_update",
              path: "/tmp/test.py",
              offset: code.length,
            },
          ],
        };

        sendMessage(realBinary, stateUpdate);
        sendMessage(localBinary, stateUpdate);

        // Wait for this response before next
        await Promise.all([
          waitForResponseEnd(realBinary, id, COMPLETION_TIMEOUT_MS),
          waitForResponseEnd(localBinary, id, COMPLETION_TIMEOUT_MS),
        ]);

        const realCompletion = collectCompletionText(
          getNewMessages(realBinary, beforeReal),
          id
        );
        const localCompletion = collectCompletionText(
          getNewMessages(localBinary, beforeLocal),
          id
        );

        results.push({
          id,
          name,
          real: realCompletion,
          local: localCompletion,
        });
      }

      console.log("\n--- Sequential Request Results ---");
      for (const { id, name, real, local } of results) {
        console.log(`\nstateId "${id}" (${name}):`);
        console.log(
          `  Real:  "${real.slice(0, 50)}${real.length > 50 ? "..." : ""}"`
        );
        console.log(
          `  Local: "${local.slice(0, 50)}${local.length > 50 ? "..." : ""}"`
        );
      }

      // All should have completions
      for (const { real, local } of results) {
        expect(real.length).toBeGreaterThan(0);
        expect(local.length).toBeGreaterThan(0);
      }
    });
  });
});
