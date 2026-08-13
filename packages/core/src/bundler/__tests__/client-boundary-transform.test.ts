import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  __ManduClientBoundary,
  renderWithManduClientBoundaryManifest,
} from "../../internal/client-boundary";
import {
  transformClientBoundaries,
  validateClientBoundaryExport,
  validateClientBoundaryServerOnlyImports,
} from "../client-boundary-transform";

describe("transformClientBoundaries", () => {
  it("rewrites named client component JSX into an internal boundary", () => {
    const result = transformClientBoundaries(
      `
import { CommentsSection } from "./CommentsSection.client";

export default async function PledgePage({ comments }) {
  return <main><CommentsSection initialComments={comments} /></main>;
}
`,
      {
        routeId: "pledges-$id",
        fileName: "app/pledges/[id]/page.tsx",
      },
    );

    expect(result.transformed).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.boundaries).toMatchObject([
      {
        id: "pledges-$id--0",
        routeId: "pledges-$id",
        module: "./CommentsSection.client",
        importSpecifier: "./CommentsSection.client",
        exportName: "CommentsSection",
        localName: "CommentsSection",
        hydrate: "visible",
        ordinal: 0,
        propsSource: "inline",
        propsKeys: ["initialComments"],
        hasSpreadProps: false,
      },
    ]);
    expect(result.code).toContain('import { __ManduClientBoundary } from "@mandujs/core/compat/internal/client-boundary";');
    expect(result.code).not.toContain("import { CommentsSection }");
    expect(result.code).toContain("<__ManduClientBoundary");
    expect(result.code).toContain('boundaryId="pledges-$id--0"');
    expect(result.code).toContain('module="./CommentsSection.client"');
    expect(result.code).toContain('exportName="CommentsSection"');
    expect(result.code).toContain("initialComments: comments");
  });

  it("tracks default and namespace client exports in JSX order", () => {
    const result = transformClientBoundaries(
      `
import Profile from "./Profile.client";
import * as Widgets from "./widgets.client";

export default function Dashboard({ user }) {
  return (
    <main>
      <Profile user={user} />
      <Widgets.ActivityFeed userId={user.id} />
    </main>
  );
}
`,
      {
        routeId: "dashboard",
        fileName: "app/dashboard/page.tsx",
        hydrate: "idle",
      },
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.boundaries.map((boundary) => ({
      id: boundary.id,
      module: boundary.module,
      importSpecifier: boundary.importSpecifier,
      exportName: boundary.exportName,
      localName: boundary.localName,
      hydrate: boundary.hydrate,
      propsKeys: boundary.propsKeys,
      hasSpreadProps: boundary.hasSpreadProps,
    }))).toEqual([
      {
        id: "dashboard--0",
        module: "./Profile.client",
        importSpecifier: "./Profile.client",
        exportName: "default",
        localName: "Profile",
        hydrate: "idle",
        propsKeys: ["user"],
        hasSpreadProps: false,
      },
      {
        id: "dashboard--1",
        module: "./widgets.client",
        importSpecifier: "./widgets.client",
        exportName: "ActivityFeed",
        localName: "Widgets.ActivityFeed",
        hydrate: "idle",
        propsKeys: ["userId"],
        hasSpreadProps: false,
      },
    ]);
    expect(result.code).not.toContain("import Profile");
    expect(result.code).not.toContain("import * as Widgets");
    expect(result.code).toContain('boundaryId="dashboard--0"');
    expect(result.code).toContain('boundaryId="dashboard--1"');
    expect(result.code).toContain('exportName="default"');
    expect(result.code).toContain('exportName="ActivityFeed"');
    expect(result.code).toContain("userId: user.id");
  });

  it("reports unsupported children while still making the boundary explicit", () => {
    const result = transformClientBoundaries(
      `
import Card from "./Card.client";

export default function Page() {
  return <Card><span>server child</span></Card>;
}
`,
      {
        routeId: "card",
        fileName: "app/card/page.tsx",
      },
    );

    expect(result.transformed).toBe(true);
    expect(result.diagnostics).toMatchObject([
      {
        code: "MANDU_BOUNDARY_UNSUPPORTED_CHILDREN",
      },
    ]);
    expect(result.code).toContain("<__ManduClientBoundary");
    expect(result.code).not.toContain("<Card>");
  });

  it("reports invalid HTML host contexts for compiler-owned boundaries", () => {
    const result = transformClientBoundaries(
      `
import RowActions from "./RowActions.client";

export default function Page() {
  return (
    <table>
      <tbody>
        <tr>
          <RowActions id="a" />
        </tr>
      </tbody>
    </table>
  );
}
`,
      {
        routeId: "table-route",
        fileName: "app/table/page.tsx",
      },
    );

    expect(result.transformed).toBe(true);
    expect(result.diagnostics).toMatchObject([
      {
        code: "MANDU_BOUNDARY_INVALID_HOST_CONTEXT",
        module: "./RowActions.client",
        exportName: "default",
      },
    ]);
    expect(result.diagnostics[0]?.message).toContain("<tr>");
    expect(result.diagnostics[0]?.suggestion).toContain("explicit island API");
    expect(result.code).toContain("<__ManduClientBoundary");
  });

  it("reports unsupported function props and refs", () => {
    const result = transformClientBoundaries(
      `
import Button from "./Button.client";

export default function Page({ actionRef }) {
  return <Button ref={actionRef} onClick={() => actionRef.current?.()} label="Save" />;
}
`,
      {
        routeId: "actions",
        fileName: "app/actions/page.tsx",
      },
    );

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "MANDU_BOUNDARY_UNSUPPORTED_REF",
      "MANDU_BOUNDARY_UNSUPPORTED_FUNCTION_PROP",
    ]);
    expect(result.diagnostics.every((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(result.diagnostics.every((diagnostic) => diagnostic.routeId === "actions")).toBe(true);
    expect(result.diagnostics.every((diagnostic) => diagnostic.boundaryId === "actions--0")).toBe(true);
    expect(result.diagnostics.every((diagnostic) => diagnostic.suggestion.length > 0)).toBe(true);
    expect(result.code).toContain("label: \"Save\"");
    expect(result.code).not.toContain("actionRef.current");
  });

  it("reports statically visible non-serializable prop values", () => {
    const result = transformClientBoundaries(
      `
import Widget from "./Widget.client";

export default function Page() {
  return <Widget config={{ title: "A", onSave: () => "nope" }} icon={<span />} token={Symbol("x")} />;
}
`,
      {
        routeId: "settings",
        fileName: "app/settings/page.tsx",
      },
    );

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "MANDU_BOUNDARY_UNSUPPORTED_PROP_VALUE",
      "MANDU_BOUNDARY_UNSUPPORTED_PROP_VALUE",
      "MANDU_BOUNDARY_UNSUPPORTED_PROP_VALUE",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.module)).toEqual([
      "./Widget.client",
      "./Widget.client",
      "./Widget.client",
    ]);
    expect(result.diagnostics.every((diagnostic) => diagnostic.suggestion.includes("serializable"))).toBe(true);
    expect(result.code).toContain("<__ManduClientBoundary");
    expect(result.code).not.toContain("onSave");
    expect(result.code).not.toContain("Symbol");
  });

  it("supports ordinal offsets for route import graph transforms", () => {
    const result = transformClientBoundaries(
      `
import { WrapperWidget } from "./WrapperWidget.client";

export function Wrapper() {
  return <WrapperWidget />;
}
`,
      {
        routeId: "nested",
        fileName: "app/nested/Wrapper.tsx",
        ordinalOffset: 2,
      },
    );

    expect(result.boundaries).toMatchObject([
      {
        id: "nested--2",
        ordinal: 2,
        source: {
          file: "app/nested/Wrapper.tsx",
        },
      },
    ]);
    expect(result.code).toContain('boundaryId="nested--2"');
  });

  it("replays manifest-owned boundary ids when provided", () => {
    const result = transformClientBoundaries(
      `
import { WrapperWidget } from "./WrapperWidget.client";

export function Wrapper() {
  return <WrapperWidget />;
}
`,
      {
        routeId: "nested",
        fileName: "app/nested/Wrapper.tsx",
        boundaryReplay: [
          {
            id: "nested--manifest-owned",
            ordinal: 4,
          },
        ],
      },
    );

    expect(result.boundaries).toMatchObject([
      {
        id: "nested--manifest-owned",
        ordinal: 4,
      },
    ]);
    expect(result.code).toContain('boundaryId="nested--manifest-owned"');
  });

  it("validates compiler-discovered client boundary exports", () => {
    const boundary = {
      id: "profile--0",
      routeId: "profile",
      module: "src/client/Profile.client.tsx",
      exportName: "ProfileCard",
      source: {
        file: "app/profile/page.tsx",
        line: 5,
        column: 12,
      },
    };

    expect(validateClientBoundaryExport(
      `
export default function DefaultProfile() {}
export function ProfileCard() {}
export const ProfileTabs = () => null;
export { ProfileTabs as RenamedTabs };
`,
      boundary,
    ).status).toBe("found");

    const missing = validateClientBoundaryExport(
      "export default function DefaultProfile() {}\nexport const Other = () => null;\n",
      boundary,
    );

    expect(missing.status).toBe("missing");
    expect(missing.diagnostic).toMatchObject({
      code: "MANDU_BOUNDARY_UNRESOLVED_EXPORT",
      routeId: "profile",
      boundaryId: "profile--0",
      module: "src/client/Profile.client.tsx",
      exportName: "ProfileCard",
      source: {
        file: "app/profile/page.tsx",
        line: 5,
        column: 12,
      },
    });
    expect(missing.diagnostic?.suggestion).toContain("ProfileCard");

    expect(validateClientBoundaryExport(
      'export { ProfileCard } from "./ProfileCard";\n',
      boundary,
    ).status).toBe("unknown");
  });

  it("validates server-only imports in compiler-discovered client modules", () => {
    const boundary = {
      id: "settings--0",
      routeId: "settings",
      module: "src/client/Settings.client.tsx",
      exportName: "Settings",
    };

    const diagnostics = validateClientBoundaryServerOnlyImports(
      `
import { readFile } from "node:fs/promises";
export { join as joinPath } from "path";
const lazy = () => import("node:child_process");
const required = require("os");
import { Database } from "bun:sqlite";
import { Mandu } from "@mandujs/core";
import { internal } from "@mandujs/core/compat/internal/secret";
import "server-only";
import data from "./data.server";
import type { Stats } from "node:fs";
export type { ServerShape } from "./types.server";
export function Settings() { return null; }
`,
      boundary,
      "src/client/Settings.client.tsx",
    );

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "MANDU_BOUNDARY_SERVER_ONLY_IMPORT",
      "MANDU_BOUNDARY_SERVER_ONLY_IMPORT",
      "MANDU_BOUNDARY_SERVER_ONLY_IMPORT",
      "MANDU_BOUNDARY_SERVER_ONLY_IMPORT",
      "MANDU_BOUNDARY_SERVER_ONLY_IMPORT",
      "MANDU_BOUNDARY_SERVER_ONLY_IMPORT",
      "MANDU_BOUNDARY_SERVER_ONLY_IMPORT",
      "MANDU_BOUNDARY_SERVER_ONLY_IMPORT",
      "MANDU_BOUNDARY_SERVER_ONLY_IMPORT",
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.module)).toEqual([
      "src/client/Settings.client.tsx",
      "src/client/Settings.client.tsx",
      "src/client/Settings.client.tsx",
      "src/client/Settings.client.tsx",
      "src/client/Settings.client.tsx",
      "src/client/Settings.client.tsx",
      "src/client/Settings.client.tsx",
      "src/client/Settings.client.tsx",
      "src/client/Settings.client.tsx",
    ]);
    expect(diagnostics.every((diagnostic) => diagnostic.routeId === "settings")).toBe(true);
    expect(diagnostics.every((diagnostic) => diagnostic.boundaryId === "settings--0")).toBe(true);
    expect(diagnostics.every((diagnostic) => diagnostic.suggestion.includes("server route"))).toBe(true);
  });
});

