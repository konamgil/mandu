import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { hasRecentGenerateStamp } from "../watcher";

const tmpRoots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "mandu-watch-"));
  tmpRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

test("hasRecentGenerateStamp suppresses generated events using the root stamp", () => {
  const root = makeRoot();
  const now = 1_700_000_000_000;
  mkdirSync(join(root, ".mandu"), { recursive: true });
  writeFileSync(join(root, ".mandu", "generate.stamp"), String(now - 500));

  const generatedFile = join(
    root,
    ".mandu",
    "generated",
    "server",
    "repos",
    "notification.repo.ts",
  );

  expect(hasRecentGenerateStamp(root, generatedFile, now)).toBe(true);
});

test("hasRecentGenerateStamp does not suppress stale generated events", () => {
  const root = makeRoot();
  const now = 1_700_000_000_000;
  mkdirSync(join(root, ".mandu"), { recursive: true });
  writeFileSync(join(root, ".mandu", "generate.stamp"), String(now - 30_000));

  const generatedFile = join(root, ".mandu", "generated", "server", "old.route.ts");

  expect(hasRecentGenerateStamp(root, generatedFile, now)).toBe(false);
});

test("hasRecentGenerateStamp does not suppress source files after generation", () => {
  const root = makeRoot();
  const now = 1_700_000_000_000;
  mkdirSync(join(root, ".mandu"), { recursive: true });
  writeFileSync(join(root, ".mandu", "generate.stamp"), String(now - 500));

  const sourceFile = join(root, "app", "page.tsx");

  expect(hasRecentGenerateStamp(root, sourceFile, now)).toBe(false);
});
