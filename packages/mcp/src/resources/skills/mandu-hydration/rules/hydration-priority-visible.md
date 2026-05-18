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

Inline client regions live in `*.partial.tsx` files and use
`partial({ id, component, priority })`, then render the returned `.Render`
component from the server page. The page must export a non-`none` hydration
config.

### Immediate: Always-visible interactions

```tsx
// Header with navigation - needs to work immediately
import { partial } from "@mandujs/core/client";

const HeaderNavPartial = partial({
  id: "HeaderNav",
  component: HeaderNav,
  priority: "immediate",
});

<HeaderNavPartial.Render />
```

### Visible: Below-fold content (default)

```tsx
// Comments section - load when scrolled into view
const CommentsPartial = partial({
  id: "Comments",
  component: CommentsSection,
  priority: "visible",
});

<CommentsPartial.Render postId={postId} />
```

### Idle: Background features

```tsx
// Chat widget - can wait until browser is idle
const ChatPartial = partial({
  id: "Chat",
  component: ChatWidget,
  priority: "idle",
});

<ChatPartial.Render />
```

### Interaction: On-demand activation

```tsx
// Video player - only hydrate when user clicks play
const VideoPartial = partial({
  id: "Video",
  component: VideoPlayer,
  priority: "interaction",
});

<VideoPartial.Render videoId={videoId} />
```

## Performance Impact

```
immediate: +JavaScript bundle at page load
visible:   +JavaScript when component enters viewport
idle:      +JavaScript during browser idle time
interaction: +JavaScript on first user interaction
```

**Rule of thumb**: Use `visible` (default) unless you have a specific reason to choose another priority.
