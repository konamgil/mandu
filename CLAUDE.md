# Mandu Project Guide

## Overview

Mandu는 **Bun** 기반의 모던 풀스택 프레임워크입니다.

## Package Manager

- **Bun** 사용 (`bun install`, `bun run`, `bun test`)
- pnpm/npm 아님

## Project Structure

```
packages/
├── core/       # @mandujs/core - 핵심 프레임워크
├── cli/        # @mandujs/cli - CLI 도구
└── mcp/        # @mandujs/mcp - MCP 서버
demo/           # 데모 앱들
```

## License

- **MPL-2.0** (Mozilla Public License 2.0) 전체 적용
- 수정한 파일은 공개 필수, import해서 만든 앱은 자유

## 배포 (Release)

이 프로젝트는 **Changesets**를 사용합니다.

### 변경사항 기록

```bash
bun changeset
# → 변경된 패키지 선택
# → major/minor/patch 선택
# → 변경 내용 설명
```

### 버전 업데이트 & 배포

```bash
bun run version   # 버전 업데이트 + CHANGELOG 생성
bun run publish   # npm 배포
# 또는
bun run release   # 위 두 명령을 한번에
```

### 주의사항

- `workspace:*` 의존성은 `bun run version` 시 실제 버전으로 자동 변환됨
- demo/* 패키지는 배포 대상에서 제외됨 (.changeset/config.json)

## Scripts

| 명령어 | 설명 |
|--------|------|
| `bun test` | 테스트 실행 |
| `bun run mandu` | CLI 실행 |
| `bun changeset` | 변경사항 기록 |
| `bun run version` | 버전 업데이트 |
| `bun run publish` | npm 배포 |
| `bun run release` | version + publish |
