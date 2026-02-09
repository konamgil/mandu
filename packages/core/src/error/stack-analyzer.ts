import type { GeneratedMap } from "../generator/generate";

/**
 * 스택 프레임 정보
 */
export interface StackFrame {
  /** 파일 경로 */
  file: string;
  /** 라인 번호 */
  line: number;
  /** 컬럼 번호 (선택) */
  column?: number;
  /** 함수 이름 (선택) */
  functionName?: string;
  /** 네이티브 코드 여부 */
  isNative: boolean;
}

/**
 * 스택 트레이스 분석기
 */
export class StackTraceAnalyzer {
  /** Generated 파일 매핑 */
  private generatedMap: GeneratedMap | null;
  /** 프로젝트 루트 디렉토리 */
  private rootDir: string;

  constructor(generatedMap: GeneratedMap | null = null, rootDir: string = process.cwd()) {
    this.generatedMap = generatedMap;
    this.rootDir = rootDir;
  }

  /**
   * Error.stack 문자열을 구조화된 프레임으로 파싱
   */
  parseStack(stack: string | undefined): StackFrame[] {
    if (!stack) return [];

    const frames: StackFrame[] = [];
    const lines = stack.split("\n");

    for (const line of lines) {
      const frame = this.parseStackLine(line);
      if (frame) {
        frames.push(frame);
      }
    }

    return frames;
  }

  /**
   * 단일 스택 라인 파싱
   * V8/Bun 형식: "    at functionName (file:line:column)"
   *           또는 "    at file:line:column"
   */
  private parseStackLine(line: string): StackFrame | null {
    const trimmed = line.trim();

    // "at " 로 시작하지 않으면 스킵
    if (!trimmed.startsWith("at ")) {
      return null;
    }

    const content = trimmed.slice(3); // "at " 제거

    // 네이티브 코드 체크
    if (content.includes("[native code]") || content.startsWith("native")) {
      return {
        file: "native",
        line: 0,
        isNative: true,
      };
    }

    // 패턴 1: "functionName (file:line:column)"
    const withFnMatch = content.match(/^(.+?)\s+\((.+?):(\d+):(\d+)\)$/);
    if (withFnMatch) {
      return {
        functionName: withFnMatch[1],
        file: this.normalizePath(withFnMatch[2]),
        line: parseInt(withFnMatch[3], 10),
        column: parseInt(withFnMatch[4], 10),
        isNative: false,
      };
    }

    // 패턴 2: "functionName (file:line)"
    const withFnNoColMatch = content.match(/^(.+?)\s+\((.+?):(\d+)\)$/);
    if (withFnNoColMatch) {
      return {
        functionName: withFnNoColMatch[1],
        file: this.normalizePath(withFnNoColMatch[2]),
        line: parseInt(withFnNoColMatch[3], 10),
        isNative: false,
      };
    }

    // 패턴 3: "file:line:column"
    const noFnMatch = content.match(/^(.+?):(\d+):(\d+)$/);
    if (noFnMatch) {
      return {
        file: this.normalizePath(noFnMatch[1]),
        line: parseInt(noFnMatch[2], 10),
        column: parseInt(noFnMatch[3], 10),
        isNative: false,
      };
    }

    // 패턴 4: "file:line"
    const noFnNoColMatch = content.match(/^(.+?):(\d+)$/);
    if (noFnNoColMatch) {
      return {
        file: this.normalizePath(noFnNoColMatch[1]),
        line: parseInt(noFnNoColMatch[2], 10),
        isNative: false,
      };
    }

    return null;
  }

  /**
   * 파일 경로 정규화 (상대 경로로 변환)
   */
  private normalizePath(filePath: string): string {
    // Windows 경로 정규화
    let normalized = filePath.replace(/\\/g, "/");

    // 프로젝트 루트 제거
    const rootNormalized = this.rootDir.replace(/\\/g, "/");
    if (normalized.startsWith(rootNormalized)) {
      normalized = normalized.slice(rootNormalized.length);
      if (normalized.startsWith("/")) {
        normalized = normalized.slice(1);
      }
    }

    return normalized;
  }

