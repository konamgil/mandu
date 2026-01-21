import { RoutesManifest, type RoutesManifest as RoutesManifestType } from "./schema";
import { ZodError } from "zod";

export interface LoadResult {
  success: boolean;
  data?: RoutesManifestType;
  errors?: string[];
}

export function formatZodError(error: ZodError): string[] {
  return error.errors.map((e) => {
    const path = e.path.length > 0 ? `[${e.path.join(".")}] ` : "";
    return `${path}${e.message}`;
  });
}

export async function loadManifest(filePath: string): Promise<LoadResult> {
  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (!exists) {
      return {
        success: false,
        errors: [`파일을 찾을 수 없습니다: ${filePath}`],
      };
    }

    const content = await file.text();
    let json: unknown;

    try {
      json = JSON.parse(content);
    } catch {
      return {
        success: false,
        errors: ["JSON 파싱 실패: 올바른 JSON 형식이 아닙니다"],
      };
    }

    const result = RoutesManifest.safeParse(json);

    if (!result.success) {
      return {
        success: false,
        errors: formatZodError(result.error),
      };
    }

    return {
      success: true,
      data: result.data,
    };
  } catch (error) {
    return {
      success: false,
      errors: [`예상치 못한 오류: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

export function validateManifest(data: unknown): LoadResult {
  const result = RoutesManifest.safeParse(data);

  if (!result.success) {
    return {
      success: false,
      errors: formatZodError(result.error),
    };
  }

  return {
    success: true,
    data: result.data,
  };
}
