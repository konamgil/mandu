/**
 * Pure-SSG fixture builder — a project with zero islands.
 *
 * Layout:
 *   .mandu/manifest.json          ← pre-populated (fast path)
 *   app/page.tsx                  ← SSR-only, no client bundle
 *   app/page.slot.ts              ← server data loader
 *   app/layout.tsx                ← root layout (no html/body wrapping)
 *   app/not-found.tsx             ← notFound() target
 *   app/middleware.ts             ← route middleware (matrix D)
 *   spec/contracts/sample.contract.ts   ← contract (matrix D)
 *   spec/resources/sample.resource.ts   ← resource (matrix D)
 *   src/shared/util.ts            ← common dir (B1 + #188)
 *   src/top-level.ts              ← B1 regression guard
 *   app-styles.css                ← CSS change kind
 *   mandu.config.ts               ← config auto-restart
 *   .env                          ← env auto-restart
 *
 * The manifest lists a single `page` route with `hydration: { strategy: "none" }`
 * so the #188 prerender regen path fires. No `clientModule`, so the
 * `island.client.tsx` cell is `n/a`.
 *
 * This fixture is the smallest possible Mandu project that still exercises
 * every matrix dimension for the SSG column — the tree is a handful of
 * files totaling <100 LOC of user code, by design. Keep it minimal; the
 * matrix cares about the *wiring*, not the rendered output.
 */

import path from "path";
import { mkdirSync, writeFileSync } from "fs";
import type { RoutesManifest } from "../../src/spec/schema";
import { initProjectSkeleton } from "./harness";

/** Scaffold the on-disk pure-SSG project. Returns the manifest a dev
 *  bundler would receive from `resolveManifest()`. */
export function scaffoldSSG(rootDir: string): RoutesManifest {
  initProjectSkeleton(rootDir);

  mkdirSync(path.join(rootDir, "app"), { recursive: true });
  mkdirSync(path.join(rootDir, "spec/contracts"), { recursive: true });
  mkdirSync(path.join(rootDir, "spec/resources"), { recursive: true });

  writeFileSync(
    path.join(rootDir, "app/page.tsx"),
    "export default function HomePage() { return <div>pure ssg home</div>; }\n",
  );
  writeFileSync(
    path.join(rootDir, "app/page.slot.ts"),
    "export async function load() { return {}; }\n",
  );
  writeFileSync(
    path.join(rootDir, "app/layout.tsx"),
    "export default function Layout({ children }: { children: React.ReactNode }) { return <div>{children}</div>; }\n",
  );
  writeFileSync(
    path.join(rootDir, "app/not-found.tsx"),
    "export default function NotFound() { return <div>404</div>; }\n",
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

  // Pre-created empty island file to verify the n/a path. Tests shouldn't
  // modify this — the cell is skipped for pure-ssg.
  writeFileSync(
    path.join(rootDir, "app/widget.client.tsx"),
    "// n/a for pure-ssg — never hydrated\n",
  );

  // Stub `.mandu/static/` so the #188 prerender-regen path has something to
  // check existence on. The harness only asserts the signal fires, not the
  // actual regeneration.
  mkdirSync(path.join(rootDir, ".mandu/static"), { recursive: true });
  writeFileSync(
    path.join(rootDir, ".mandu/static/index.html"),
    "<!doctype html><html><body>pre-existing stale html</body></html>",
  );

  // Manifest — single SSR-only route with `hydration.strategy: "none"`.
  // `componentModule` is required so the watcher registers `app/page.tsx`
  // in `serverModuleSet`; without it the SSR change path is a no-op.
  //
  // Phase 7.1 — `slotModule` is set so `startDevBundler` registers
  // `app/page.slot.ts` in `serverModuleSet`. The slot file itself is
  // created above. Before Phase 7.1 this field was omitted, and the
  // bundler had no way to see slot edits — see `KNOWN_BUNDLER_GAPS`
  // in matrix.spec.ts (now with `"app/slot.ts"` removed).
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
        layoutChain: ["app/layout.tsx"],
        hydration: { strategy: "none" },
      },
    ],
  } as RoutesManifest;
}
