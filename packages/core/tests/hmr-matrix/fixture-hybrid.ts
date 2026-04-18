/**
 * Hybrid fixture builder — SSR pages + one island.
 *
 * Mirrors `demo/starter` at a minimum: one route has a `clientModule`
 * (the island), the rest are SSR-only. This is the most common real-world
 * project shape — a dashboard that is mostly server-rendered with a few
 * interactive widgets.
 *
 * Key difference from `fixture-ssg`:
 *   - The manifest route DOES have `clientModule: "app/widget.client.tsx"`
 *     and `hydration: { strategy: "island", priority: "visible", preload: false }`.
 *   - An `island.client.tsx` change triggers the "islands-only" rebuild
 *     path (fast, no framework bundles).
 *   - `src/shared/**` changes still fire `SSR_CHANGE_WILDCARD` but the
 *     expected behavior is `full-reload` (not `prerender-regen`) because
 *     the hybrid app has live SSR + client state.
 */

import path from "path";
import { mkdirSync, writeFileSync } from "fs";
import type { RoutesManifest } from "../../src/spec/schema";
import { initProjectSkeleton } from "./harness";

/** Scaffold the hybrid on-disk project. One island, one SSR-only page. */
export function scaffoldHybrid(rootDir: string): RoutesManifest {
  initProjectSkeleton(rootDir);

  mkdirSync(path.join(rootDir, "app"), { recursive: true });
  mkdirSync(path.join(rootDir, "spec/contracts"), { recursive: true });
  mkdirSync(path.join(rootDir, "spec/resources"), { recursive: true });

  writeFileSync(
    path.join(rootDir, "app/page.tsx"),
    [
      "import Widget from './widget.client.tsx';",
      "export default function HomePage() {",
      "  return <div>hybrid home <Widget /></div>;",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(rootDir, "app/page.slot.ts"),
    "export async function load() { return { hybrid: true }; }\n",
  );
  writeFileSync(
    path.join(rootDir, "app/layout.tsx"),
    "export default function Layout({ children }: { children: React.ReactNode }) { return <div>{children}</div>; }\n",
  );
  writeFileSync(
    path.join(rootDir, "app/widget.client.tsx"),
    [
      "import React, { useState } from 'react';",
      "export default function Widget() {",
      "  const [count, setCount] = useState(0);",
      "  return <button onClick={() => setCount(count + 1)}>v0 {count}</button>;",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(rootDir, "app/middleware.ts"),
    "export function middleware() { return {}; }\n",
  );
  writeFileSync(
    path.join(rootDir, "spec/contracts/sample.contract.ts"),
    "export const contract = { name: 'sample' };\n",
  );
  writeFileSync(
    path.join(rootDir, "spec/resources/sample.resource.ts"),
    "export const resource = { name: 'sample', fields: [] };\n",
  );

  // Manifest: one island route (for island tests) + implicit SSR fallback.
  // Setting `clientModule` makes `startDevBundler` register the path in
  // `clientModuleToRoute` so the watcher dispatches island-update signals.
  //
  // Phase 7.1 — `slotModule` is set so `startDevBundler` registers
  // `app/page.slot.ts` in `serverModuleSet`. Slot changes in a hybrid
  // project fire `onSSRChange(filePath)` which the CLI composes into a
  // full-reload (slot-loaded data is embedded in the SSR HTML, so the
  // browser state is invalidated regardless of whether there's an
  // island on the page).
  return {
    version: 1,
    routes: [
      {
        id: "home",
        kind: "page",
        pattern: "/",
        module: "app/page.tsx",
        componentModule: "app/page.tsx",
        slotModule: "app/page.slot.ts",
        clientModule: "app/widget.client.tsx",
        layoutChain: ["app/layout.tsx"],
        hydration: {
          strategy: "island",
          priority: "visible",
          preload: false,
        },
      },
    ],
  } as RoutesManifest;
}
