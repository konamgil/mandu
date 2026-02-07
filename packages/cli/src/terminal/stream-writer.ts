/**
 * DNA-013: Safe Stream Writer
 *
 * 파이프 환경에서 EPIPE 에러를 안전하게 처리
 * - `mandu routes list | head -5` 같은 파이프 사용 시 안전
 * - Broken pipe 감지 후 추가 쓰기 방지
 */

/**
 * Safe Stream Writer 옵션
 */
export interface SafeStreamWriterOptions {
  /**
   * Broken pipe 발생 시 콜백
   */
  onBrokenPipe?: (error: NodeJS.ErrnoException, stream: NodeJS.WriteStream) => void;

  /**
   * 조용히 실패 (에러 출력 안 함)
   */
  silent?: boolean;

  /**
   * Broken pipe 이외의 에러 핸들러 (선택)
   */
  onError?: (error: Error, stream: NodeJS.WriteStream) => void;
}

/**
 * Safe Stream Writer 인터페이스
 */
export interface SafeStreamWriter {
  /**
   * 스트림에 텍스트 쓰기
   * @returns 성공 여부
   */
  write: (stream: NodeJS.WriteStream, text: string) => boolean;

  /**
   * 스트림에 줄 쓰기 (자동 개행)
   * @returns 성공 여부
   */
  writeLine: (stream: NodeJS.WriteStream, text: string) => boolean;

  /**
   * stdout에 쓰기 (편의 메서드)
   */
  print: (text: string) => boolean;

  /**
   * stdout에 줄 쓰기 (편의 메서드)
   */
  println: (text: string) => boolean;

  /**
   * stderr에 쓰기 (편의 메서드)
   */
  printError: (text: string) => boolean;

  /**
   * 상태 리셋
   */
  reset: () => void;

  /**
   * 스트림이 닫혔는지 확인
   */
  isClosed: () => boolean;
}

/**
 * Broken Pipe 에러인지 확인
 */
function isBrokenPipeError(err: unknown): err is NodeJS.ErrnoException {
  const errno = err as NodeJS.ErrnoException;
  return errno?.code === "EPIPE" || errno?.code === "EIO";
}

/**
 * Safe Stream Writer 생성
 *
 * @example
 * ```ts
 * const writer = createSafeStreamWriter();
 *
 * // 기본 사용
 * writer.println("Hello, World!");
 *
 * // 파이프에서 안전하게 사용
 * for (const line of lines) {
 *   if (!writer.println(line)) {
 *     // 파이프가 닫힘, 루프 종료
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

      // 비정상 에러는 기존 동작을 유지하도록 비동기 재-throw
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
 * 기본 Safe Writer 인스턴스 (싱글톤)
 */
let defaultWriter: SafeStreamWriter | null = null;

/**
 * 기본 Safe Writer 가져오기
 */
export function getSafeWriter(): SafeStreamWriter {
  if (!defaultWriter) {
    defaultWriter = createSafeStreamWriter({ silent: true });
  }
  return defaultWriter;
}

/**
 * 안전한 console.log 대체
 *
 * @example
 * ```ts
 * import { safePrint, safePrintln } from "./stream-writer";
 *
 * safePrintln("Hello, World!");
 * // 파이프가 닫혀도 에러 없음
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
