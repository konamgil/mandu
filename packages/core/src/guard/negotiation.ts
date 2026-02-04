/**
 * Architecture Negotiation - 아키텍처 협상 시스템
 *
 * AI가 기능 구현 전에 프레임워크와 "협상"하여 최적의 구조를 받아옴
 *
 * @module guard/negotiation
 *
 * @example
 * ```typescript
 * import { negotiate, generateScaffold } from "@mandujs/core/guard";
 *
 * const plan = await negotiate({
 *   intent: "사용자 인증 기능 추가",
 *   requirements: ["JWT 기반", "리프레시 토큰"],
 *   constraints: ["기존 User 모델 활용"],
 * }, projectRoot);
 *
 * if (plan.approved) {
 *   await generateScaffold(plan.structure, projectRoot);
 * }
 * ```
 */

import { join, dirname } from "path";
import { mkdir, writeFile, readdir, stat } from "fs/promises";
import { searchDecisions, type ArchitectureDecision } from "./decision-memory";
import { getPreset, type GuardPreset, type PresetDefinition } from "./presets";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 협상 요청
 */
export interface NegotiationRequest {
  /** 구현하려는 기능의 의도 */
  intent: string;

  /** 요구사항 목록 */
  requirements?: string[];

  /** 제약 조건 */
  constraints?: string[];

  /** 사용할 프리셋 (미지정 시 프로젝트 설정 사용) */
  preset?: GuardPreset;

  /** 기능 카테고리 (자동 감지 시도) */
  category?: FeatureCategory;

  /** 추가 컨텍스트 */
  context?: string;
}

/**
 * 기능 카테고리
 */
export type FeatureCategory =
  | "auth"         // 인증/인가
  | "crud"         // CRUD 작업
  | "api"          // API 엔드포인트
  | "ui"           // UI 컴포넌트
  | "integration"  // 외부 서비스 연동
  | "data"         // 데이터 처리
  | "util"         // 유틸리티
  | "config"       // 설정
  | "other";       // 기타

/**
 * 디렉토리 구조 제안
 */
export interface DirectoryProposal {
  /** 디렉토리 경로 */
  path: string;

  /** 목적 설명 */
  purpose: string;

  /** 생성할 파일들 */
  files: FileProposal[];

  /** 레이어 (FSD/Clean 등) */
  layer?: string;
}

/**
 * 파일 제안
 */
export interface FileProposal {
  /** 파일명 */
  name: string;

  /** 목적 */
  purpose: string;

  /** 템플릿 타입 */
  template?: FileTemplate;

  /** 슬롯 여부 */
  isSlot?: boolean;

  /** 권장 제약 조건 */
  suggestedConstraints?: string[];
}

/**
 * 파일 템플릿 타입
 */
export type FileTemplate =
  | "service"
  | "repository"
  | "usecase"
  | "controller"
  | "route"
  | "component"
  | "hook"
  | "util"
  | "type"
  | "test"
  | "slot";

/**
 * 협상 응답
 */
export interface NegotiationResponse {
  /** 승인 여부 */
  approved: boolean;

  /** 승인 거부 사유 (approved=false일 때) */
  rejectionReason?: string;

  /** 제안된 구조 */
  structure: DirectoryProposal[];

  /** 생성할 슬롯 목록 */
  slots: SlotProposal[];

  /** 경고 사항 */
  warnings: string[];

  /** 권장 사항 */
  recommendations: string[];

  /** 관련 기존 결정 */
  relatedDecisions: RelatedDecision[];

  /** 예상 파일 수 */
  estimatedFiles: number;

  /** 사용된 프리셋 */
  preset: GuardPreset;

  /** 다음 단계 안내 */
  nextSteps: string[];
}

/**
 * 슬롯 제안
 */
export interface SlotProposal {
  /** 슬롯 경로 */
  path: string;

  /** 목적 */
  purpose: string;

  /** 권장 제약 조건 */
  constraints?: string[];

  /** 필요한 import */
  suggestedImports?: string[];
}

/**
 * 관련 결정 요약
 */
export interface RelatedDecision {
  /** 결정 ID */
  id: string;

  /** 제목 */
  title: string;

  /** 핵심 내용 요약 */
  summary: string;

  /** 관련성 설명 */
  relevance: string;
}

/**
 * Scaffold 생성 결과
 */
