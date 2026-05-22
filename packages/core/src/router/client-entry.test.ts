import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import path from "path";
import {
  findClientComponentImports,
  findRouteLevelClientComponentImport,
  findRouteLevelClientComponentImports,
  resolveRouteLevelClientEntryPath,
} from "./client-entry";

describe("findClientComponentImports", () => {
  it("detects named .client imports for diagnostics", () => {
    const imports = findClientComponentImports(`
      import { LoginForm, SubmitButton as Button } from "@/client/widgets/login-form/LoginForm.client";
      import Header from "./Header.client.tsx";
    `);

    expect(imports).toEqual([
      {
        module: "@/client/widgets/login-form/LoginForm.client",
        kind: "named",
        names: ["LoginForm", "Button"],
      },
      {
        module: "./Header.client.tsx",
        kind: "default",
        names: ["Header"],
      },
    ]);
  });

  it("detects a default-imported client component when the page returns only that component", () => {
    const routeClient = findRouteLevelClientComponentImport(`
      import LoginPage from "@/client/pages/login/LoginPage.client";

      export const metadata = { title: "Login" };

      export default function Page() {
        return <LoginPage />;
      }
    `);

    expect(routeClient).toEqual({
      module: "@/client/pages/login/LoginPage.client",
      localName: "LoginPage",
      exportName: "default",
    });
  });

  it("promotes a fragment wrapper with head-only elements and a bare client component", () => {
    const routeClient = findRouteLevelClientComponentImport(`
      import HomeApp from "@/client/pages/home/HomeApp.client";

      export default function HomePage() {
        return <>
          <meta name="description" content="home" />
          <HomeApp />
        </>;
      }
    `);

    expect(routeClient).toEqual({
      module: "@/client/pages/home/HomeApp.client",
      localName: "HomeApp",
      exportName: "default",
    });
  });

  it("detects a named-imported client component when the page returns only that component", () => {
    const routeClient = findRouteLevelClientComponentImport(`
      import { NotificationsPage } from "@/client/pages/notifications/NotificationsPage.client";

      export default function Page() {
        return <NotificationsPage />;
      }
    `);

    expect(routeClient).toEqual({
      module: "@/client/pages/notifications/NotificationsPage.client",
      localName: "NotificationsPage",
      exportName: "NotificationsPage",
    });
  });

  it("preserves the source export name for aliased named imports", () => {
    const routeClient = findRouteLevelClientComponentImport(`
      import { NotificationsPage as PageIsland } from "@/client/pages/notifications/NotificationsPage.client";

      export default function Page() {
        return <PageIsland />;
      }
    `);

    expect(routeClient).toEqual({
      module: "@/client/pages/notifications/NotificationsPage.client",
      localName: "PageIsland",
      exportName: "NotificationsPage",
    });
  });

  it("promotes embedded client imports inside a larger server page", () => {
    const routeClient = findRouteLevelClientComponentImport(`
      import HomeApp from "@/client/pages/home/HomeApp.client";

      export default function HomePage() {
        return <>
          <header>Server shell</header>
          <HomeApp />
        </>;
      }
    `);

    expect(routeClient).toEqual({
      module: "@/client/pages/home/HomeApp.client",
      localName: "HomeApp",
      exportName: "default",
    });
  });

  it("promotes client imports when the page wrapper passes props", () => {
    const routeClient = findRouteLevelClientComponentImport(`
      import PledgePage from "@/client/pages/pledges/PledgePage.client";

      export default function Page({ params }) {
        return <PledgePage id={params.id} />;
      }
    `);

    expect(routeClient).toEqual({
      module: "@/client/pages/pledges/PledgePage.client",
      localName: "PledgePage",
      exportName: "default",
    });
  });

  it("detects multiple rendered client imports in a server shell", () => {
    const routeClients = findRouteLevelClientComponentImports(`
      import { CommentsSection } from "@/client/widgets/comments-section/CommentsSection.client";
      import { PledgeActions } from "@/client/widgets/pledge-actions/PledgeActions.client";

      export default async function PledgePage({ params }) {
        const pledge = await Promise.resolve(params.id);
        return (
          <main>
            <article>{pledge}</article>
            <PledgeActions pledgeId={params.id} />
            <CommentsSection pledgeId={params.id} />
          </main>
        );
      }
    `);

    expect(routeClients).toEqual([
      {
        module: "@/client/widgets/comments-section/CommentsSection.client",
        localName: "CommentsSection",
        exportName: "CommentsSection",
      },
      {
        module: "@/client/widgets/pledge-actions/PledgeActions.client",
        localName: "PledgeActions",
        exportName: "PledgeActions",
      },
    ]);
  });

  it("detects rendered component imports without a .client filename suffix", () => {
    const routeClient = findRouteLevelClientComponentImport(`
      import { PledgeForm } from "@/client/widgets/pledge-form/PledgeForm";

      export default async function NewPledgePage() {
        return <main><PledgeForm parties={[]} candidates={[]} /></main>;
      }
    `);

    expect(routeClient).toEqual({
      module: "@/client/widgets/pledge-form/PledgeForm",
      localName: "PledgeForm",
      exportName: "PledgeForm",
    });
  });

  it("does not promote shared UI primitives to route-level client entries", () => {
    const routeClient = findRouteLevelClientComponentImport(`
      import { Button } from "@/client/shared/ui/button";

      export default function Page() {
        return <main><Button>Open</Button></main>;
      }
    `);

    expect(routeClient).toBeNull();
  });

  it("resolves a route-level client entry by reading a use client target without .client in the path", async () => {
    const rootDir = await mkdtemp(path.join(import.meta.dir, ".tmp-client-entry-"));
    try {
      await mkdir(path.join(rootDir, "app", "pledges", "new"), { recursive: true });
      await mkdir(path.join(rootDir, "src", "client", "widgets", "pledge-form"), { recursive: true });

      const pageSource = `
        import { PledgeForm } from "@/client/widgets/pledge-form/PledgeForm";

        export default async function NewPledgePage() {
          return <main><PledgeForm parties={[]} candidates={[]} /></main>;
        }
      `;
      await writeFile(path.join(rootDir, "app", "pledges", "new", "page.tsx"), pageSource);
      await writeFile(
        path.join(rootDir, "src", "client", "widgets", "pledge-form", "PledgeForm.tsx"),
        `"use client";
         export function PledgeForm() {
           return <form />;
         }`,
      );

      const resolved = await resolveRouteLevelClientEntryPath(
        rootDir,
        "app/pledges/new/page.tsx",
        pageSource,
      );

      expect(resolved).toBe("src/client/widgets/pledge-form/PledgeForm.tsx");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
