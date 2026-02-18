/**
 * DNA-013: Safe Stream Writer
 *
 * Safely handles EPIPE errors in piped environments
 * - Safe for piped usage like `mandu routes list | head -5`
 * - Prevents additional writes after broken pipe detection
 */

/**
 * Safe Stream Writer options
 */
export interface SafeStreamWriterOptions {
  /**
   * Callback when broken pipe occurs
   */
  onBrokenPipe?: (error: NodeJS.ErrnoException, stream: NodeJS.WriteStream) => void;

  /**
   * Fail silently (suppress error output)
   */
  silent?: boolean;

  /**
   * Error handler for non-broken-pipe errors (optional)
   */
  onError?: (error: Error, stream: NodeJS.WriteStream) => void;
}

/**
 * Safe Stream Writer interface
 */
export interface SafeStreamWriter {
  /**
   * Write text to stream
   * @returns Whether write succeeded
   */
  write: (stream: NodeJS.WriteStream, text: string) => boolean;

  /**
   * Write line to stream (auto newline)
   * @returns Whether write succeeded
   */
  writeLine: (stream: NodeJS.WriteStream, text: string) => boolean;

  /**
   * Write to stdout (convenience method)
   */
  print: (text: string) => boolean;

  /**
   * Write line to stdout (convenience method)
   */
  println: (text: string) => boolean;

  /**
   * Write to stderr (convenience method)
   */
  printError: (text: string) => boolean;

  /**
   * Reset state
   */
  reset: () => void;

  /**
   * Check if stream is closed
   */
  isClosed: () => boolean;
}

/**
 * Check if error is a broken pipe error
 */
function isBrokenPipeError(err: unknown): err is NodeJS.ErrnoException {
  const errno = err as NodeJS.ErrnoException;
  return errno?.code === "EPIPE" || errno?.code === "EIO";
}

/**
 * Create Safe Stream Writer
 *
 * @example
 * ```ts
 * const writer = createSafeStreamWriter();
 *
 * // Basic usage
 * writer.println("Hello, World!");
 *
 * // Safe usage in piped environments
 * for (const line of lines) {
 *   if (!writer.println(line)) {
 *     // Pipe closed, exit loop
 *     break;
 *   }
 * }
 * ```
 */
export function createSafeStreamWriter(
  options: SafeStreamWriterOptions = {}
): SafeStreamWriter {
  const closedStreams = new Set<NodeJS.WriteStream>();
  const errorHandlers = new Map<NodeJS.WriteStream, (err: Error) => void>();

  const ensureErrorHandler = (stream: NodeJS.WriteStream): void => {
    if (errorHandlers.has(stream)) return;

    const handler = (err: Error) => {
      if (isBrokenPipeError(err)) {
        closedStreams.add(stream);
        options.onBrokenPipe?.(err, stream);
        return;
      }

      if (options.onError) {
        options.onError(err, stream);
        return;
      }

      if (!options.silent) {
        console.error("[SafeStreamWriter] Stream error:", err);
      }

      // Re-throw unexpected errors asynchronously to preserve default behavior
      setTimeout(() => {
        throw err;
      }, 0);
    };

    stream.on("error", handler);
    errorHandlers.set(stream, handler);
  };

  const isStreamClosed = (stream: NodeJS.WriteStream): boolean => {
    const anyStream = stream as NodeJS.WriteStream & {
      destroyed?: boolean;
      writableEnded?: boolean;
    };
    if (anyStream.destroyed || anyStream.writableEnded) return true;
    return closedStreams.has(stream);
  };

  const write = (stream: NodeJS.WriteStream, text: string): boolean => {
    if (isStreamClosed(stream)) return false;

    ensureErrorHandler(stream);

    try {
      stream.write(text);
      return true;
    } catch (err) {
      if (!isBrokenPipeError(err)) {
        throw err;
      }

      closedStreams.add(stream);
      options.onBrokenPipe?.(err, stream);
      return false;
    }
  };

  return {
    write,
    writeLine: (stream, text) => write(stream, `${text}\n`),
    print: (text) => write(process.stdout, text),
    println: (text) => write(process.stdout, `${text}\n`),
    printError: (text) => write(process.stderr, `${text}\n`),
    reset: () => {
      closedStreams.clear();
      for (const [stream, handler] of errorHandlers) {
        stream.removeListener("error", handler);
      }
      errorHandlers.clear();
    },
    isClosed: () => isStreamClosed(process.stdout),
  };
}

/**
 * Default Safe Writer instance (singleton)
 */
let defaultWriter: SafeStreamWriter | null = null;

/**
 * Get default Safe Writer
 */
export function getSafeWriter(): SafeStreamWriter {
  if (!defaultWriter) {
    defaultWriter = createSafeStreamWriter({ silent: true });
  }
  return defaultWriter;
}

/**
 * Safe console.log replacement
 *
 * @example
 * ```ts
 * import { safePrint, safePrintln } from "./stream-writer";
 *
 * safePrintln("Hello, World!");
 * // No error even when pipe is closed
 * ```
 */
export function safePrint(text: string): boolean {
  return getSafeWriter().print(text);
}

export function safePrintln(text: string): boolean {
  return getSafeWriter().println(text);
}

export function safePrintError(text: string): boolean {
  return getSafeWriter().printError(text);
}