export interface ScaffoldResult {
  /** 성공 여부 */
  success: boolean;

  /** 생성된 디렉토리 */
  createdDirs: string[];

  /** 생성된 파일 */
  createdFiles: string[];

  /** 건너뛴 파일 (이미 존재) */
  skippedFiles: string[];

  /** 에러 메시지 */
  errors: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Category Detection
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 키워드 기반 카테고리 매핑
 */
const CATEGORY_KEYWORDS: Record<FeatureCategory, string[]> = {
  auth: ["인증", "로그인", "로그아웃", "회원가입", "비밀번호", "토큰", "jwt", "oauth", "session", "auth", "login", "signup", "password"],
  crud: ["생성", "조회", "수정", "삭제", "목록", "create", "read", "update", "delete", "list", "crud"],
  api: ["api", "엔드포인트", "endpoint", "rest", "graphql", "route"],
  ui: ["컴포넌트", "페이지", "화면", "폼", "버튼", "component", "page", "form", "button", "modal", "ui"],
  integration: ["연동", "통합", "외부", "third-party", "integration", "webhook", "stripe", "payment", "email", "sms"],
  data: ["데이터", "처리", "변환", "마이그레이션", "data", "transform", "migration", "import", "export"],
  util: ["유틸", "헬퍼", "공통", "util", "helper", "common", "shared"],
  config: ["설정", "환경", "config", "env", "setting"],
  other: [],
};

/**
 * 의도에서 카테고리 자동 감지
 */
export function detectCategory(intent: string): FeatureCategory {
  const normalizedIntent = intent.toLowerCase();

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (category === "other") continue;
    if (keywords.some((kw) => normalizedIntent.includes(kw))) {
      return category as FeatureCategory;
    }
  }

  return "other";
}

// ═══════════════════════════════════════════════════════════════════════════
// Structure Templates
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 카테고리별 구조 템플릿 (FSD + Clean 조합)
 */
