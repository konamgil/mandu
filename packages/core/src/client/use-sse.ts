/**
 * Mandu useSSE Hook - ReadableStream SSE reading for island components
 *
 * Problem: When a React component (inside createRoot) reads a ReadableStream
 * in a tight `while(true) { await reader.read(); setState(...); }` loop,
 * React 19's internal scheduler uses `queueMicrotask` to process state updates.
 * Combined with fast SSE token streams, the microtask queue never drains,
 * starving the macrotask queue (DOM painting, user input, MessageChannel).
 * This effectively freezes the main thread.
 *
 * Solution: This hook yields to the macrotask queue between chunks using
 * `setTimeout(0)`, allowing the browser to paint and process user input
 * between state updates. Chunks arriving during the yield are coalesced
 * into a single state update to minimize re-renders.
 *
 * @module client/use-sse
 */

import { useState, useCallback, useRef, useEffect } from "react";

// ============================================================================
// Types
// ============================================================================

export interface UseSSEOptions {
  /**
   * Called for each SSE chunk (after TextDecoder).
   * Return the new accumulated value to set as state.
   * @param accumulated - Current accumulated value
   * @param chunk - New text chunk from the stream
   * @returns Updated accumulated value
   */
  onChunk?: (accumulated: string, chunk: string) => string;

  /**
   * Called when the stream completes.
   * @param finalValue - The final accumulated value
   */
  onComplete?: (finalValue: string) => void;

  /**
   * Called when the stream errors.
   * @param error - The error that occurred
   */
  onError?: (error: Error) => void;

  /**
   * Minimum interval between state updates in ms.
   * Higher values reduce re-renders but increase perceived latency.
   * Default: 0 (yield once per chunk via setTimeout(0))
   */
  throttleMs?: number;
}

export interface UseSSEReturn {
  /** Current accumulated stream data */
  data: string;

  /** Whether the stream is currently active */
  isStreaming: boolean;

  /** Error if the stream failed */
  error: Error | null;

  /**
   * Start reading an SSE stream.
   * Pass a fetch Response or a ReadableStream<Uint8Array>.
   */
  start: (source: Response | ReadableStream<Uint8Array>) => void;

  /**
   * Abort the current stream.
   */
  abort: () => void;

  /** Reset state (data, error, isStreaming) */
  reset: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Yield to the macrotask queue, allowing the browser to paint and
 * process user input. This breaks the microtask starvation cycle
 * caused by tight `await reader.read()` + `setState()` loops.
 */
function yieldToMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ============================================================================
// Hook
// ============================================================================

/**
 * React hook for reading SSE / ReadableStream data inside island components
 * without blocking the main thread.
 *
 * @example
 * ```tsx
 * import { useSSE } from "@mandujs/core/client";
 *
 * function ChatIsland() {
 *   const { data, isStreaming, start } = useSSE({
 *     onComplete: (text) => console.log("Done:", text),
 *   });
 *
 *   const sendMessage = async () => {
 *     const res = await fetch("/api/chat", { method: "POST", body: ... });
 *     start(res);
 *   };
 *
 *   return (
 *     <div>
 *       <p>{data}</p>
 *       {isStreaming && <span>streaming...</span>}
 *       <button onClick={sendMessage} disabled={isStreaming}>Send</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useSSE(options: UseSSEOptions = {}): UseSSEReturn {
  const {
    onChunk = (acc: string, chunk: string) => acc + chunk,
    onComplete,
    onError,
    throttleMs = 0,
  } = options;

  const [data, setData] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Refs for the current stream session (allow abort & prevent stale closures)
  const abortRef = useRef<AbortController | null>(null);
  const accumulatorRef = useRef("");
  const pendingChunksRef = useRef("");
  const flushScheduledRef = useRef(false);
  const optionsRef = useRef({ onChunk, onComplete, onError, throttleMs });

  // Keep options ref in sync
  useEffect(() => {
    optionsRef.current = { onChunk, onComplete, onError, throttleMs };
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  /**
   * Flush pending chunks as a single batched state update.
   * Uses setTimeout(0) to yield to the macrotask queue first.
   */
  const flushPending = useCallback(() => {
    if (!flushScheduledRef.current) return;

    const pending = pendingChunksRef.current;
    if (pending) {
      const { onChunk: chunkFn } = optionsRef.current;
      accumulatorRef.current = chunkFn(accumulatorRef.current, pending);
      pendingChunksRef.current = "";
      setData(accumulatorRef.current);
    }
    flushScheduledRef.current = false;
  }, []);

