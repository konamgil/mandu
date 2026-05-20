import { describe, expect, it } from "bun:test";
import {
  findClientComponentImports,
  findRouteLevelClientComponentImport,
  findRouteLevelClientComponentImports,
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
      },
      {
        module: "@/client/widgets/pledge-actions/PledgeActions.client",
        localName: "PledgeActions",
      },
    ]);
  });
});
