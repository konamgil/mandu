# Resource Management Workflow for AI Agents

> **AI 에이전트를 위한 리소스 관리 워크플로우 가이드**

이 문서는 AI 에이전트가 Mandu의 Resource-Centric Architecture를 효과적으로 활용하기 위한 가이드입니다.

## Overview

Mandu의 리소스 관리 시스템은 6개의 MCP 도구를 통해 스키마 기반 개발을 지원합니다:

1. **mandu.resource.create** - 새 리소스 생성
2. **mandu.resource.list** - 리소스 목록 조회
3. **mandu.resource.get** - 리소스 상세 조회
4. **mandu.resource.addField** - 필드 추가 (Slot Preservation)
5. **mandu.resource.removeField** - 필드 제거
6. **mandu_generate** - 전체 아티팩트 재생성

## Quick Start

### 1. 새 리소스 생성하기

```json
{
  "tool": "mandu.resource.create",
  "args": {
    "name": "user",
    "fields": {
      "email": {
        "type": "string",
        "required": true,
        "unique": true
      },
      "name": {
        "type": "string",
        "required": true
      },
      "age": {
        "type": "number"
      }
    },
    "timestamps": true,
    "methods": ["GET", "POST", "PUT", "DELETE"]
  }
}
```

**생성되는 파일들**:
- `spec/resources/user/schema.ts` - 스키마 정의
- `.mandu/generated/server/resources/user/` - CRUD 핸들러
- `.mandu/generated/server/resources/user/types.ts` - TypeScript 타입
- `.mandu/generated/web/resources/user/` - API 클라이언트 (선택)

### 2. 기존 리소스 목록 확인

```json
{
  "tool": "mandu.resource.list"
}
```

**응답 예시**:
```json
{
  "resources": [
    {
      "name": "user",
      "fieldCount": 5,
      "fields": ["id", "email", "name", "age", "createdAt", "updatedAt"]
    },
    {
      "name": "post",
      "fieldCount": 4,
      "fields": ["id", "title", "content", "userId", "createdAt"]
    }
  ],
  "total": 2
}
```

### 3. 리소스 상세 정보 조회

```json
{
  "tool": "mandu.resource.get",
  "args": {
    "resourceName": "user"
  }
}
```

**응답 예시**:
```json
{
  "name": "user",
  "fields": {
    "email": {
      "type": "string",
      "required": true,
      "unique": true
    },
    "name": {
      "type": "string",
      "required": true
    },
    "age": {
      "type": "number",
      "required": false
    }
  },
  "timestamps": true,
  "methods": ["GET", "POST", "PUT", "DELETE"]
}
```

## Decision Tree for AI Agents

```
사용자 요청 분석
│
├─ "새로운 엔티티 필요" → mandu.resource.create
│  ├─ 성공 → "리소스 생성 완료. API 엔드포인트가 자동 생성되었습니다."
│  └─ 실패 → 에러 메시지 확인 후 재시도
│
├─ "어떤 리소스가 있는지 확인" → mandu.resource.list
│  └─ 목록 제시 → 사용자에게 보고
│
├─ "특정 리소스 구조 확인" → mandu.resource.get
│  └─ 스키마 제시 → 필드 설명 제공
│
├─ "필드 추가 필요" → mandu.resource.addField
│  ⚠️ CRITICAL: 기존 slot 로직 보존!
│  └─ force: false로 재생성
│
├─ "필드 제거 필요" → mandu.resource.removeField
│  └─ force: false로 재생성
│
└─ "전체 재생성 필요" → mandu_generate
   └─ resources: true 옵션 사용
```

## Critical: Slot Preservation

### ⚠️ 중요 사항

**Slot 파일에는 사용자의 커스텀 비즈니스 로직이 들어있습니다!**

`mandu.resource.addField` 또는 `mandu.resource.removeField` 사용 시 **반드시**:

```typescript
// ✅ CORRECT
await generateResourceArtifacts(schema, projectRoot, {
  force: false  // 기존 slot 파일 보존!
});

// ❌ WRONG - 절대 사용 금지!
await generateResourceArtifacts(schema, projectRoot, {
  force: true   // 모든 slot 파일 덮어쓰기 → 커스텀 로직 손실!
});
```

### Slot Preservation 검증

필드 추가 후 다음을 확인하세요:

```json
{
  "tool": "mandu_generate_status"
}
```

