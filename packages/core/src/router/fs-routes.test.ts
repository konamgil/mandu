import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import path from "path";
import { generateManifest } from "./fs-routes";

const repoTempRoot = path.resolve(import.meta.dir, "../../../..", ".tmp-test-artifacts");

async function mkRepoTempDir(prefix: string): Promise<string> {
  await mkdir(repoTempRoot, { recursive: true });
  return mkdtemp(path.join(repoTempRoot, prefix));
}

describe("generateManifest hydration config", () => {
  it("does not preserve stale island hydration after the client entry disappears", async () => {
    const rootDir = await mkRepoTempDir("routes-hydration-stale-");
    try {
      await mkdir(path.join(rootDir, "app", "candidates", "[id]"), { recursive: true });
      await mkdir(path.join(rootDir, "src", "client", "widgets"), { recursive: true });
      await writeFile(
        path.join(rootDir, "app", "candidates", "[id]", "page.tsx"),
        `
          import { PledgeAccordion } from "@/client/widgets/PledgeAccordion.client";
          export default function Page() {
            return <main><PledgeAccordion pledges={[]} /></main>;
          }
        `,
        "utf-8",
      );
      await writeFile(
        path.join(rootDir, "src", "client", "widgets", "PledgeAccordion.client.tsx"),
        `
          "use client";
          export function PledgeAccordion() {
            return <div />;
          }
        `,
        "utf-8",
      );

      const first = await generateManifest(rootDir);
      const firstRoute = first.manifest.routes.find((route) => route.id === "candidates-$id");
      expect(firstRoute?.clientModule).toContain("PledgeAccordion.client.tsx");
      expect(firstRoute?.hydration?.strategy).toBe("island");

      await writeFile(
        path.join(rootDir, "app", "candidates", "[id]", "page.tsx"),
        `
          export default function Page() {
            return <main><details><summary>server only</summary></details></main>;
          }
        `,
        "utf-8",
      );

      const second = await generateManifest(rootDir);
      const secondRoute = second.manifest.routes.find((route) => route.id === "candidates-$id");
      expect(secondRoute?.clientModule).toBeUndefined();
      expect(secondRoute?.hydration?.strategy).not.toBe("island");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("reads page-level hydration exports from the current page source", async () => {
    const rootDir = await mkRepoTempDir("routes-hydration-export-");
    try {
      await mkdir(path.join(rootDir, "app", "about"), { recursive: true });
      await writeFile(
        path.join(rootDir, "app", "about", "page.tsx"),
        `
          export const hydration = { strategy: "none", priority: "idle", preload: true };
          export default function Page() {
            return <main>About</main>;
          }
        `,
        "utf-8",
      );

      const result = await generateManifest(rootDir);
      const route = result.manifest.routes.find((entry) => entry.id === "about");
      expect(route?.hydration).toEqual({
        strategy: "none",
        priority: "idle",
        preload: true,
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
