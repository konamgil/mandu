/**
 * DNA-013: Safe Stream Writer
 *
 * 파이프 환경에서 EPIPE 에러를 안전하게 처리
 * - `mandu routes list | head -5` 같은 파이프 사용 시 안전
 * - Broken pipe 감지 후 추가 쓰기 방지
 */

import type { WriteStream } from "tty";

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
  let closed = false;

  const write = (stream: NodeJS.WriteStream, text: string): boolean => {
    if (closed) return false;

    try {
      stream.write(text);
      return true;
    } catch (err) {
      if (!isBrokenPipeError(err)) {
        throw err;
      }

      closed = true;
      options.onBrokenPipe?.(err, stream);

      if (!options.silent) {
        // EPIPE는 정상적인 상황이므로 에러 출력하지 않음
        // (예: head, tail, grep 등과 파이프 사용 시)
      }

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
      closed = false;
    },
    isClosed: () => closed,
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