**확인 항목**:
- `files[].hasSlot: true` → slot 파일 존재
- 생성된 파일 목록에 slot 파일이 `skipped`로 표시되어야 함

## Use Case Examples

### Use Case 1: Blog 시스템 구축

**Step 1**: Post 리소스 생성
```json
{
  "tool": "mandu.resource.create",
  "args": {
    "name": "post",
    "fields": {
      "title": { "type": "string", "required": true },
      "content": { "type": "string", "required": true },
      "published": { "type": "boolean", "default": false }
    }
  }
}
```

**Step 2**: Comment 리소스 생성
```json
{
  "tool": "mandu.resource.create",
  "args": {
    "name": "comment",
    "fields": {
      "postId": { "type": "number", "required": true },
      "content": { "type": "string", "required": true },
      "authorName": { "type": "string" }
    }
  }
}
```

**Step 3**: 전체 생성
```json
{
  "tool": "mandu_generate",
  "args": {
    "resources": true
  }
}
```

### Use Case 2: 기존 리소스에 필드 추가

**시나리오**: User 리소스에 전화번호 필드 추가

```json
{
  "tool": "mandu.resource.addField",
  "args": {
    "resourceName": "user",
    "fieldName": "phoneNumber",
    "fieldType": "string",
    "required": false,
    "unique": true
  }
}
```

**예상 결과**:
```json
{
  "success": true,
  "resourceName": "user",
  "fieldAdded": "phoneNumber",
  "filesUpdated": [
    "spec/resources/user/schema.ts",
    ".mandu/generated/server/resources/user/types.ts"
  ],
  "slotsPreserved": [
    ".mandu/generated/server/resources/user/create.slot.ts",
    ".mandu/generated/server/resources/user/update.slot.ts"
  ],
  "message": "Field 'phoneNumber' added to user resource. Slots preserved.",
  "tip": "Run mandu_generate to apply changes to all resources."
}
```

### Use Case 3: 리소스 검증

**Step 1**: 리소스 목록 확인
```json
{
  "tool": "mandu.resource.list"
}
```

**Step 2**: 특정 리소스 검증
```json
{
  "tool": "mandu.resource.get",
  "args": {
    "resourceName": "user"
  }
}
```

**Step 3**: 아키텍처 가드 실행
```json
{
  "tool": "mandu_guard_heal",
  "args": {
    "preset": "mandu"
  }
}
```

## Error Handling

### Common Errors

#### 1. 리소스가 이미 존재함

```json
{
  "error": "Resource 'user' already exists",
  "tip": "Use mandu.resource.get to view existing resource or choose a different name"
}
```

**해결**: 다른 이름 사용 또는 기존 리소스 수정

#### 2. 필드가 존재하지 않음

```json
{
  "error": "Field 'invalidField' not found in resource 'user'",
  "tip": "Use mandu.resource.get to list available fields"
}
```

**해결**: `mandu.resource.get`으로 필드 목록 확인

#### 3. 스키마 파일 손상

```json
{
  "error": "Failed to parse schema file: SyntaxError",
  "tip": "Check spec/resources/user/schema.ts for syntax errors"
}
```

**해결**: 스키마 파일 수동 수정 또는 백업에서 복구

## Best Practices for AI Agents

### 1. 항상 현재 상태 확인 먼저

```javascript
// ❌ Bad: 바로 생성 시도
mandu.resource.create({ name: "user", ... });

// ✅ Good: 기존 리소스 확인 후 생성
const list = await mandu.resource.list();
if (!list.resources.find(r => r.name === "user")) {
  await mandu.resource.create({ name: "user", ... });
}
```

### 2. 명확한 에러 메시지 전달

```javascript
// ❌ Bad
"에러가 발생했습니다."

// ✅ Good
"User 리소스 생성 실패: 이미 존재하는 리소스입니다.
대신 mandu.resource.addField를 사용하여 필드를 추가하시겠습니까?"
```

### 3. Slot 보존 항상 확인

```javascript
// addField 또는 removeField 후 반드시 확인
const status = await mandu_generate_status();
const slotsPreserved = status.files.filter(f =>
  f.kind === 'slot' && !f.overwritten
);

// 사용자에게 보고
console.log(`${slotsPreserved.length}개의 slot 파일이 보존되었습니다.`);
```

### 4. 단계별 피드백 제공

