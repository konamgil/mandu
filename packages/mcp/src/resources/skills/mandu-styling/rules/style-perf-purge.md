---
title: CSS Purge and Tree Shaking
impact: MEDIUM
impactDescription: Removes unused CSS for smaller bundles
tags: styling, performance, purge, tree-shaking
---

## CSS Purge and Tree Shaking

**Impact: MEDIUM (Removes unused CSS for smaller bundles)**

미사용 CSS를 제거하여 번들 크기를 최소화하세요.

## Tailwind 자동 Purge

Tailwind v3+는 JIT 컴파일로 사용된 클래스만 생성합니다.

```typescript
// tailwind.config.ts
export default {
  // content 경로가 정확해야 함
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  // ...
};
```

## Safelist 관리

```typescript
// tailwind.config.ts
export default {
  content: ["./app/**/*.{ts,tsx}"],

  // 동적으로 생성되는 클래스는 safelist에 추가
  safelist: [
    // 정적 패턴
    "bg-red-500",
    "bg-green-500",
    "bg-blue-500",

    // 정규식 패턴
    {
      pattern: /bg-(red|green|blue)-(100|500|900)/,
    },

    // 변형 포함
    {
      pattern: /text-(red|green|blue)-500/,
      variants: ["hover", "dark"],
    },
  ],
};
```

## 동적 클래스 문제 방지

```tsx
// ❌ Tailwind가 감지 못함
const color = "blue";
<div className={`bg-${color}-500`} />

// ✅ 전체 클래스명 사용
const colorClasses = {
  blue: "bg-blue-500",
  red: "bg-red-500",
  green: "bg-green-500",
};
<div className={colorClasses[color]} />

// ✅ cva 사용
const badge = cva("px-2 py-1 rounded", {
  variants: {
    color: {
      blue: "bg-blue-500",
      red: "bg-red-500",
      green: "bg-green-500",
    },
  },
});
```

## PurgeCSS 수동 설정

Tailwind 외 CSS 파일용:

```bash
bun add -d purgecss
```

```javascript
// purgecss.config.js
export default {
  content: ["./app/**/*.tsx", "./components/**/*.tsx"],
  css: ["./styles/legacy.css"],
  output: "./dist/styles/",

  // 유지할 선택자
  safelist: {
    standard: [/^data-/],
    deep: [/^modal/],
    greedy: [/tooltip/],
  },

  // 커스텀 추출기
  extractors: [
    {
      extractor: (content) => content.match(/[\w-/:]+(?<!:)/g) || [],
      extensions: ["tsx", "ts"],
    },
  ],
};
```

```bash
bunx purgecss --config purgecss.config.js
```

## CSS Modules 최적화

CSS Modules는 자동으로 스코프되지만, 미사용 클래스는 제거되지 않음:

```bash
bun add -d postcss-modules
```

```javascript
// postcss.config.js
export default {
  plugins: {
    "postcss-modules": {
      generateScopedName: "[name]__[local]___[hash:base64:5]",
      // 미사용 export 경고
      getJSON: (cssFileName, json) => {
        // 사용되지 않은 클래스 로깅
        console.log(`CSS Modules in ${cssFileName}:`, Object.keys(json));
      },
    },
  },
};
```

## 번들 분석

```bash
# CSS 번들 크기 분석
bun add -d source-map-explorer

# 분석 실행
bunx source-map-explorer dist/styles.css --html report.html
```

## 빌드 스크립트

```typescript
// scripts/analyze-css.ts
import { Glob } from "bun";

const cssGlob = new Glob("dist/**/*.css");
let totalSize = 0;

for await (const file of cssGlob.scan()) {
  const stat = await Bun.file(file).size;
  console.log(`${file}: ${(stat / 1024).toFixed(2)} KB`);
  totalSize += stat;
}

console.log(`\nTotal CSS: ${(totalSize / 1024).toFixed(2)} KB`);

// 경고 임계값
if (totalSize > 50 * 1024) {
  console.warn("⚠️ CSS bundle exceeds 50KB");
}
```

## CI에서 크기 체크

```yaml
# .github/workflows/ci.yml
- name: Check CSS size
  run: |
    SIZE=$(stat -f%z dist/styles.css 2>/dev/null || stat -c%s dist/styles.css)
    if [ $SIZE -gt 51200 ]; then
      echo "CSS size ($SIZE bytes) exceeds 50KB limit"
      exit 1
    fi
```

Reference: [Tailwind Optimizing for Production](https://tailwindcss.com/docs/optimizing-for-production)
