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
  it("records compiler-discovered client boundaries on page routes", async () => {
    const rootDir = await mkRepoTempDir("routes-boundaries-");
    try {
      await mkdir(path.join(rootDir, "app", "pledges", "[id]"), { recursive: true });
      await mkdir(path.join(rootDir, "src", "client", "widgets", "comments-section"), { recursive: true });
      await mkdir(path.join(rootDir, "src", "client", "widgets", "activity"), { recursive: true });
      await writeFile(
        path.join(rootDir, "app", "pledges", "[id]", "page.tsx"),
        `
          import { CommentsSection } from "@/client/widgets/comments-section/CommentsSection.client";
          import ActivityFeed from "@/client/widgets/activity/ActivityFeed.client";

          export default function Page({ params }) {
            return (
              <main>
                <CommentsSection pledgeId={params.id} initialComments={[]} />
                <ActivityFeed pledgeId={params.id} />
              </main>
            );
          }
        `,
        "utf-8",
      );
      await writeFile(
        path.join(rootDir, "src", "client", "widgets", "comments-section", "CommentsSection.client.tsx"),
        `"use client";
         export function CommentsSection() {
           return <section />;
         }`,
        "utf-8",
      );
      await writeFile(
        path.join(rootDir, "src", "client", "widgets", "activity", "ActivityFeed.client.tsx"),
        `"use client";
         export default function ActivityFeed() {
           return <aside />;
         }`,
        "utf-8",
      );

      const result = await generateManifest(rootDir);
      const route = result.manifest.routes.find((entry) => entry.id === "pledges-$id");

      expect(route?.hydration?.strategy).toBe("island");
      expect(route?.clientModule).toBeUndefined();
      expect(route?.boundaries?.map(({ id, module, importSpecifier, exportName, localName, hydrate, propsSource, propsKeys, hasSpreadProps }) => ({
        id,
        module,
        importSpecifier,
        exportName,
        localName,
        hydrate,
        propsSource,
        propsKeys,
        hasSpreadProps,
      }))).toEqual([
        {
          id: "pledges-$id--0",
          module: "src/client/widgets/comments-section/CommentsSection.client.tsx",
          importSpecifier: "@/client/widgets/comments-section/CommentsSection.client",
          exportName: "CommentsSection",
          localName: "CommentsSection",
          hydrate: "visible",
          propsSource: "inline",
          propsKeys: ["pledgeId", "initialComments"],
          hasSpreadProps: false,
        },
        {
          id: "pledges-$id--1",
          module: "src/client/widgets/activity/ActivityFeed.client.tsx",
          importSpecifier: "@/client/widgets/activity/ActivityFeed.client",
          exportName: "default",
          localName: "ActivityFeed",
          hydrate: "visible",
          propsSource: "inline",
          propsKeys: ["pledgeId"],
          hasSpreadProps: false,
        },
      ]);
      expect(route?.boundaries?.[0]?.source).toEqual({
        file: "app/pledges/[id]/page.tsx",
        line: expect.any(Number),
        column: expect.any(Number),
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("does not preserve stale route-level clientModule when compiler boundaries own the client imports", async () => {
    const rootDir = await mkRepoTempDir("routes-boundaries-stale-client-");
    try {
      await mkdir(path.join(rootDir, ".mandu"), { recursive: true });
      await mkdir(path.join(rootDir, "app", "pledges", "[id]"), { recursive: true });
      await mkdir(path.join(rootDir, "src", "client", "widgets", "comments-section"), { recursive: true });
      await writeFile(
        path.join(rootDir, "app", "pledges", "[id]", "page.tsx"),
        `
          import { CommentsSection } from "@/client/widgets/comments-section/CommentsSection.client";

          export default function Page({ params }) {
            return <main><CommentsSection pledgeId={params.id} initialComments={[]} /></main>;
          }
        `,
        "utf-8",
      );
      await writeFile(
        path.join(rootDir, "src", "client", "widgets", "comments-section", "CommentsSection.client.tsx"),
        `"use client";
         export function CommentsSection() {
           return <section />;
         }`,
        "utf-8",
      );
      await writeFile(
        path.join(rootDir, ".mandu", "routes.manifest.json"),
        JSON.stringify({
          version: 1,
          routes: [
            {
              id: "pledges-$id",
              pattern: "/pledges/:id",
              module: "app/pledges/[id]/page.tsx",
              kind: "page",
              componentModule: "app/pledges/[id]/page.tsx",
              clientModule: "src/client/widgets/comments-section/CommentsSection.client.tsx",
              clientExportName: "CommentsSection",
              hydration: { strategy: "island", priority: "visible", preload: false },
            },
          ],
        }, null, 2),
        "utf-8",
      );

      const result = await generateManifest(rootDir);
      const route = result.manifest.routes.find((entry) => entry.id === "pledges-$id");

      expect(route?.clientModule).toBeUndefined();
      expect(route?.clientExportName).toBeUndefined();
      expect(route?.hydration?.strategy).toBe("island");
      expect(route?.boundaries?.map(({ id, module, exportName }) => ({ id, module, exportName }))).toEqual([
        {
          id: "pledges-$id--0",
          module: "src/client/widgets/comments-section/CommentsSection.client.tsx",
          exportName: "CommentsSection",
        },
      ]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("records client boundaries hidden behind route-owned server wrappers", async () => {
    const rootDir = await mkRepoTempDir("routes-boundary-wrapper-");
    try {
      await mkdir(path.join(rootDir, "app", "pledges", "[id]"), { recursive: true });
      await mkdir(path.join(rootDir, "src", "client", "widgets"), { recursive: true });
      await writeFile(
        path.join(rootDir, "app", "pledges", "[id]", "page.tsx"),
        `
          import { CommentsPanel } from "./CommentsPanel";

          export default function Page({ params }) {
            return <main><CommentsPanel pledgeId={params.id} /></main>;
          }
        `,
        "utf-8",
      );
      await writeFile(
        path.join(rootDir, "app", "pledges", "[id]", "CommentsPanel.tsx"),
        `
          import { CommentsSection } from "@/client/widgets/CommentsSection.client";

          export function CommentsPanel({ pledgeId }) {
            return <CommentsSection pledgeId={pledgeId} />;
          }
        `,
        "utf-8",
      );
      await writeFile(
        path.join(rootDir, "src", "client", "widgets", "CommentsSection.client.tsx"),
        `"use client";
         export function CommentsSection() {
           return <section />;
         }`,
        "utf-8",
      );

      const result = await generateManifest(rootDir);
      const route = result.manifest.routes.find((entry) => entry.id === "pledges-$id");

      expect(route?.clientModule).toBeUndefined();
      expect(route?.hydration?.strategy).toBe("island");
      expect(route?.boundaries?.map(({ id, module, importSpecifier, exportName, localName, source }) => ({
        id,
        module,
        importSpecifier,
        exportName,
        localName,
        sourceFile: source.file,
      }))).toEqual([
        {
          id: "pledges-$id--0",
          module: "src/client/widgets/CommentsSection.client.tsx",
          importSpecifier: "@/client/widgets/CommentsSection.client",
          exportName: "CommentsSection",
          localName: "CommentsSection",
          sourceFile: "app/pledges/[id]/CommentsPanel.tsx",
        },
      ]);

      await writeFile(
        path.join(rootDir, "app", "pledges", "[id]", "CommentsPanel.tsx"),
        `
          export function CommentsPanel({ pledgeId }) {
            return <section>{pledgeId}</section>;
          }
        `,
        "utf-8",
      );

      const second = await generateManifest(rootDir);
      const secondRoute = second.manifest.routes.find((entry) => entry.id === "pledges-$id");
      expect(secondRoute?.clientModule).toBeUndefined();
      expect(secondRoute?.boundaries).toBeUndefined();
      expect(secondRoute?.hydration?.strategy).not.toBe("island");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("fails route manifest generation for unsupported client boundary children", async () => {
    const rootDir = await mkRepoTempDir("routes-boundary-children-");
    try {
      await mkdir(path.join(rootDir, "app", "cards"), { recursive: true });
      await mkdir(path.join(rootDir, "src", "client"), { recursive: true });
      await writeFile(
        path.join(rootDir, "app", "cards", "page.tsx"),
        `
          import Card from "@/client/Card.client";

          export default function Page() {
            return <main><Card><span>server child</span></Card></main>;
          }
        `,
        "utf-8",
      );
      await writeFile(
        path.join(rootDir, "src", "client", "Card.client.tsx"),
        `"use client";
         export default function Card() {
           return <section />;
         }`,
        "utf-8",
      );

      await expect(generateManifest(rootDir)).rejects.toThrow(/MANDU_BOUNDARY_UNSUPPORTED_CHILDREN/);
      await expect(generateManifest(rootDir)).rejects.toThrow(/app\/cards\/page\.tsx/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("fails route manifest generation for statically visible non-serializable boundary props", async () => {
    const rootDir = await mkRepoTempDir("routes-boundary-nonserializable-");
    try {
      await mkdir(path.join(rootDir, "app", "settings"), { recursive: true });
      await mkdir(path.join(rootDir, "src", "client"), { recursive: true });
      await writeFile(
        path.join(rootDir, "app", "settings", "page.tsx"),
        `
          import SettingsPanel from "@/client/SettingsPanel.client";

          export default function Page() {
            return <main><SettingsPanel config={{ onSave: () => "server function" }} /></main>;
          }
        `,
        "utf-8",
      );
      await writeFile(
        path.join(rootDir, "src", "client", "SettingsPanel.client.tsx"),
        `"use client";
         export default function SettingsPanel() {
           return <section />;
         }`,
        "utf-8",
      );

      let errorMessage = "";
      try {
        await generateManifest(rootDir);
      } catch (error) {
        errorMessage = String(error);
      }
      expect(errorMessage).toContain("MANDU_BOUNDARY_UNSUPPORTED_PROP_VALUE");
      expect(errorMessage).toContain("Suggestion:");
      expect(errorMessage).toContain("route=settings");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("fails route manifest generation for unresolved client boundary named exports", async () => {
    const rootDir = await mkRepoTempDir("routes-boundary-missing-export-");
    try {
      await mkdir(path.join(rootDir, "app", "profile"), { recursive: true });
      await mkdir(path.join(rootDir, "src", "client"), { recursive: true });
      await writeFile(
        path.join(rootDir, "app", "profile", "page.tsx"),
        `
          import { MissingProfile } from "@/client/Profile.client";

          export default function Page() {
            return <main><MissingProfile label="profile" /></main>;
          }
        `,
        "utf-8",
      );
      await writeFile(
        path.join(rootDir, "src", "client", "Profile.client.tsx"),
        `"use client";
         export function ExistingProfile() {
           return <section />;
         }`,
        "utf-8",
      );

      let errorMessage = "";
      try {
        await generateManifest(rootDir);
      } catch (error) {
        errorMessage = String(error);
      }
      expect(errorMessage).toContain("MANDU_BOUNDARY_UNRESOLVED_EXPORT");
      expect(errorMessage).toContain("MissingProfile");
      expect(errorMessage).toContain("route=profile");
      expect(errorMessage).toContain("Suggestion:");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("fails route manifest generation for server-only imports inside client boundaries", async () => {
    const rootDir = await mkRepoTempDir("routes-boundary-server-only-");
    try {
      await mkdir(path.join(rootDir, "app", "files"), { recursive: true });
      await mkdir(path.join(rootDir, "src", "client"), { recursive: true });
      await writeFile(
        path.join(rootDir, "app", "files", "page.tsx"),
        `
          import { FilePanel } from "@/client/FilePanel.client";

          export default function Page() {
            return <main><FilePanel label="files" /></main>;
          }
        `,
        "utf-8",
      );
      await writeFile(
        path.join(rootDir, "src", "client", "FilePanel.client.tsx"),
        `"use client";
         import { readFile } from "node:fs/promises";
         import { Database } from "bun:sqlite";
         export function FilePanel() {
           return <section>{String(readFile)}{String(Database)}</section>;
         }`,
        "utf-8",
      );

      let errorMessage = "";
      try {
        await generateManifest(rootDir);
      } catch (error) {
        errorMessage = String(error);
      }
      expect(errorMessage).toContain("MANDU_BOUNDARY_SERVER_ONLY_IMPORT");
      expect(errorMessage).toContain("node:fs/promises");
      expect(errorMessage).toContain("bun:sqlite");
      expect(errorMessage).toContain("src/client/FilePanel.client.tsx");
      expect(errorMessage).toContain("Suggestion:");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

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
      expect(firstRoute?.clientModule).toBeUndefined();
      expect(firstRoute?.boundaries?.[0]?.module).toContain("PledgeAccordion.client.tsx");
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
      expect(secondRoute?.boundaries).toBeUndefined();
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