```javascript
// ✅ Good: 진행 상황 보고
"1. User 리소스 생성 중..."
"2. 스키마 파일 생성 완료: spec/resources/user/schema.ts"
"3. CRUD 핸들러 생성 중..."
"4. 완료! 5개의 API 엔드포인트가 생성되었습니다."
```

## Testing Checklist

### Before Deployment

- [ ] `mandu.resource.list` 실행하여 모든 리소스 확인
- [ ] 각 리소스에 대해 `mandu.resource.get` 실행하여 스키마 검증
- [ ] `mandu_generate_status` 실행하여 생성 파일 확인
- [ ] `mandu_guard_heal` 실행하여 아키텍처 위반 확인
- [ ] Slot 파일에 커스텀 로직이 보존되었는지 수동 확인

### After Field Changes

- [ ] `mandu_generate_status`에서 slots가 `skipped`로 표시되는지 확인
- [ ] TypeScript 컴파일 에러 없는지 확인
- [ ] API 엔드포인트 정상 동작 확인 (수동 테스트)

## Integration with Other Tools

### With mandu_negotiate

리소스 생성 전 아키텍처 협상:

```json
{
  "tool": "mandu_negotiate",
  "args": {
    "intent": "사용자 인증 시스템 추가",
    "category": "auth",
    "preset": "mandu"
  }
}
```

→ 협상 결과에 따라 `mandu.resource.create` 실행

### With mandu_guard_heal

리소스 생성 후 아키텍처 검증:

```json
{
  "tool": "mandu_guard_heal",
  "args": {
    "preset": "mandu",
    "autoFix": false
  }
}
```

→ 위반 사항 확인 후 수정

## Appendix: Tool Reference

### mandu.resource.create

**Input**:
- `name` (required): 리소스 이름 (단수형)
- `fields` (required): 필드 정의 객체
- `timestamps` (optional): 타임스탬프 자동 추가 (기본: true)
- `methods` (optional): 생성할 HTTP 메서드 (기본: GET, POST, PUT, DELETE)

**Output**:
- `success`: 성공 여부
- `resourceName`: 생성된 리소스 이름
- `createdFiles`: 생성된 파일 목록
- `message`: 결과 메시지
- `tip`: 다음 단계 제안

### mandu.resource.list

**Input**: 없음

**Output**:
- `resources`: 리소스 목록 (name, fieldCount, fields)
- `total`: 총 리소스 수

### mandu.resource.get

**Input**:
- `resourceName` (required): 조회할 리소스 이름

**Output**:
- `name`: 리소스 이름
- `fields`: 필드 정의
- `timestamps`: 타임스탬프 사용 여부
- `methods`: 사용 가능한 HTTP 메서드

### mandu.resource.addField

**Input**:
- `resourceName` (required): 수정할 리소스 이름
- `fieldName` (required): 추가할 필드 이름
- `fieldType` (required): 필드 타입
- `required` (optional): 필수 여부
- `unique` (optional): 고유 여부
- `default` (optional): 기본값

**Output**:
- `success`: 성공 여부
- `resourceName`: 리소스 이름
- `fieldAdded`: 추가된 필드 이름
- `filesUpdated`: 업데이트된 파일 목록
- `slotsPreserved`: 보존된 slot 파일 목록
- `message`: 결과 메시지

### mandu.resource.removeField

**Input**:
- `resourceName` (required): 수정할 리소스 이름
- `fieldName` (required): 제거할 필드 이름

**Output**:
- `success`: 성공 여부
- `resourceName`: 리소스 이름
- `fieldRemoved`: 제거된 필드 이름
- `filesUpdated`: 업데이트된 파일 목록
- `slotsPreserved`: 보존된 slot 파일 목록
- `message`: 결과 메시지

### mandu_generate (Enhanced)

**Input**:
- `dryRun` (optional): 미리보기 모드
- `resources` (optional): 리소스 아티팩트 포함 여부 (기본: true)

**Output**:
- `success`: 성공 여부
- `created`: 생성된 파일 목록
- `skipped`: 건너뛴 파일 목록 (slot 파일 포함)
- `errors`: 에러 목록
- `summary`: 요약 통계

---

**Last Updated**: 2026-02-15 (Phase 1 API 대기 중)

**Note**: 이 문서는 Phase 1 완료 후 실제 API 출력을 기반으로 업데이트될 예정입니다.
