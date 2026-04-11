/**
 * Tests for useSSE hook and readStreamWithYield utility
 *
 * These tests verify the microtask-starvation-safe ReadableStream reading
 * utilities work correctly.
 */
import { describe, test, expect, beforeEach, mock } from "bun:test";
import { readStreamWithYield } from "../use-sse";

// Note: useSSE is a React hook and would need a React testing environment.
// We test the lower-level readStreamWithYield utility here since it contains
// the core macrotask-yielding logic that prevents main thread blocking.

/**
 * Helper: create a ReadableStream from an array of strings
 */
function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
      } else {
        controller.close();
      }
    },
  });
}

describe("readStreamWithYield", () => {
  test("should read all chunks from a stream", async () => {
    const chunks = ["Hello", " ", "World"];
    const stream = createMockStream(chunks);
    const received: string[] = [];

    await readStreamWithYield(stream, {
      onChunk: (text) => received.push(text),
      onDone: () => {},
    });

    expect(received).toEqual(chunks);
  });

  test("should call onDone when stream completes", async () => {
    const stream = createMockStream(["a", "b"]);
    let doneCalled = false;

    await readStreamWithYield(stream, {
      onChunk: () => {},
      onDone: () => {
        doneCalled = true;
      },
    });

    expect(doneCalled).toBe(true);
  });

  test("should call onError on stream failure", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.error(new Error("test error"));
      },
    });

    let errorCaught: Error | null = null;

    await readStreamWithYield(stream, {
      onChunk: () => {},
      onError: (err) => {
        errorCaught = err;
      },
    });

    expect(errorCaught).not.toBeNull();
    expect(errorCaught!.message).toBe("test error");
  });

  test("should respect abort signal", async () => {
    const controller = new AbortController();
    const chunks = ["a", "b", "c", "d", "e"];
    const stream = createMockStream(chunks);
    const received: string[] = [];

    // Abort after first chunk
    let chunkCount = 0;

    await readStreamWithYield(stream, {
      onChunk: (text) => {
        received.push(text);
        chunkCount++;
        if (chunkCount >= 2) {
          controller.abort();
        }
      },
      signal: controller.signal,
    });

    // Should have received at most 2-3 chunks (abort may not be immediate)
    expect(received.length).toBeLessThanOrEqual(3);
    expect(received.length).toBeGreaterThanOrEqual(2);
  });

  test("should handle empty stream", async () => {
    const stream = createMockStream([]);
    const received: string[] = [];
    let doneCalled = false;

    await readStreamWithYield(stream, {
      onChunk: (text) => received.push(text),
      onDone: () => {
        doneCalled = true;
      },
    });

    expect(received).toEqual([]);
    expect(doneCalled).toBe(true);
  });

  test("should yield between chunks (non-blocking)", async () => {
    // Create a stream with many rapid chunks
    const chunkCount = 50;
    const chunks = Array.from({ length: chunkCount }, (_, i) => `chunk-${i}`);
    const stream = createMockStream(chunks);
    const received: string[] = [];

    // Track that setTimeout(0) yields are happening by checking
    // that the promise resolves in multiple event loop ticks
    let macrotaskCount = 0;
    const originalSetTimeout = globalThis.setTimeout;

    // Count macrotask yields (setTimeout(0) calls from yieldToMacrotask)
    const timeoutSpy = mock((fn: Function, ms: number) => {
      if (ms === 0) macrotaskCount++;
      return originalSetTimeout(fn, ms);
    });
    // @ts-expect-error - mock override
    globalThis.setTimeout = timeoutSpy;

    try {
      await readStreamWithYield(stream, {
        onChunk: (text) => received.push(text),
      });

      // Every chunk should cause a macrotask yield
      expect(received.length).toBe(chunkCount);
      expect(macrotaskCount).toBeGreaterThanOrEqual(chunkCount);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });
});