  /**
   * Generated 파일인지 확인
   */
  isGeneratedFile(file: string): boolean {
    if (!this.generatedMap) return false;

    const normalized = this.normalizePath(file);
    return normalized in this.generatedMap.files;
  }

  /**
   * Slot 파일인지 확인
   */
  isSlotFile(file: string): boolean {
    const normalized = this.normalizePath(file);

    // slots 디렉토리 내 파일
    if (normalized.includes("/slots/") || normalized.includes("\\slots\\")) {
      return true;
    }

    // spec/slots 패턴
    if (normalized.startsWith("spec/slots/")) {
      return true;
    }

    // GeneratedMap의 slotMapping 확인
    if (this.generatedMap) {
      for (const entry of Object.values(this.generatedMap.files)) {
        if (entry.slotMapping?.slotPath === normalized) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Spec 파일인지 확인
   */
  isSpecFile(file: string): boolean {
    const normalized = this.normalizePath(file);

    // .mandu/ 디렉토리 내 생성된 매니페스트/락 파일
    if (normalized.startsWith(".mandu/") && normalized.endsWith(".json")) {
      return true;
    }

    // spec/ 디렉토리 내 JSON 파일
    if (normalized.startsWith("spec/") && normalized.endsWith(".json")) {
      return true;
    }

    // spec 로더/스키마 파일
    if (normalized.includes("spec/load") || normalized.includes("spec/schema")) {
      return true;
    }

    return false;
  }

  /**
   * 프레임워크 내부 파일인지 확인
   */
  isFrameworkFile(file: string): boolean {
    const normalized = this.normalizePath(file);

    // @mandujs/core 패키지
    if (normalized.includes("@mandujs/core")) {
      return true;
    }

    // packages/core/src 내부
    if (normalized.includes("packages/core/src")) {
      return true;
    }

    // node_modules 내부 (프레임워크 제외한 외부 라이브러리)
    if (normalized.includes("node_modules") && !normalized.includes("@mandujs")) {
      return false; // 외부 라이브러리는 프레임워크로 취급 안 함
    }

    // GeneratedMap의 frameworkPaths 확인
    if (this.generatedMap?.frameworkPaths) {
      for (const pattern of this.generatedMap.frameworkPaths) {
        if (normalized.includes(pattern)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 스택에서 "blame frame" 찾기 (첫 번째 사용자 관련 프레임)
   */
  findBlameFrame(frames: StackFrame[]): StackFrame | null {
    for (const frame of frames) {
      if (frame.isNative) continue;

      // Slot 파일 우선
      if (this.isSlotFile(frame.file)) {
        return frame;
      }

      // Spec 파일
      if (this.isSpecFile(frame.file)) {
        return frame;
      }
    }

    // Slot/Spec이 없으면 첫 번째 non-native 프레임
    for (const frame of frames) {
      if (!frame.isNative && !this.isFrameworkFile(frame.file)) {
        return frame;
      }
    }

    return null;
  }

  /**
   * Generated 파일 위치를 Slot 위치로 매핑
   */
  mapToSlotLocation(generatedFile: string, _line: number): { file: string; line: number } | null {
    if (!this.generatedMap) return null;

    const normalized = this.normalizePath(generatedFile);
    const entry = this.generatedMap.files[normalized];

    if (!entry?.slotMapping) return null;

    // Slot 파일의 시작 위치 반환 (정확한 라인 매핑은 향후 개선)
    return {
      file: entry.slotMapping.slotPath,
      line: 1,
    };
  }

  /**
   * 에러 출처 타입 결정
   */
  determineErrorSource(
    frames: StackFrame[]
  ): "slot" | "spec" | "generated" | "framework" | "unknown" {
    for (const frame of frames) {
      if (frame.isNative) continue;

      if (this.isSlotFile(frame.file)) return "slot";
      if (this.isSpecFile(frame.file)) return "spec";
      if (this.isGeneratedFile(frame.file)) return "generated";
      if (this.isFrameworkFile(frame.file)) return "framework";
    }

    return "unknown";
  }
}
