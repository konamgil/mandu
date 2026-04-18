/**
 * Full-interactive fixture builder — every route has an island.
 *
 * This is the "Next.js-app-dir-with-`use client`-everywhere" shape. Every
 * page declares `clientModule` + `hydration.strategy === "island"`, so
 * SSR changes still require handler re-registration BUT the client
 * bundle path is always exercised.
 *
 * Difference from `fixture-hybrid`:
 *   - TWO island routes (`/` and `/about`) to verify multi-island
 *     rebuild coalescing in the `pendingBuildSet` queue.
 *   - Both routes point at DIFFERENT client modules (not shared) so an
 *     edit to one island does not implicitly rebuild the other.
 *
 * Why two islands and not one: part of the COMPLETENESS contract (36
 * cells × expected behaviors) requires the `island.client.tsx` cell to
 * verify that the `onRebuild({ routeId })` callback fires with the
 * correct route id. With a single-island fixture the test is trivially
 * true; with two, a bug where the dispatcher rebuilds every island on
 * every edit would be caught.
 */

import path from "path";
import { mkdirSync, writeFileSync } from "fs";
import type { RoutesManifest } from "../../src/spec/schema";
import { initProjectSkeleton } from "./harness";

/** Scaffold the full-interactive project: two routes, two islands. */
export function scaffoldFull(rootDir: string): RoutesManifest {
  initProjectSkeleton(rootDir);

  mkdirSync(path.join(rootDir, "app/about"), { recursive: true });
  mkdirSync(path.join(rootDir, "spec/contracts"), { recursive: true });
  mkdirSync(path.join(rootDir, "spec/resources"), { recursive: true });

  // Root / — island #1
  writeFileSync(
    path.join(rootDir, "app/page.tsx"),
    [
      "import Widget from './widget.client.tsx';",
      "export default function HomePage() {",
      "  return <div>home <Widget /></div>;",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(rootDir, "app/page.slot.ts"),
    "export async function load() { return { full: true }; }\n",
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
      "  return <button onClick={() => setCount(count + 1)}>home v0 {count}</button>;",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(rootDir, "app/middleware.ts"),
    "export function middleware() { return {}; }\n",
  );

  // Second route — /about — distinct island so multi-route dispatch is real.
  writeFileSync(
    path.join(rootDir, "app/about/page.tsx"),
    [
      "import AboutWidget from './about.client.tsx';",
      "export default function AboutPage() {",
      "  return <div>about <AboutWidget /></div>;",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(rootDir, "app/about/about.client.tsx"),
    [
      "import React, { useState } from 'react';",
      "export default function AboutWidget() {",
      "  const [toggled, setToggled] = useState(false);",
      "  return <button onClick={() => setToggled(!toggled)}>about v0 {String(toggled)}</button>;",
      "}",
      "",
    ].join("\n"),
  );

  // Contract + resource + css + config + env all inherited from skeleton /
  // initProjectSkeleton.
  writeFileSync(
    path.join(rootDir, "spec/contracts/sample.contract.ts"),
    "export const contract = { name: 'sample' };\n",
  );
  writeFileSync(
    path.join(rootDir, "spec/resources/sample.resource.ts"),
    "export const resource = { name: 'sample', fields: [] };\n",
  );

  // Phase 7.1 — `slotModule` on `home` so `startDevBundler` registers
  // `app/page.slot.ts` in `serverModuleSet`. The `about` route has no
  // slot in this fixture (testing the falsy-skip branch — a route
  // without `slotModule` must be registered normally without errors).
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
      {
        id: "about",
        kind: "page",
        pattern: "/about",
        module: "app/about/page.tsx",
        componentModule: "app/about/page.tsx",
        clientModule: "app/about/about.client.tsx",
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
