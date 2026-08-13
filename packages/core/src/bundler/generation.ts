/**
 * Atomic client-build generations.
 *
 * A build never writes into the directory currently served by the runtime.
 * It starts from a snapshot of the active generation, builds in staging, and
 * publishes by replacing one small pointer file only after every bundle and
 * the bundle manifest are valid.
 */

import path from "path";
import fs from "fs/promises";
import type { BundleManifest } from "./types";

const SCHEMA_VERSION = 1 as const;
const GENERATIONS_DIR = "generations";
const ACTIVE_POINTER_FILE = "active-generation.json";
const BUILD_STATE_FILE = "build-state.json";
const STAGING_DIR = path.join(".staging", "client-builds");
const GENERATION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{5,127}$/;
const GENERATIONS_TO_KEEP = 3;

export interface BuildGenerationPointer {
  schemaVersion: typeof SCHEMA_VERSION;
  generationId: string;
  publishedAt: string;
}

export interface BuildGenerationAttempt {
  schemaVersion: typeof SCHEMA_VERSION;
  activeGenerationId: string | null;
  lastAttempt: {
    generationId: string;
    status: "building" | "failed" | "published";
    startedAt: string;
    completedAt?: string;
    errors?: string[];
  };
}

export interface BuildGeneration {
  id: string;
  rootDir: string;
  startedAt: string;
  stagingRoot: string;
  clientDir: string;
  manifestPath: string;
  finalRoot: string;
}

export interface ActiveBuildArtifacts {
  generationId: string | null;
  clientDir: string;
  manifestPath: string;
  source: "generation" | "legacy";
}

const activeArtifactsCache = new Map<string, ActiveBuildArtifacts>();
const buildQueues = new Map<string, Promise<void>>();

function manduDir(rootDir: string): string {
  return path.join(path.resolve(rootDir), ".mandu");
}

function activePointerPath(rootDir: string): string {
  return path.join(manduDir(rootDir), ACTIVE_POINTER_FILE);
}

function buildStatePath(rootDir: string): string {
  return path.join(manduDir(rootDir), BUILD_STATE_FILE);
}

function generationRoot(rootDir: string, generationId: string): string {
  return path.join(manduDir(rootDir), GENERATIONS_DIR, generationId);
}

