---
title: Use Composition Instead of Boolean Props
impact: HIGH
impactDescription: Prevents prop explosion and improves flexibility
tags: composition, boolean, props, architecture
---

## Use Composition Instead of Boolean Props

**Impact: HIGH (Prevents prop explosion and improves flexibility)**

동작을 커스터마이즈하기 위해 boolean props를 추가하지 마세요. 대신 컴포지션을 사용하세요.

**Incorrect (boolean props 폭발):**

```tsx
// ❌ Boolean props가 계속 늘어남
function Card({
  title,
  children,
  showHeader,
  showFooter,
  showActions,
  isCompact,
  isHighlighted,
  isBordered,
  isClickable,
  isLoading,
}: CardProps) {
  return (
    <div className={cn(
      "card",
      isCompact && "card--compact",
      isHighlighted && "card--highlighted",
      isBordered && "card--bordered",
      isClickable && "card--clickable",
    )}>
      {isLoading && <Spinner />}
      {showHeader && <Header>{title}</Header>}
      {children}
      {showFooter && <Footer />}
      {showActions && <Actions />}
    </div>
  );
}

// 사용 시 복잡한 props 조합
<Card
  title="Settings"
  showHeader
  showFooter
  showActions
  isCompact
  isBordered
  isClickable={false}
  isLoading={loading}
>
  {content}
</Card>
```

**Correct (컴포지션 패턴):**

```tsx
// ✅ 기본 Card와 조합 가능한 서브컴포넌트
function Card({ children, className }: CardProps) {
  return <div className={cn("card", className)}>{children}</div>;
}

function CardHeader({ children }: { children: React.ReactNode }) {
  return <div className="card-header">{children}</div>;
}

function CardFooter({ children }: { children: React.ReactNode }) {
  return <div className="card-footer">{children}</div>;
}

function CardActions({ children }: { children: React.ReactNode }) {
  return <div className="card-actions">{children}</div>;
}

// Variants는 명시적 컴포넌트로
function CompactCard({ children }: CardProps) {
  return <Card className="card--compact">{children}</Card>;
}

function HighlightedCard({ children }: CardProps) {
  return <Card className="card--highlighted">{children}</Card>;
}

// Export
export { Card, CardHeader, CardFooter, CardActions, CompactCard, HighlightedCard };
```

**사용법:**

```tsx
// 필요한 것만 명시적으로 조합
<Card>
  <CardHeader>Settings</CardHeader>
  <SettingsContent />
  <CardFooter>
    <CardActions>
      <SaveButton />
      <CancelButton />
    </CardActions>
  </CardFooter>
</Card>

// Compact variant
<CompactCard>
  <QuickStats />
</CompactCard>
```

## Mandu Island에서의 적용

```tsx
// app/dashboard/client.tsx
"use client";

// ❌ 피해야 할 패턴
export function DashboardIsland({
  showCharts,
  showStats,
  showAlerts,
  isCompact,
}: Props) { ... }

// ✅ 권장 패턴
export const Dashboard = {
  Provider: DashboardProvider,
  Charts: DashboardCharts,
  Stats: DashboardStats,
  Alerts: DashboardAlerts,
  CompactLayout: DashboardCompactLayout,
};
```

## 언제 Boolean Props가 괜찮은가?

- 단일 시각적 상태 (disabled, loading)
- 토글 가능한 단일 기능 (checked, open)
- 컴포지션이 과도한 경우의 간단한 변형

Reference: [Avoid Boolean Props](https://spicefactory.co/blog/2019/03/26/how-to-avoid-the-boolean-trap-when-designing-react-components/)
