import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import type { BundleManifest } from "../../bundler/types";
import type { RoutesManifest } from "../../spec/schema";
import {
  createServerRegistry,
  startServer,
  type ManduServer,
} from "../server";

const TEST_ROOT = path.resolve(process.cwd(), ".tmp-test-artifacts", "inline-client-hydration");

function hydratedManifest(routeId: string): BundleManifest {
  return {
    version: 1,
    buildTime: "2026-05-23T00:00:00.000Z",
    env: "production",
    bundles: {
      [routeId]: {
        js: `/.mandu/client/${routeId}.island.js`,
        dependencies: ["_runtime", "_react"],
        priority: "visible",
      },
    },
    shared: {
      runtime: "/.mandu/client/_runtime.js",
      vendor: "/.mandu/client/_react.js",
      router: "/.mandu/client/_router.js",
    },
  };
}

async function resetTestRoot(): Promise<void> {
  await rm(TEST_ROOT, { recursive: true, force: true });
  await mkdir(TEST_ROOT, { recursive: true });
}

afterEach(async () => {
  await rm(TEST_ROOT, { recursive: true, force: true });
});

describe("startServer inline client hydration", () => {
  it("captures component props through sync server pages and inferred named client exports", async () => {
    await resetTestRoot();

    const routeId = "pledges-$id";
    const clientModule = "src/client/widgets/comments-section/CommentsSection.client.tsx";
    const clientPath = path.join(TEST_ROOT, clientModule);
    await mkdir(path.dirname(clientPath), { recursive: true });
    await writeFile(
      clientPath,
      `
import React from "react";

export function CommentsSection({ pledgeId, initialComments }) {
  return React.createElement(
    "section",
    { "data-pledge-id": pledgeId },
    initialComments.map((comment) =>
      React.createElement("p", { key: comment.id }, comment.body)
    )
  );
}
`,
      "utf-8",
    );

    const imported = await import(`${pathToFileURL(clientPath).href}?t=${Date.now()}`);
    const CommentsSection = imported.CommentsSection as React.ComponentType<{
      pledgeId: string;
      initialComments: Array<{ id: string; body: string }>;
    }>;

    function PledgePage(): React.ReactElement {
      return React.createElement(
        "main",
        null,
        React.createElement(CommentsSection, {
          pledgeId: "pledge-1",
          initialComments: [{ id: "c1", body: "serialized comment" }],
        }),
      );
    }

    const registry = createServerRegistry();
    registry.registerRouteComponent(routeId, PledgePage);

    const manifest: RoutesManifest = {
      version: 1,
      routes: [
        {
          id: routeId,
          kind: "page",
          pattern: "/pledges/:id",
          module: "app/pledges/[id]/page.tsx",
          componentModule: "app/pledges/[id]/page.tsx",
          clientModule,
          hydration: { strategy: "island", priority: "visible", preload: false },
        },
      ],
    };

    let server: ManduServer | undefined;
    try {
      server = startServer(manifest, {
        port: 0,
        registry,
        rootDir: TEST_ROOT,
        bundleManifest: hydratedManifest(routeId),
        transitions: false,
        prefetch: false,
        spa: false,
        devtools: false,
        silent: true,
      });

      const response = await fetch(`http://127.0.0.1:${server.server.port}/pledges/pledge-1`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('data-mandu-island="pledges-$id--0"');
      expect(html).toContain('type="application/json" data-mandu-props="pledges-$id--0"');
      expect(html).toContain('"pledgeId":"pledge-1"');
      expect(html).toContain('"initialComments"');
      expect(html).toContain("serialized comment");
      expect(html).not.toContain('data-mandu-island="pledges-$id"');
    } finally {
      server?.stop();
    }
  });
});