  /**
   * Schedule a flush via setTimeout to yield to macrotask queue.
   */
  const scheduleFlush = useCallback(() => {
    if (!flushScheduledRef.current) {
      flushScheduledRef.current = true;
      setTimeout(flushPending, optionsRef.current.throttleMs);
    }
  }, [flushPending]);

  const start = useCallback(
    (source: Response | ReadableStream<Uint8Array>) => {
      // Abort any existing stream
      if (abortRef.current) {
        abortRef.current.abort();
      }

      const controller = new AbortController();
      abortRef.current = controller;
      accumulatorRef.current = "";
      pendingChunksRef.current = "";
      flushScheduledRef.current = false;

      setData("");
      setError(null);
      setIsStreaming(true);

      const body =
        source instanceof Response ? source.body : source;

      if (!body) {
        setIsStreaming(false);
        setError(new Error("Response has no body"));
        return;
      }

      // Start reading in a properly-yielding async loop
      (async () => {
        const reader = body.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            // Check for abort
            if (controller.signal.aborted) {
              reader.cancel();
              break;
            }

            const { done, value } = await reader.read();
            if (done) break;

            // Check for abort again (may have been aborted during read)
            if (controller.signal.aborted) {
              reader.cancel();
              break;
            }

            const text = decoder.decode(value, { stream: true });
            if (text) {
              // Accumulate chunks and schedule a batched flush
              pendingChunksRef.current += text;
              scheduleFlush();
            }

            // CRITICAL: Yield to the macrotask queue to prevent microtask
            // starvation. Without this, the tight loop of
            // `await reader.read() -> setState -> React microtask -> next read`
            // starves the browser's macrotask queue, freezing the UI.
            await yieldToMacrotask();
          }

          // Final flush for any remaining chunks
          if (pendingChunksRef.current) {
            flushScheduledRef.current = true;
            flushPending();
          }

          if (!controller.signal.aborted) {
            setIsStreaming(false);
            const opts = optionsRef.current;
            if (opts.onComplete) {
              opts.onComplete(accumulatorRef.current);
            }
          }
        } catch (err) {
          if (
            !controller.signal.aborted &&
            !(err instanceof DOMException && err.name === "AbortError")
          ) {
            const error =
              err instanceof Error ? err : new Error(String(err));
            setError(error);
            setIsStreaming(false);
            const opts = optionsRef.current;
            if (opts.onError) {
              opts.onError(error);
            }
          }
        }
      })();
    },
    [scheduleFlush, flushPending]
  );

  const abort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const reset = useCallback(() => {
    abort();
    setData("");
    setError(null);
    accumulatorRef.current = "";
    pendingChunksRef.current = "";
    flushScheduledRef.current = false;
  }, [abort]);

  return { data, isStreaming, error, start, abort, reset };
}

// ============================================================================
// Low-level utility (for non-hook usage)
// ============================================================================

/**
 * Read a ReadableStream with macrotask yielding, suitable for use
 * outside of React components (e.g., in plain event handlers).
 *
 * @example
 * ```ts
 * import { readStreamWithYield } from "@mandujs/core/client";
 *
 * const response = await fetch("/api/stream");
 * await readStreamWithYield(response.body!, {
 *   onChunk: (text) => {
 *     // update DOM directly
 *     el.textContent += text;
 *   },
 *   onDone: () => console.log("done"),
 * });
 * ```
 */
export interface ReadStreamOptions {
  /** Called for each decoded text chunk */
  onChunk: (text: string) => void;
  /** Called when the stream is complete */
  onDone?: () => void;
  /** Called on error */
  onError?: (error: Error) => void;
  /** AbortSignal to cancel reading */
  signal?: AbortSignal;
}

export async function readStreamWithYield(
  stream: ReadableStream<Uint8Array>,
  options: ReadStreamOptions
): Promise<void> {
  const { onChunk, onDone, onError, signal } = options;
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      if (signal?.aborted) {
        reader.cancel();
        break;
      }

      const text = decoder.decode(value, { stream: true });
      if (text) {
        onChunk(text);
      }

      // Yield to macrotask queue
      await yieldToMacrotask();
    }

    if (!signal?.aborted) {
      onDone?.();
    }
  } catch (err) {
    if (
      !signal?.aborted &&
      !(err instanceof DOMException && err.name === "AbortError")
    ) {
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.(error);
    }
  }
}