describe("__ManduClientBoundary", () => {
  it("emits boundary-local props without rendering the client module", () => {
    const html = renderToStaticMarkup(
      renderWithManduClientBoundaryManifest(
        "pledges-$id",
        {
          version: 1,
          buildTime: "2026-05-23T00:00:00.000Z",
          env: "production",
          bundles: {},
          boundaries: {
            "pledges-$id--0": {
              route: "pledges-$id",
              js: "/.mandu/client/pledges-$id--0.boundary.js",
              module: "src/client/CommentsSection.client.tsx",
              exportName: "CommentsSection",
              priority: "visible",
              hydrate: "visible",
            },
          },
          shared: {
            runtime: "/.mandu/client/_runtime.js",
            vendor: "/.mandu/client/_react.js",
          },
        },
        () => __ManduClientBoundary({
          routeId: "pledges-$id",
          boundaryId: "pledges-$id--0",
          module: "src/client/CommentsSection.client.tsx",
          exportName: "CommentsSection",
          hydrate: "visible",
          props: {
            pledgeId: "pledge-1",
            initialComments: [{ id: "c1", body: "serialized comment" }],
          },
        }),
      ),
    );

    expect(html).toContain('data-mandu-island="pledges-$id--0"');
    expect(html).toContain('data-mandu-boundary-id="pledges-$id--0"');
    expect(html).toContain('data-mandu-route-id="pledges-$id"');
    expect(html).toContain('data-mandu-src="/.mandu/client/pledges-$id--0.boundary.js?t=');
    expect(html).toContain('data-mandu-client-module="src/client/CommentsSection.client.tsx"');
    expect(html).toContain('data-mandu-client-export="CommentsSection"');
    expect(html).toContain('type="application/json"');
    expect(html).toContain('data-mandu-props="pledges-$id--0"');
    expect(html).toContain('"pledgeId":"pledge-1"');
    expect(html).toContain('"initialComments"');
  });

  it("assigns unique island instance ids when one boundary renders multiple times", () => {
    const manifest = {
      version: 1,
      buildTime: "2026-05-23T00:00:00.000Z",
      env: "production" as const,
      bundles: {},
      boundaries: {
        "feed--0": {
          route: "feed",
          js: "/.mandu/client/feed--0.boundary.js",
          module: "src/client/FeedItem.client.tsx",
          exportName: "FeedItem",
          priority: "visible" as const,
          hydrate: "visible",
        },
      },
      shared: {
        runtime: "/.mandu/client/_runtime.js",
        vendor: "/.mandu/client/_react.js",
      },
    };

    const html = renderWithManduClientBoundaryManifest("feed", manifest, () =>
      renderToStaticMarkup(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(__ManduClientBoundary, {
            routeId: "feed",
            boundaryId: "feed--0",
            module: "src/client/FeedItem.client.tsx",
            exportName: "FeedItem",
            props: { id: "a" },
          }),
          React.createElement(__ManduClientBoundary, {
            routeId: "feed",
            boundaryId: "feed--0",
            module: "src/client/FeedItem.client.tsx",
            exportName: "FeedItem",
            props: { id: "b" },
          }),
        )
      ),
    );

    expect(html).toContain('data-mandu-boundary-id="feed--0"');
    expect(html).toContain('data-mandu-island="feed--0"');
    expect(html).toContain('data-mandu-island="feed--0--1"');
    expect(html).toContain('data-mandu-props="feed--0"');
    expect(html).toContain('data-mandu-props="feed--0--1"');
    expect(html).toContain('"id":"a"');
    expect(html).toContain('"id":"b"');
  });

  it("fails runtime serialization for dynamic non-serializable boundary props", () => {
    expect(() =>
      renderToStaticMarkup(
        __ManduClientBoundary({
          routeId: "dynamic",
          boundaryId: "dynamic--0",
          module: "src/client/Dynamic.client.tsx",
          exportName: "default",
          props: {
            safe: "value",
            nested: {
              onSave: () => "not serializable",
            },
          },
        }),
      ),
    ).toThrow(/MANDU_BOUNDARY_UNSERIALIZABLE_PROP.*dynamic--0.*\$\.nested\.onSave/);
  });
});
