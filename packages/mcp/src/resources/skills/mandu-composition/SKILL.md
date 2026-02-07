---
name: mandu-composition
description: |
  React composition patterns for Mandu applications. Use when designing
  Island components, managing shared state, or building reusable component
  APIs. Triggers on compound components, context providers, boolean props,
  or component architecture tasks.
license: MIT
metadata:
  author: mandu
  version: "1.0.0"
---

# Mandu Composition

Mandu 애플리케이션을 위한 React 컴포지션 패턴 가이드. Island 컴파운드 컴포넌트, 상태 관리 인터페이스, Provider 패턴, slot-client 분리를 다룹니다. Vercel의 Composition Patterns를 Mandu 컨텍스트로 변환하여 적용합니다.

## When to Apply

Reference these guidelines when:
- Designing Island component architecture
- Managing shared state between Islands
- Building reusable component APIs
- Refactoring components with boolean prop proliferation
- Working with compound components or context providers

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Component Architecture | HIGH | `comp-arch-` |
| 2 | State Management | HIGH | `comp-state-` |
| 3 | Island Patterns | MEDIUM | `comp-island-` |
| 4 | Implementation Patterns | MEDIUM | `comp-pattern-` |

## Quick Reference

### 1. Component Architecture (HIGH)

- `comp-arch-avoid-boolean-props` - Use composition instead of boolean customization
- `comp-arch-compound-components` - Structure Islands as compound components
- `comp-arch-explicit-variants` - Create explicit variant components

### 2. State Management (HIGH)

- `comp-state-context-interface` - Define generic state/actions/meta interface
- `comp-state-lift-state` - Move state into provider for sibling access
- `comp-state-decouple-impl` - Provider is the only place knowing implementation

### 3. Island Patterns (MEDIUM)

- `comp-island-compound` - Compose Islands with shared context
- `comp-island-event` - Communicate between Islands with useIslandEvent
- `comp-island-slot-split` - Separate server logic (slot) from client (Island)

### 4. Implementation Patterns (MEDIUM)

- `comp-pattern-children` - Use children for composition over render props
- `comp-pattern-provider-boundary` - Understand provider boundary vs visual nesting

## Core Principle

**Lift state, compose internals, make state dependency-injectable.**

```
┌─────────────────────────────────────────┐
│  Provider (state + actions + meta)      │
│  ┌───────────────────────────────────┐  │
│  │  Composer.Frame                   │  │
│  │  ┌─────────┐ ┌─────────────────┐  │  │
│  │  │ Input   │ │ Footer          │  │  │
│  │  └─────────┘ │ ┌─────┐ ┌─────┐ │  │  │
│  │              │ │Emoji│ │Send │ │  │  │
│  │              │ └─────┘ └─────┘ │  │  │
│  │              └─────────────────┘  │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────┐  ← Outside Frame     │
│  │ Preview       │     but inside       │
│  └───────────────┘     Provider!        │
└─────────────────────────────────────────┘
```

## How to Use

Read individual rule files for detailed explanations:

```
rules/comp-arch-compound-components.md
rules/comp-state-context-interface.md
rules/comp-island-event.md
```
