import { describe, expect, it } from "bun:test";
import {
  findClientComponentImports,
  findRouteLevelClientComponentImport,
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
        names: ["LoginForm", "SubmitButton"],
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

  it("does not promote embedded client imports inside a larger server page", () => {
    const routeClient = findRouteLevelClientComponentImport(`
      import HomeApp from "@/client/pages/home/HomeApp.client";

      export default function HomePage() {
        return <>
          <header>Server shell</header>
          <HomeApp />
        </>;
      }
    `);

    expect(routeClient).toBeNull();
  });

  it("does not promote client imports when the page wrapper passes props", () => {
    const routeClient = findRouteLevelClientComponentImport(`
      import PledgePage from "@/client/pages/pledges/PledgePage.client";

      export default function Page({ params }) {
        return <PledgePage id={params.id} />;
      }
    `);

    expect(routeClient).toBeNull();
  });
});
