---
title: Use Visible Priority for Below-Fold Content
impact: MEDIUM
impactDescription: Optimizes initial page load
tags: hydration, priority, performance
---

## Use Visible Priority for Below-Fold Content

Set hydration priority based on when the component needs to be interactive.

## Hydration Priorities

| Priority | Load Time | Use Case |
|----------|-----------|----------|
| `immediate` | Page load | Critical interactions (header nav, auth forms) |
| `visible` | Viewport entry (default) | Below-fold content |
| `idle` | Browser idle | Non-critical features (analytics widgets) |
| `interaction` | User action | Click-to-activate components |

## Examples

### Immediate: Always-visible interactions

```tsx
// Header with navigation - needs to work immediately
<Island priority="immediate">
  <HeaderNav />
</Island>
```

### Visible: Below-fold content (default)

```tsx
// Comments section - load when scrolled into view
<Island priority="visible">
  <CommentsSection postId={postId} />
</Island>
```

### Idle: Background features

```tsx
// Chat widget - can wait until browser is idle
<Island priority="idle">
  <ChatWidget />
</Island>
```

### Interaction: On-demand activation

```tsx
// Video player - only hydrate when user clicks play
<Island priority="interaction">
  <VideoPlayer videoId={videoId} />
</Island>
```

## Performance Impact

```
immediate: +JavaScript bundle at page load
visible:   +JavaScript when component enters viewport
idle:      +JavaScript during browser idle time
interaction: +JavaScript on first user interaction
```

**Rule of thumb**: Use `visible` (default) unless you have a specific reason to choose another priority.