const STRUCTURE_TEMPLATES: Record<FeatureCategory, (featureName: string) => DirectoryProposal[]> = {
  auth: (name) => [
    {
      path: `server/domain/${name}`,
      purpose: `${name} 도메인 로직`,
      layer: "domain",
      files: [
        { name: `${name}.service.ts`, purpose: "핵심 비즈니스 로직", template: "service" },
        { name: `${name}.types.ts`, purpose: "타입 정의", template: "type" },
      ],
    },
    {
      path: `server/application/${name}`,
      purpose: `${name} 유스케이스`,
      layer: "application",
      files: [
        { name: `login.usecase.ts`, purpose: "로그인 유스케이스", template: "usecase" },
        { name: `logout.usecase.ts`, purpose: "로그아웃 유스케이스", template: "usecase" },
        { name: `refresh.usecase.ts`, purpose: "토큰 갱신 유스케이스", template: "usecase" },
      ],
    },
    {
      path: `server/infra/${name}`,
      purpose: `${name} 인프라 어댑터`,
      layer: "infrastructure",
      files: [
        { name: `token.provider.ts`, purpose: "토큰 생성/검증", template: "service" },
        { name: `session.repository.ts`, purpose: "세션 저장소", template: "repository" },
      ],
    },
    {
      path: `app/api/${name}`,
      purpose: `${name} API 라우트`,
      layer: "api",
      files: [
        { name: `login/route.ts`, purpose: "로그인 API", template: "route", isSlot: true },
        { name: `logout/route.ts`, purpose: "로그아웃 API", template: "route", isSlot: true },
        { name: `refresh/route.ts`, purpose: "토큰 갱신 API", template: "route", isSlot: true },
      ],
    },
  ],

  crud: (name) => [
    {
      path: `server/domain/${name}`,
      purpose: `${name} 도메인`,
      layer: "domain",
      files: [
        { name: `${name}.service.ts`, purpose: "CRUD 비즈니스 로직", template: "service" },
        { name: `${name}.repository.ts`, purpose: "데이터 접근", template: "repository" },
        { name: `${name}.types.ts`, purpose: "타입 정의", template: "type" },
      ],
    },
    {
      path: `app/api/${name}`,
      purpose: `${name} API`,
      layer: "api",
      files: [
        { name: `route.ts`, purpose: "목록/생성 API (GET, POST)", template: "route", isSlot: true },
        { name: `[id]/route.ts`, purpose: "상세/수정/삭제 API (GET, PUT, DELETE)", template: "route", isSlot: true },
      ],
    },
  ],

  api: (name) => [
    {
      path: `server/domain/${name}`,
      purpose: `${name} 도메인 로직`,
      layer: "domain",
      files: [
        { name: `${name}.service.ts`, purpose: "비즈니스 로직", template: "service" },
        { name: `${name}.types.ts`, purpose: "타입 정의", template: "type" },
      ],
    },
    {
      path: `app/api/${name}`,
      purpose: `${name} API 엔드포인트`,
      layer: "api",
      files: [
        { name: `route.ts`, purpose: "API 핸들러", template: "route", isSlot: true },
      ],
    },
  ],

  ui: (name) => [
    {
      path: `client/widgets/${name}`,
      purpose: `${name} 위젯`,
      layer: "widgets",
      files: [
        { name: `${name}.tsx`, purpose: "메인 컴포넌트", template: "component" },
        { name: `${name}.styles.ts`, purpose: "스타일", template: "util" },
        { name: `index.ts`, purpose: "Public API", template: "util" },
      ],
    },
    {
      path: `client/features/${name}`,
      purpose: `${name} 기능 로직`,
      layer: "features",
      files: [
        { name: `model/store.ts`, purpose: "상태 관리", template: "service" },
        { name: `model/types.ts`, purpose: "타입 정의", template: "type" },
        { name: `api/${name}.api.ts`, purpose: "API 호출", template: "service" },
      ],
    },
  ],

  integration: (name) => [
    {
      path: `server/infra/${name}`,
      purpose: `${name} 외부 서비스 어댑터`,
      layer: "infrastructure",
      files: [
        { name: `${name}.client.ts`, purpose: "외부 API 클라이언트", template: "service" },
        { name: `${name}.types.ts`, purpose: "타입 정의", template: "type" },
        { name: `${name}.config.ts`, purpose: "설정", template: "util" },
      ],
    },
    {
      path: `server/domain/${name}`,
      purpose: `${name} 도메인 인터페이스`,
      layer: "domain",
      files: [
        { name: `${name}.port.ts`, purpose: "포트 인터페이스", template: "type" },
      ],
    },
    {
      path: `app/api/webhooks/${name}`,
      purpose: `${name} 웹훅`,
      layer: "api",
      files: [
        { name: `route.ts`, purpose: "웹훅 핸들러", template: "route", isSlot: true },
      ],
    },
  ],

  data: (name) => [
    {
      path: `server/domain/${name}`,
      purpose: `${name} 데이터 처리`,
      layer: "domain",
      files: [
        { name: `${name}.processor.ts`, purpose: "데이터 처리 로직", template: "service" },
        { name: `${name}.transformer.ts`, purpose: "데이터 변환", template: "util" },
        { name: `${name}.types.ts`, purpose: "타입 정의", template: "type" },
      ],
    },
  ],

  util: (name) => [
    {
      path: `shared/utils/${name}`,
      purpose: `${name} 유틸리티`,
      layer: "shared",
      files: [
        { name: `${name}.ts`, purpose: "유틸리티 함수", template: "util" },
        { name: `${name}.test.ts`, purpose: "테스트", template: "test" },
        { name: `index.ts`, purpose: "Public API", template: "util" },
      ],
    },
  ],

  config: (name) => [
    {
      path: `shared/config`,
      purpose: "설정 관리",
      layer: "shared",
      files: [
        { name: `${name}.config.ts`, purpose: `${name} 설정`, template: "util" },
        { name: `${name}.schema.ts`, purpose: "설정 스키마 (Zod)", template: "type" },
      ],
    },
  ],

  other: (name) => [
    {
      path: `server/domain/${name}`,
      purpose: `${name} 도메인`,
      layer: "domain",
      files: [
        { name: `${name}.service.ts`, purpose: "비즈니스 로직", template: "service" },
        { name: `${name}.types.ts`, purpose: "타입 정의", template: "type" },
      ],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// File Templates
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 파일 템플릿 생성
 */
function generateFileContent(template: FileTemplate, name: string, purpose: string): string {
  switch (template) {
    case "service":
      return `/**
 * ${purpose}
 */

export class ${toPascalCase(name)}Service {
  // TODO: Implement service methods
}

export const ${toCamelCase(name)}Service = new ${toPascalCase(name)}Service();
`;

    case "repository":
      return `/**
 * ${purpose}
 */

export interface ${toPascalCase(name)}Repository {
  // TODO: Define repository interface
}

export class ${toPascalCase(name)}RepositoryImpl implements ${toPascalCase(name)}Repository {
  // TODO: Implement repository methods
}
`;

    case "usecase":
      return `/**
 * ${purpose}
 */

export interface ${toPascalCase(name)}Input {
  // TODO: Define input
}

export interface ${toPascalCase(name)}Output {
  // TODO: Define output
}

export async function ${toCamelCase(name)}(input: ${toPascalCase(name)}Input): Promise<${toPascalCase(name)}Output> {
  // TODO: Implement usecase
  throw new Error("Not implemented");
}
`;

    case "route":
    case "slot":
      return `/**
 * ${purpose}
 *
 * @slot
 */

import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .purpose("${purpose}")
  .constraints({
    maxLines: 50,
    requiredPatterns: ["input-validation", "error-handling"],
  })
  .get(async (ctx) => {
    // TODO: Implement handler
    return ctx.json({ message: "Not implemented" }, 501);
  });
`;

    case "component":
      return `/**
 * ${purpose}
 */

export interface ${toPascalCase(name)}Props {
  // TODO: Define props
}

export function ${toPascalCase(name)}({ ...props }: ${toPascalCase(name)}Props) {
  return (
    <div>
      {/* TODO: Implement component */}
    </div>
  );
}
`;

    case "type":
      return `/**
 * ${purpose}
 */

export interface ${toPascalCase(name)} {
  // TODO: Define type
}

export type ${toPascalCase(name)}Id = string;
`;

    case "test":
      return `/**
 * ${purpose}
 */

import { describe, it, expect } from "bun:test";

describe("${name}", () => {
  it("should work", () => {
    // TODO: Add tests
    expect(true).toBe(true);
  });
});
`;

    case "util":
    default:
      return `/**
 * ${purpose}
 */

// TODO: Implement utility functions
`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

function toPascalCase(str: string): string {
  return str
    .replace(/[-_](.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (_, c) => c.toUpperCase());
}

function toCamelCase(str: string): string {
  return str
    .replace(/[-_](.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (_, c) => c.toLowerCase());
}

function extractFeatureName(intent: string): string {
  // 한글/영문에서 핵심 명사 추출 시도
  const patterns = [
    /(?:추가|구현|만들)(?:어|해)[줘요]?\s*[:\-]?\s*(.+)/,
    /(.+?)\s*(?:기능|시스템|모듈)/,
    /(?:add|implement|create)\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = intent.match(pattern);
    if (match) {
      return match[1]
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
    }
  }

  // 기본값: 첫 단어
  return intent
    .split(/\s+/)[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") || "feature";
}

/**
 * 프리셋에 따라 구조를 조정
 * FSD, Clean, Hexagonal 등 프리셋별 레이어 매핑 적용
 */
function adjustStructureForPreset(
  structure: DirectoryProposal[],
  presetDef: PresetDefinition,
  preset: GuardPreset
): DirectoryProposal[] {
  // 프리셋별 경로 매핑
  const pathMappings: Record<GuardPreset, Record<string, string>> = {
    fsd: {
      "server/domain": "src/entities",
      "server/application": "src/features",
      "server/infra": "src/shared/api",
      "client/widgets": "src/widgets",
      "client/features": "src/features",
      "shared": "src/shared",
      "app/api": "src/app/api",
    },
    clean: {
      "server/domain": "src/domain",
      "server/application": "src/application",
      "server/infra": "src/infrastructure",
      "client/widgets": "src/presentation/components",
      "client/features": "src/presentation/features",
      "shared": "src/shared",
      "app/api": "src/interfaces/http",
    },
    hexagonal: {
      "server/domain": "src/domain",
      "server/application": "src/application",
      "server/infra": "src/adapters",
      "client/widgets": "src/adapters/primary/ui",
      "client/features": "src/adapters/primary/ui",
      "shared": "src/shared",
      "app/api": "src/adapters/primary/api",
    },
    atomic: {
      "server/domain": "src/services",
      "server/application": "src/hooks",
      "server/infra": "src/api",
      "client/widgets": "src/components/organisms",
      "client/features": "src/components/templates",
      "shared": "src/utils",
      "app/api": "src/api",
    },
    mandu: {}, // 기본값, 매핑 불필요
  };

  const mapping = pathMappings[preset] || {};
  if (Object.keys(mapping).length === 0) {
    return structure;
  }

  return structure.map((dir) => {
    // 경로 매핑 적용
    let newPath = dir.path;
    for (const [from, to] of Object.entries(mapping)) {
      if (dir.path.startsWith(from)) {
        newPath = dir.path.replace(from, to);
        break;
      }
    }

    return {
      ...dir,
      path: newPath,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Core Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 아키텍처 협상 수행
 */
export async function negotiate(
  request: NegotiationRequest,
  rootDir: string
): Promise<NegotiationResponse> {
  const {
    intent,
    requirements = [],
    constraints = [],
    preset = "mandu",
    context,
  } = request;

  // 1. 카테고리 감지
  const category = request.category || detectCategory(intent);

  // 2. 기능 이름 추출
  const featureName = extractFeatureName(intent);

  // 3. 관련 결정 검색
  const categoryTags = CATEGORY_KEYWORDS[category] || [];
  const searchTags = [...categoryTags.slice(0, 3), featureName];
  const decisionsResult = await searchDecisions(rootDir, searchTags);

  // 4. 프리셋 정의 로드 및 구조 템플릿 선택
  const presetDef = getPreset(preset);
  const templateFn = STRUCTURE_TEMPLATES[category] || STRUCTURE_TEMPLATES.other;
  let structure = templateFn(featureName);

  // 5. 프리셋에 따른 구조 조정
  if (presetDef && preset !== "mandu") {
    structure = adjustStructureForPreset(structure, presetDef, preset);
  }

  // 6. 슬롯 추출
  const slots: SlotProposal[] = structure
    .flatMap((dir) => dir.files)
    .filter((file) => file.isSlot)
    .map((file) => ({
      path: file.name,
      purpose: file.purpose,
      constraints: file.suggestedConstraints || ["input-validation", "error-handling"],
    }));

  // 7. 경고 및 권장사항 생성
  const warnings: string[] = [];
  const recommendations: string[] = [];

  // 기존 결정과 충돌 확인
  for (const decision of decisionsResult.decisions) {
    if (decision.status === "deprecated") {
      warnings.push(`⚠️ Related decision ${decision.id} is deprecated: ${decision.title}`);
    }
    if (decision.status === "accepted") {
      recommendations.push(`📋 Follow ${decision.id}: ${decision.decision.slice(0, 100)}...`);
    }
  }

  // 제약 조건 기반 권장사항
  if (constraints.length > 0) {
    recommendations.push(`Ensure compatibility with: ${constraints.join(", ")}`);
  }

  // 8. 다음 단계 안내
  const nextSteps = [
    `1. Review the proposed structure below`,
    `2. Run \`mandu_generate_scaffold\` to create files`,
    `3. Implement the TODO sections in each file`,
    `4. Run \`mandu_guard_heal\` to verify architecture compliance`,
  ];

  // 9. 파일 수 계산
  const estimatedFiles = structure.reduce((sum, dir) => sum + dir.files.length, 0);

  // 10. 관련 결정 포맷
  const relatedDecisions: RelatedDecision[] = decisionsResult.decisions.map((d) => ({
    id: d.id,
    title: d.title,
    summary: d.decision.slice(0, 150),
    relevance: `Related to ${category} implementation`,
  }));

  return {
    approved: true,
    structure,
    slots,
    warnings,
    recommendations,
    relatedDecisions,
    estimatedFiles,
    preset,
    nextSteps,
  };
}

/**
 * Scaffold 생성 (병렬 처리 최적화)
 */
export async function generateScaffold(
  structure: DirectoryProposal[],
  rootDir: string,
  options: { overwrite?: boolean; dryRun?: boolean } = {}
): Promise<ScaffoldResult> {
  const { overwrite = false, dryRun = false } = options;

  const createdDirs: string[] = [];
  const createdFiles: string[] = [];
  const skippedFiles: string[] = [];
  const errors: string[] = [];

  // 1단계: 모든 디렉토리 먼저 생성 (병렬)
  const dirPaths = new Set<string>();
  for (const dir of structure) {
    dirPaths.add(join(rootDir, dir.path));
    // nested file 경로의 부모 디렉토리도 추가
    for (const file of dir.files) {
      dirPaths.add(dirname(join(rootDir, dir.path, file.name)));
    }
  }

  if (!dryRun) {
    const dirResults = await Promise.allSettled(
      Array.from(dirPaths).map(async (dirPath) => {
        await mkdir(dirPath, { recursive: true });
        return dirPath;
      })
    );

    for (const result of dirResults) {
      if (result.status === "fulfilled") {
        const relativePath = result.value.replace(rootDir, "").replace(/^[/\\]/, "");
        if (relativePath) createdDirs.push(relativePath);
      } else {
        errors.push(`Failed to create directory: ${result.reason}`);
      }
    }
  } else {
    structure.forEach((dir) => createdDirs.push(dir.path));
  }

  // 2단계: 모든 파일 정보 수집 및 병렬 처리
  interface FileTask {
    filePath: string;
    relativePath: string;
    content: string;
  }

  const fileTasks: FileTask[] = [];

  for (const dir of structure) {
    const dirPath = join(rootDir, dir.path);

    for (const file of dir.files) {
      const filePath = join(dirPath, file.name);
      const relativePath = join(dir.path, file.name);
      const content = generateFileContent(
        file.template || "util",
        file.name.replace(/\.\w+$/, ""),
        file.purpose
      );

      fileTasks.push({ filePath, relativePath, content });
    }
  }

  // 3단계: 파일 존재 여부 확인 (병렬)
  const existsResults = await Promise.allSettled(
    fileTasks.map(async (task) => {
      try {
        await stat(task.filePath);
        return { ...task, exists: true };
      } catch {
        return { ...task, exists: false };
      }
    })
  );

  // 4단계: 파일 쓰기 (병렬)
  const writePromises: Promise<void>[] = [];

  for (const result of existsResults) {
    if (result.status !== "fulfilled") continue;
    const { filePath, relativePath, content, exists } = result.value;

    if (exists && !overwrite) {
      skippedFiles.push(relativePath);
      continue;
    }

    if (dryRun) {
      createdFiles.push(relativePath);
    } else {
      writePromises.push(
        writeFile(filePath, content, "utf-8")
          .then(() => {
            createdFiles.push(relativePath);
          })
          .catch((error) => {
            errors.push(`Failed to create file ${relativePath}: ${error}`);
          })
      );
    }
  }

  // 모든 쓰기 작업 완료 대기
  await Promise.allSettled(writePromises);

  return {
    success: errors.length === 0,
    createdDirs,
    createdFiles,
    skippedFiles,
    errors,
  };
}

/**
 * 기존 프로젝트 구조 분석
 */
export async function analyzeExistingStructure(
  rootDir: string
): Promise<{
  layers: string[];
  existingFeatures: string[];
  recommendations: string[];
}> {
  const layers: string[] = [];
  const existingFeatures: string[] = [];
  const recommendations: string[] = [];

  // 일반적인 레이어 디렉토리 확인
  const commonLayers = [
    "server/domain",
    "server/application",
    "server/infra",
    "client/features",
    "client/widgets",
    "client/shared",
    "shared",
    "app/api",
  ];

  for (const layer of commonLayers) {
    try {
      const layerPath = join(rootDir, layer);
      const stats = await stat(layerPath);
      if (stats.isDirectory()) {
        layers.push(layer);

        // 하위 디렉토리 (feature) 목록
        const entries = await readdir(layerPath);
        for (const entry of entries) {
          const entryPath = join(layerPath, entry);
          const entryStats = await stat(entryPath);
          if (entryStats.isDirectory()) {
            existingFeatures.push(`${layer}/${entry}`);
          }
        }
      }
    } catch {
      // 레이어 없음
    }
  }

  // 권장사항 생성
  if (layers.length === 0) {
    recommendations.push("No standard layers found. Consider using Mandu preset structure.");
  }

  if (!layers.includes("server/domain")) {
    recommendations.push("Missing server/domain layer for business logic isolation.");
  }

  if (!layers.includes("shared")) {
    recommendations.push("Consider adding shared/ for cross-cutting utilities.");
  }

  return {
    layers,
    existingFeatures,
    recommendations,
  };
}
