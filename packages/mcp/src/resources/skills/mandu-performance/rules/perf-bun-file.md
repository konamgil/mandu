---
title: Use Bun.file() for Efficient File Operations
impact: HIGH
impactDescription: 10× faster than Node.js fs
tags: performance, bun, file, io
---

## Use Bun.file() for Efficient File Operations

**Impact: HIGH (10× faster than Node.js fs)**

Bun.file()은 lazy 로딩과 스트리밍을 지원하여 Node.js fs보다 훨씬 빠릅니다.

**Incorrect (Node.js 방식):**

```typescript
import { readFile, writeFile } from "fs/promises";

// ❌ 전체 파일을 메모리에 로드
const content = await readFile("./data.json", "utf-8");
const data = JSON.parse(content);
```

**Correct (Bun.file 방식):**

```typescript
// ✅ Lazy 로딩, 필요할 때만 읽음
const file = Bun.file("./data.json");

// 메타데이터만 읽기 (파일 내용 로드 안 함)
console.log(file.size);  // 빠름
console.log(file.type);  // "application/json"

// 필요할 때 내용 읽기
const data = await file.json();  // JSON 파싱 내장
```

## Mandu Slot에서의 활용

```typescript
// spec/slots/files.slot.ts
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get(async (ctx) => {
    const filename = ctx.params.filename;
    const file = Bun.file(`./uploads/${filename}`);

    // ✅ 파일 존재 확인
    if (!(await file.exists())) {
      return ctx.notFound("File not found");
    }

    // ✅ 스트리밍 응답
    return new Response(file, {
      headers: {
        "Content-Type": file.type,
        "Content-Length": String(file.size),
      },
    });
  })

  .post(async (ctx) => {
    const body = await ctx.body<{ content: string }>();

    // ✅ 효율적인 파일 쓰기
    await Bun.write("./uploads/new-file.txt", body.content);

    return ctx.created({ message: "File saved" });
  });
```

## 대용량 파일 스트리밍

```typescript
export default Mandu.filling()
  .get(async (ctx) => {
    const file = Bun.file("./large-video.mp4");

    // ✅ Range 요청 지원 (비디오 스트리밍)
    const range = ctx.headers.get("range");

    if (range) {
      const [start, end] = parseRange(range, file.size);
      const chunk = file.slice(start, end + 1);

      return new Response(chunk, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${file.size}`,
          "Content-Length": String(end - start + 1),
          "Content-Type": file.type,
        },
      });
    }

    return new Response(file);
  });
```

## 파일 타입별 메서드

```typescript
const file = Bun.file("./data.json");

// 타입별 파싱 메서드
await file.text();        // string
await file.json();        // object
await file.arrayBuffer(); // ArrayBuffer
await file.stream();      // ReadableStream
```

## 여러 파일 동시 읽기

```typescript
// ✅ 병렬로 여러 파일 읽기
const [config, data, schema] = await Promise.all([
  Bun.file("./config.json").json(),
  Bun.file("./data.json").json(),
  Bun.file("./schema.json").json(),
]);
```

Reference: [Bun.file() documentation](https://bun.sh/docs/api/file-io)