function createGenerationId(): string {
  const timestamp = Date.now().toString(36);
  const pid = process.pid.toString(36);
  const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${timestamp}-${pid}-${nonce}`;
}

function isMissing(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function atomicWriteFile(target: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const token = `${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const temporary = `${target}.${token}.tmp`;
  const backup = `${target}.${token}.bak`;
  await fs.writeFile(temporary, content, "utf8");

  try {
    await fs.rename(temporary, target);
    return;
  } catch (error) {
    // Some Windows filesystems do not replace an existing destination via
    // rename. Fall back to a guarded old -> backup -> new handoff.
    if (!(await pathExists(target))) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  await fs.rename(target, backup);
  try {
    await fs.rename(temporary, target);
    await fs.rm(backup, { force: true });
  } catch (error) {
    await fs.rm(target, { force: true }).catch(() => {});
    await fs.rename(backup, target).catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function atomicWriteJson(target: string, value: unknown): Promise<void> {
  await atomicWriteFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

function parsePointer(raw: string): BuildGenerationPointer | null {
  try {
    const parsed = JSON.parse(raw) as Partial<BuildGenerationPointer>;
    if (
      parsed.schemaVersion !== SCHEMA_VERSION ||
      typeof parsed.generationId !== "string" ||
      !GENERATION_ID_PATTERN.test(parsed.generationId) ||
      typeof parsed.publishedAt !== "string"
    ) {
      return null;
    }
    return parsed as BuildGenerationPointer;
  } catch {
    return null;
  }
}

export async function readActiveBuildGeneration(
  rootDir: string,
): Promise<BuildGenerationPointer | null> {
  try {
    const raw = await fs.readFile(activePointerPath(rootDir), "utf8");
    return parsePointer(raw);
  } catch (error) {
    if (!isMissing(error)) {
      console.warn(
        `[Mandu] Could not read active build generation: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return null;
  }
}

export async function resolveActiveBuildArtifacts(
  rootDir: string,
): Promise<ActiveBuildArtifacts> {
  const resolvedRoot = path.resolve(rootDir);
  const cached = activeArtifactsCache.get(resolvedRoot);
  const pointer = await readActiveBuildGeneration(resolvedRoot);
  if (cached && cached.generationId === (pointer?.generationId ?? null)) return cached;
  if (pointer) {
    const root = generationRoot(resolvedRoot, pointer.generationId);
    const clientDir = path.join(root, "client");
    const manifestPath = path.join(root, "manifest.json");
    if ((await pathExists(clientDir)) && (await pathExists(manifestPath))) {
      const artifacts: ActiveBuildArtifacts = {
        generationId: pointer.generationId,
        clientDir,
        manifestPath,
        source: "generation",
      };
      activeArtifactsCache.set(resolvedRoot, artifacts);
      return artifacts;
    }
  }

  const fallback: ActiveBuildArtifacts = {
    generationId: null,
    clientDir: path.join(manduDir(resolvedRoot), "client"),
    manifestPath: path.join(manduDir(resolvedRoot), "manifest.json"),
    source: "legacy",
  };
  activeArtifactsCache.set(resolvedRoot, fallback);
  return fallback;
}

export async function resolveActiveClientDirectory(rootDir: string): Promise<string> {
  return (await resolveActiveBuildArtifacts(rootDir)).clientDir;
}

export async function resolveBuildGenerationClientDirectory(
  rootDir: string,
  generationId: string,
): Promise<string | null> {
  if (!GENERATION_ID_PATTERN.test(generationId)) return null;
  const clientDir = path.join(generationRoot(rootDir, generationId), "client");
  return (await pathExists(clientDir)) ? clientDir : null;
}

export function scopeClientAssetUrl(url: string, generationId?: string): string {
  if (!generationId || !GENERATION_ID_PATTERN.test(generationId)) return url;
  if (!url.startsWith("/.mandu/client/") || /(?:\?|&)g=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}g=${generationId}`;
}

/**
 * Produce a response-local manifest whose client URLs are pinned to one
 * immutable generation. The on-disk manifest stays query-free so its strict
 * security schema and disk analyzers keep a simple canonical path shape.
 */
export function scopeBundleManifestToGeneration(
  manifest: BundleManifest | undefined,
): BundleManifest | undefined {
  const generationId = manifest?.generationId;
  if (!manifest || !generationId || !GENERATION_ID_PATTERN.test(generationId)) return manifest;
  const scope = (url: string): string => scopeClientAssetUrl(url, generationId);

  return {
    ...manifest,
    bundles: Object.fromEntries(
      Object.entries(manifest.bundles).map(([id, bundle]) => [
        id,
        { ...bundle, js: scope(bundle.js), ...(bundle.css ? { css: scope(bundle.css) } : {}) },
      ]),
    ),
    ...(manifest.islands
      ? {
          islands: Object.fromEntries(
            Object.entries(manifest.islands).map(([id, island]) => [
              id,
              { ...island, js: scope(island.js) },
            ]),
          ),
        }
      : {}),
    ...(manifest.partials
      ? {
          partials: Object.fromEntries(
            Object.entries(manifest.partials).map(([id, partial]) => [
              id,
              { ...partial, js: scope(partial.js) },
            ]),
          ),
        }
      : {}),
    ...(manifest.boundaries
      ? {
          boundaries: Object.fromEntries(
            Object.entries(manifest.boundaries).map(([id, boundary]) => [
              id,
              { ...boundary, js: scope(boundary.js) },
            ]),
          ),
        }
      : {}),
    shared: {
      ...manifest.shared,
      runtime: scope(manifest.shared.runtime),
      vendor: scope(manifest.shared.vendor),
      ...(manifest.shared.router ? { router: scope(manifest.shared.router) } : {}),
      ...(manifest.shared.fastRefresh
        ? {
            fastRefresh: {
              runtime: scope(manifest.shared.fastRefresh.runtime),
              glue: scope(manifest.shared.fastRefresh.glue),
            },
          }
        : {}),
    },
    ...(manifest.importMap
      ? {
          importMap: {
            imports: Object.fromEntries(
              Object.entries(manifest.importMap.imports).map(([specifier, url]) => [
                specifier,
                scope(url),
              ]),
            ),
          },
        }
      : {}),
  };
}

async function writeAttemptState(
  generation: BuildGeneration,
  status: BuildGenerationAttempt["lastAttempt"]["status"],
  errors?: readonly string[],
): Promise<void> {
  const active = await readActiveBuildGeneration(generation.rootDir);
  const state: BuildGenerationAttempt = {
    schemaVersion: SCHEMA_VERSION,
    activeGenerationId: status === "published" ? generation.id : active?.generationId ?? null,
    lastAttempt: {
      generationId: generation.id,
      status,
      startedAt: generation.startedAt,
      ...(status === "building" ? {} : { completedAt: new Date().toISOString() }),
      ...(errors && errors.length > 0
        ? { errors: errors.slice(0, 50).map((error) => error.slice(0, 2000)) }
        : {}),
    },
  };
  await atomicWriteJson(buildStatePath(generation.rootDir), state);
}

export async function beginBuildGeneration(rootDir: string): Promise<BuildGeneration> {
  const resolvedRoot = path.resolve(rootDir);
  const id = createGenerationId();
  const stagingRoot = path.join(manduDir(resolvedRoot), STAGING_DIR, id);
  const clientDir = path.join(stagingRoot, "client");
  const generation: BuildGeneration = {
    id,
    rootDir: resolvedRoot,
    startedAt: new Date().toISOString(),
    stagingRoot,
    clientDir,
    manifestPath: path.join(stagingRoot, "manifest.json"),
    finalRoot: generationRoot(resolvedRoot, id),
  };

  await fs.mkdir(clientDir, { recursive: true });
  const active = await resolveActiveBuildArtifacts(resolvedRoot);
  if (await pathExists(active.clientDir)) {
    await fs.cp(active.clientDir, clientDir, { recursive: true, force: true });
  }
  if (await pathExists(active.manifestPath)) {
    await fs.copyFile(active.manifestPath, generation.manifestPath);
  }
  await writeAttemptState(generation, "building");
  return generation;
}

async function restoreCompatibilityClient(
  legacyClient: string,
  backupClient: string,
  hadLegacyClient: boolean,
): Promise<void> {
  await fs.rm(legacyClient, { recursive: true, force: true }).catch(() => {});
  if (hadLegacyClient && (await pathExists(backupClient))) {
    await fs.rename(backupClient, legacyClient);
  }
}

async function publishCompatibilityArtifacts(generation: BuildGeneration): Promise<{
  backupClient: string;
  hadLegacyClient: boolean;
  oldManifest: string | null;
}> {
  const base = manduDir(generation.rootDir);
  const legacyClient = path.join(base, "client");
  const legacyManifest = path.join(base, "manifest.json");
  const compatibilityClient = path.join(base, ".staging", `compat-client-${generation.id}`);
  const backupClient = path.join(base, ".staging", `previous-client-${generation.id}`);
  const finalClient = path.join(generation.finalRoot, "client");
  const finalManifest = path.join(generation.finalRoot, "manifest.json");

  await fs.rm(compatibilityClient, { recursive: true, force: true });
  await fs.cp(finalClient, compatibilityClient, { recursive: true, force: true });

  const hadLegacyClient = await pathExists(legacyClient);
  const oldManifest = await fs.readFile(legacyManifest, "utf8").catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });

  if (hadLegacyClient) {
    await fs.rm(backupClient, { recursive: true, force: true });
    await fs.rename(legacyClient, backupClient);
  }

  try {
    await fs.rename(compatibilityClient, legacyClient);
    const nextManifest = await fs.readFile(finalManifest, "utf8");
    await atomicWriteFile(legacyManifest, nextManifest);
    return { backupClient, hadLegacyClient, oldManifest };
  } catch (error) {
    await restoreCompatibilityClient(legacyClient, backupClient, hadLegacyClient);
    if (oldManifest === null) {
      await fs.rm(legacyManifest, { force: true }).catch(() => {});
    } else {
      await atomicWriteFile(legacyManifest, oldManifest).catch(() => {});
    }
    await fs.rm(compatibilityClient, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function pruneOldGenerations(rootDir: string, activeId: string): Promise<void> {
  const dir = path.join(manduDir(rootDir), GENERATIONS_DIR);
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory() && GENERATION_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));
  const keep = new Set([activeId, ...candidates.slice(0, GENERATIONS_TO_KEEP)]);
  await Promise.all(
    candidates
      .filter((id) => !keep.has(id))
      .map((id) => fs.rm(path.join(dir, id), { recursive: true, force: true }).catch(() => {})),
  );
}

export async function publishBuildGeneration(
  generation: BuildGeneration,
): Promise<BuildGenerationPointer> {
  if (!(await pathExists(generation.clientDir)) || !(await pathExists(generation.manifestPath))) {
    throw new Error(`Build generation ${generation.id} is incomplete and cannot be published.`);
  }

  await fs.mkdir(path.dirname(generation.finalRoot), { recursive: true });
  await fs.rename(generation.stagingRoot, generation.finalRoot);

  const legacyClient = path.join(manduDir(generation.rootDir), "client");
  const legacyManifest = path.join(manduDir(generation.rootDir), "manifest.json");
  let compatibility:
    | { backupClient: string; hadLegacyClient: boolean; oldManifest: string | null }
    | undefined;

  try {
    compatibility = await publishCompatibilityArtifacts(generation);
    const pointer: BuildGenerationPointer = {
      schemaVersion: SCHEMA_VERSION,
      generationId: generation.id,
      publishedAt: new Date().toISOString(),
    };
    await atomicWriteJson(activePointerPath(generation.rootDir), pointer);

    const artifacts: ActiveBuildArtifacts = {
      generationId: generation.id,
      clientDir: path.join(generation.finalRoot, "client"),
      manifestPath: path.join(generation.finalRoot, "manifest.json"),
      source: "generation",
    };
    activeArtifactsCache.set(path.resolve(generation.rootDir), artifacts);
    await fs.rm(compatibility.backupClient, { recursive: true, force: true }).catch(() => {});
    await writeAttemptState(generation, "published").catch((error) => {
      console.warn(
        `[Mandu] Build generation ${generation.id} published but state recording failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
    void pruneOldGenerations(generation.rootDir, generation.id);
    return pointer;
  } catch (error) {
    if (compatibility) {
      await restoreCompatibilityClient(
        legacyClient,
        compatibility.backupClient,
        compatibility.hadLegacyClient,
      ).catch(() => {});
      if (compatibility.oldManifest === null) {
        await fs.rm(legacyManifest, { force: true }).catch(() => {});
      } else {
        await atomicWriteFile(legacyManifest, compatibility.oldManifest).catch(() => {});
      }
    }
    await fs.rm(generation.finalRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function failBuildGeneration(
  generation: BuildGeneration,
  errors: readonly string[],
): Promise<void> {
  await writeAttemptState(generation, "failed", errors).catch((error) => {
    console.warn(
      `[Mandu] Could not record failed build generation ${generation.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
  await fs.rm(generation.stagingRoot, { recursive: true, force: true }).catch(() => {});
}

export function runSerializedClientBuild<T>(rootDir: string, task: () => Promise<T>): Promise<T> {
  const key = path.resolve(rootDir);
  const previous = buildQueues.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  buildQueues.set(key, tail);
  void tail.finally(() => {
    if (buildQueues.get(key) === tail) buildQueues.delete(key);
  });
  return run;
}

/** Test-only cache reset. */
export function __clearBuildGenerationCacheForTests(): void {
  activeArtifactsCache.clear();
  buildQueues.clear();
}
