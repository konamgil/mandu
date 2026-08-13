/**
 * Collection API (Issue #199)
 *
 * First-class content collection primitive inspired by Astro's
 * `astro:content` + Next.js `@next/mdx` + Fumadocs. Projects declare
 * collections once in `content.config.ts`, then read them anywhere
 * with full typed autocomplete:
 *
 * ```ts
 * // content.config.ts
 * import { defineCollection, z } from '@mandujs/core/compat/content/index';
 *
 * export const docs = defineCollection({
 *   path: 'content/docs',
 *   schema: z.object({
 *     title: z.string(),
 *     order: z.number().optional(),
 *     draft: z.boolean().default(false),
 *   }),
 * });
 * ```
 *
 * ```ts
 * // anywhere in the app
 * import { docs } from './content.config';
 *
 * const entries = await docs.all();
 * const intro = await docs.get('intro');
 * ```
 *
 * # Overload compatibility
 *
 * The legacy `defineCollection({ loader, schema })` shape (used by the
 * existing ContentLayer in `content-layer.ts`) is still supported — we
 * detect the shape at runtime and pass config through unchanged. Only
 * the NEW `{ path, schema, ... }` shape returns a `Collection` instance
 * with `.load()/.all()/.get()/.getCompiled()`. This matters because the
 * CLI `mandu collection create` scaffolder already emits the legacy
 * shape, and breaking those projects on a minor version is not an
 * option for the MVP.
 */

import * as fs from "fs";
import * as path from "path";
import type { ZodSchema } from "zod";
import { parseFrontmatter } from "./frontmatter";
import { slugFromPath, type SlugFromPathOptions } from "./slug";

/** A single entry in a Collection after frontmatter + Zod validation. */
export interface CollectionEntry<T = Record<string, unknown>> {
  /** URL-safe slug derived from the file path (see `slugFromPath`). */
  slug: string;
  /** Absolute filesystem path of the source file. */
  filePath: string;
  /** Validated frontmatter data. */
  data: T;
  /** Raw markdown/MDX body (everything after the closing `---`). */
  content: string;
}

/** A compiled MDX entry with a lazy-rendered React component. */
export interface CompiledCollectionEntry<T = Record<string, unknown>>
  extends CollectionEntry<T> {
  /**
   * Rendered component. Falls back to a raw-markdown `<pre>` shell
   * when MDX-compiling tools (`unified`, `remark-*`, `rehype-*`) are
   * not installed — the wrapper always returns SOMETHING so callers
   * don't have to branch on "is MDX tooling present".
   */
  Component: () => unknown;
  /** Rendered HTML string (only populated when MDX tooling is available). */
  html?: string;
  /**
   * Diagnostic info describing which pipeline produced `Component`.
   *
   *   - `"unified"`  — the full `unified + remark + rehype` chain ran.
   *     `html` is populated, `Component` wraps it via
   *     `dangerouslySetInnerHTML`.
   *   - `"fallback-missing-deps"` — one or more optional MDX deps were
   *     absent. `Component` returns a `<pre>` shell.
   *   - `"fallback-pipeline-error"` — deps loaded but the pipeline
   *     threw; `Component` returns a `<pre>` shell with `error` set.
   */
  compilationMode: "unified" | "fallback-missing-deps" | "fallback-pipeline-error";
  /** The pipeline error when `compilationMode === "fallback-pipeline-error"`. */
  error?: Error;
}

/**
 * Compile-time options forwarded to `getCompiled()`. All fields are
 * optional; supplying any of the `*Plugins` arrays triggers the
 * `unified + remark-parse + remark-rehype + rehype-stringify` pipeline
 * (when the deps are installed).
 *
 * The plugins arrays are typed as `unknown[]` because the optional MDX
 * ecosystem does not carry types into `@mandujs/core`. Consumers pass
 * whatever their plugin entry exports — typically a function or a
 * `[plugin, options]` tuple.
 */
export interface CompileOptions {
  /** Extra remark plugins applied BEFORE `remark-rehype`. */
  remarkPlugins?: unknown[];
  /** Extra rehype plugins applied AFTER `remark-rehype`. */
  rehypePlugins?: unknown[];
  /**
   * When true, suppress the warning emitted when optional MDX deps
   * are missing and the function falls back to a `<pre>` shell.
   * Use this in build scripts where you deliberately do not install
   * the MDX toolchain. Default: false.
   */
  silent?: boolean;
}

/**
 * Callback invoked by `Collection.watch()` on every filesystem event
 * that could affect the collection. The handler is called with a
 * shallow describe object so consumers can decide whether to
 * `collection.invalidate()` and re-render, or skip (e.g. when the
 * event targets a file outside the `extensions` allow-list).
 *
 * The watcher intentionally does NOT call `invalidate()` itself —
 * callers typically know when to force a reload (debounce, batch with
 * other changes) and the library staying hands-off matches how
 * `chokidar`-style APIs behave in the wild.
 */
export type CollectionWatchHandler = (event: {
  type: "change" | "rename";
  filePath: string;
}) => void;

/** Control handle returned by `Collection.watch()`. */
export interface CollectionWatchHandle {
  /** Stop listening to this watcher. Idempotent. */
  unsubscribe(): void;
}

/**
 * Compare function for sorting `CollectionEntry` instances. Matches the
 * TS `Array.sort` signature so users can compose their own comparators.
 */
export type CollectionSort<T> = (
  a: CollectionEntry<T>,
  b: CollectionEntry<T>
) => number;

/**
 * Options accepted by the MVP `defineCollection({ path, ... })` form.
 */
export interface DefineCollectionOptions<T> {
  /**
   * Directory (relative to the project root, unless absolute) that
   * holds the collection's source files. Glob patterns are NOT
   * supported at the MVP — use one collection per directory. The
   * collection scans this directory recursively for markdown files.
   */
  path: string;
  /**
   * Zod schema for frontmatter validation. When omitted, entries are
   * returned with `data: Record<string, unknown>` and no type safety
   * — useful for prototypes before the shape stabilizes.
   */
  schema?: ZodSchema<T>;
  /**
   * File extensions to include (default: `.md`, `.mdx`, `.markdown`).
   * Caller values should include the leading dot.
   */
  extensions?: string[];
  /**
   * Override slug generation. Receives the collection-relative path
   * (forward slashes) and the parsed frontmatter so authors can force
   * a specific slug via `slug:` in frontmatter, fall back to `title`,
   * etc. Return the resolved slug string.
   */
  slug?: (entry: {
    path: string;
    data: Record<string, unknown>;
  }) => string;
  /**
   * Slug normalization options (forwarded to `slugFromPath`) for the
   * default slug generator. Ignored when a custom `slug` callback is
   * provided.
   */
  slugOptions?: SlugFromPathOptions;
  /**
   * Default sort applied by `.all()`. The framework applies a stable
   * fallback-by-slug tiebreaker on top of whatever the caller returns
   * so repeated loads always yield the same order. When absent, the
   * collection sorts by `data.order` ascending (missing = +Infinity),
   * then by slug alphabetical — matching the `generateSidebar`
   * helper's default.
   */
  sort?: CollectionSort<T>;
  /**
   * Project root override. Normally the Collection resolves `path`
   * against `process.cwd()` lazily at `.load()` time; passing this
   * pins the root for tests or tooling contexts where cwd is unstable.
   */
  root?: string;
}

/** Legacy config shape — preserved to avoid churn on existing projects. */
interface LegacyCollectionConfig {
  loader: unknown;
  schema?: unknown;
}

const DEFAULT_EXTENSIONS = [".md", ".mdx", ".markdown"] as const;

/**
 * Collection instance returned by `defineCollection({ path, ... })`.
 *
 * # Caching
 *
 * Load results are cached in-memory after the first `.load()` call.
 * This is intentional — at the MVP we treat collections as build-time
 * data that doesn't change within a process lifetime. Call
 * `.invalidate()` to force a rescan.
 *
 * # Watcher lifecycle (Issue #204 — critical)
 *
 * **Default: zero watchers.** `all()`, `get()`, and `getCompiled()`
 * do NOT open any `fs.watch` handle. Build scripts like
 * `scripts/prebuild-docs.ts` can run `await docs.all()` and the
 * process will exit cleanly — no active handles left to pin the
 * event loop.
 *
 * **Opt-in via `watch()`**: dev-mode tooling that wants change
 * notifications calls `const handle = collection.watch(cb)`. This
 * opens ONE `fs.watch` handle per collection (not per file), so the
 * cost is bounded regardless of collection size.
 *
 * **Cleanup**: user code either calls `handle.unsubscribe()` or
 * `await collection[Symbol.asyncDispose]()` (ES2023 `using`
 * semantics). Either path closes every open watcher so the process
 * exits.
 */
export class Collection<T = Record<string, unknown>> {
  readonly options: DefineCollectionOptions<T>;
  private entries: CollectionEntry<T>[] | null = null;
  private loadPromise: Promise<CollectionEntry<T>[]> | null = null;
  /**
   * Active `fs.watch` handles — one per `watch()` call. Stored so
   * `dispose()` can close every handle regardless of whether the
   * user tracked the returned `unsubscribe` callback.
   */
  private watchHandles: Set<{ close: () => void }> = new Set();

  constructor(options: DefineCollectionOptions<T>) {
    this.options = options;
    // Register so dev-mode tooling (`getRegisteredCollections()` + the
    // bundler's content watcher) can invalidate every collection on a
    // filesystem add/unlink without each project wiring `.watch()` by
    // hand. The set is module-scoped; every Collection constructed in
    // this process joins automatically.
    collectionRegistry.add(this as Collection<unknown>);
  }

  /** Resolve the collection root directory. */
  private resolveRoot(): string {
    const root = this.options.root ?? process.cwd();
    if (path.isAbsolute(this.options.path)) return this.options.path;
    return path.resolve(root, this.options.path);
  }

  /**
   * Scan the collection directory, parse frontmatter, validate with
   * the Zod schema, and cache entries. Safe to call repeatedly — the
   * first call's promise is reused by concurrent callers, so a burst
   * of `.all()` / `.get()` calls during initial render won't produce
   * redundant disk I/O.
   */
  async load(): Promise<CollectionEntry<T>[]> {
    if (this.entries) return this.entries;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.doLoad();
    try {
      this.entries = await this.loadPromise;
      return this.entries;
    } finally {
      this.loadPromise = null;
    }
  }

  private async doLoad(): Promise<CollectionEntry<T>[]> {
    const root = this.resolveRoot();
    if (!fs.existsSync(root)) {
      // An empty collection is a valid state — authors might scaffold
      // the directory before adding entries. Returning `[]` here lets
      // pages render with "no content yet" messaging instead of 500.
      return [];
    }
    const extensions = this.options.extensions ?? [...DEFAULT_EXTENSIONS];
    const extSet = new Set(extensions.map((e) => e.toLowerCase()));
    const absPaths: string[] = [];
    walkDir(root, absPaths, extSet);

    const entries: CollectionEntry<T>[] = [];
    for (const absPath of absPaths) {
      const relPath = path
        .relative(root, absPath)
        .replace(/\\/g, "/");
      const src = fs.readFileSync(absPath, "utf8");
      let parsed;
      try {
        parsed = parseFrontmatter(src);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `[content] failed to parse frontmatter in ${relPath}: ${msg}`,
          { cause: err }
        );
      }
      // Derive slug via the user's override or the built-in kebab-case
      // generator. We pass the parsed frontmatter in so authors can
      // honor a `slug:` field without writing their own loader.
      const rawSlug = this.options.slug
        ? this.options.slug({ path: relPath, data: parsed.data })
        : typeof parsed.data.slug === "string" && parsed.data.slug.length > 0
          ? String(parsed.data.slug)
          : slugFromPath(relPath, this.options.slugOptions);

      let data = parsed.data as unknown as T;
      if (this.options.schema) {
        const result = this.options.schema.safeParse(parsed.data);
        if (!result.success) {
          throw new Error(
            `[content] schema validation failed for ${relPath}: ${formatZodError(
              result.error
            )}`
          );
        }
        data = result.data;
      }
      entries.push({
        slug: rawSlug,
        filePath: absPath,
        data,
        content: parsed.body,
      });
    }

    const sorter = this.options.sort ?? defaultSort<T>();
    // Stable sort by applying a slug tiebreaker AFTER the user sort.
    // Node's Array.sort is stable as of V8 7.0+ (Bun uses V8), but we
    // prefer not to rely on user comparators returning 0 for
    // equivalent entries, so we fold the tiebreaker into the key.
    entries.sort((a, b) => {
      const primary = sorter(a, b);
      if (primary !== 0) return primary;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
    return entries;
  }

  /** Return all entries (cached). */
  async all(): Promise<CollectionEntry<T>[]> {
    return this.load();
  }

  /** Retrieve a single entry by slug, or undefined. */
  async get(slug: string): Promise<CollectionEntry<T> | undefined> {
    const entries = await this.load();
    return entries.find((e) => e.slug === slug);
  }

  /**
   * Return an entry with a lazy-rendered React component.
   *
   * When optional MDX tooling (`unified`, `remark-parse`, `remark-rehype`,
   * `rehype-stringify`) is present in the user's deps, we pipe the body
   * through it and return both the raw HTML and a React component that
   * renders via `dangerouslySetInnerHTML` (safe because the source is
   * build-time content the project controls). When tooling is absent,
   * `Component` still returns a valid React element — a `<pre>` wrapper
   * around the raw markdown — so callers never have to branch on the
   * missing-dep case.
   *
   * # Plugin support (Issue #205)
   *
   * Pass `{ remarkPlugins, rehypePlugins }` to extend the pipeline
   * — e.g. `rehype-slug`, `rehype-autolink-headings`, `shiki` for
   * syntax highlighting. Plugins are applied in array order, remark
   * plugins before `remark-rehype` and rehype plugins after.
   *
   * # Diagnostics (Issue #205)
   *
   * The returned entry includes a `compilationMode` discriminator
   * so callers can tell whether the full pipeline ran or the fallback
   * was used. When a dep is missing we emit a single-line warning
   * (unless `silent: true`) naming which module could not be
   * resolved — previously the fallback was silent, which made it
   * impossible to diagnose why a `<pre>` appeared.
   */
  async getCompiled(
    slug: string,
    compileOptions: CompileOptions = {}
  ): Promise<CompiledCollectionEntry<T> | undefined> {
    const entry = await this.get(slug);
    if (!entry) return undefined;
    const rendered = await renderMarkdownSafe(entry.content, compileOptions);
    const compiled: CompiledCollectionEntry<T> = {
      ...entry,
      Component: rendered.Component,
      compilationMode: rendered.mode,
    };
    if (rendered.html !== undefined) compiled.html = rendered.html;
    if (rendered.error !== undefined) compiled.error = rendered.error;
    return compiled;
  }

  /**
   * Reset the in-memory cache so the next `.load()` rescans disk.
   * Used by tests and (eventually) the dev-mode file watcher.
   */
  invalidate(): void {
    this.entries = null;
  }

  /**
   * Subscribe to filesystem events for this collection's root
   * directory. The watcher is lazy — created here, not in the
   * constructor — so callers who never call `watch()` pay no cost
   * and their process exits cleanly after `all()`.
   *
   * The callback is invoked with a `{ type, filePath }` object
   * where `filePath` is relative to the collection root. The
   * caller typically calls `collection.invalidate()` in response
   * and re-renders.
   *
   * Returns a handle with `unsubscribe()`. You can call that
   * directly, or call `collection.dispose()` / use `await using`
   * (ES2023) to close every watcher at once.
   */
  watch(handler: CollectionWatchHandler): CollectionWatchHandle {
    const root = this.resolveRoot();
    if (!fs.existsSync(root)) {
      // Nothing to watch — return a no-op handle so callers don't
      // have to branch on "directory exists". If the directory
      // appears later, they can unsubscribe and re-watch.
      return { unsubscribe: () => {} };
    }
    const extensions = this.options.extensions ?? [...DEFAULT_EXTENSIONS];
    const extSet = new Set(extensions.map((e) => e.toLowerCase()));

    // Use node's `fs.watch` directly — one handle per collection
    // root. `recursive: true` is the expensive bit; it is not
    // supported on Linux before kernel 5.0 but the dev-mode path
    // targets macOS/Windows/recent Linux where it works. If a
    // project needs stricter compatibility, they can wrap
    // `chokidar` in user code and call `invalidate()` themselves.
    let watcher: fs.FSWatcher;
    try {
      watcher = fs.watch(root, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const normalized = String(filename).replace(/\\/g, "/");
        // Filter by extension so unrelated files don't fire the
        // callback. We still let the event propagate for rename
        // events on directories (no extension) — those can affect
        // slugs.
        const lastDot = normalized.lastIndexOf(".");
        const ext = lastDot >= 0 ? normalized.slice(lastDot).toLowerCase() : "";
        if (ext && !extSet.has(ext)) return;
        try {
          handler({
            type: eventType === "rename" ? "rename" : "change",
            filePath: normalized,
          });
        } catch (err) {
          // Swallow user-handler errors so one buggy consumer
          // does not tear down the watcher for everyone else.
          console.error(
            `[content] watch handler threw for ${normalized}:`,
            err instanceof Error ? err.message : err
          );
        }
      });
    } catch (err) {
      // Some platforms (notably older Linux) don't support
      // `recursive: true`. Log once and return a no-op handle so
      // the caller's code continues — missing-reload is
      // degradation, not breakage.
      console.warn(
        `[content] fs.watch(${root}) failed — hot reload disabled for this collection:`,
        err instanceof Error ? err.message : err
      );
      return { unsubscribe: () => {} };
    }

    const entry = { close: () => watcher.close() };
    this.watchHandles.add(entry);

    return {
      unsubscribe: () => {
        if (!this.watchHandles.has(entry)) return;
        this.watchHandles.delete(entry);
        try {
          watcher.close();
        } catch {
          // Already closed — ignore.
        }
      },
    };
  }

  /**
   * Close every active watcher opened by `.watch()`. Safe to call
   * repeatedly. After `dispose()` the collection remains usable
   * — calling `watch()` again creates a fresh handle.
   */
  dispose(): void {
    for (const handle of this.watchHandles) {
      try {
        handle.close();
      } catch {
        // Handle already closed — ignore.
      }
    }
    this.watchHandles.clear();
  }

  /**
   * ES2023 async-dispose support. Enables:
   *
   *   ```ts
   *   await using docs = defineCollection({ path: 'content/docs' });
   *   const unsubscribe = docs.watch(onChange);
   *   // ... work ...
   *   // docs[Symbol.asyncDispose]() runs automatically at scope exit
   *   ```
   *
   * The async variant is used (instead of sync `Symbol.dispose`)
   * because real watchers in the ecosystem close asynchronously
   * — we keep the signature future-proof even though `fs.watch`
   * happens to close synchronously today.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    this.dispose();
  }
}

/**
 * Default comparator: `data.order` ascending, with missing order
 * treated as infinity so numbered entries sink to the top.
 */
function defaultSort<T>(): CollectionSort<T> {
  return (a, b) => {
    const oa = (a.data as { order?: unknown })?.order;
    const ob = (b.data as { order?: unknown })?.order;
    const na = typeof oa === "number" ? oa : Number.POSITIVE_INFINITY;
    const nb = typeof ob === "number" ? ob : Number.POSITIVE_INFINITY;
    if (na !== nb) return na - nb;
    return 0;
  };
}

/**
 * Compact a Zod error into a single line suitable for the error
 * messages surfaced by `Collection.load()`. We deliberately avoid
 * `z.prettifyError` (not present in Zod 3) and the flattener —
 * `issue.path` + `issue.message` is enough for docs authors to
 * locate the broken field fast.
 */
function formatZodError(error: {
  issues: Array<{ path: (string | number)[]; message: string }>;
}): string {
  return error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/**
 * Synchronous recursive directory walker — the collection typically
 * has a bounded number of entries (dozens to low thousands) so the
 * sync cost is negligible, and using sync simplifies error paths
 * and the cache-hit fast-path in `load()`.
 */
function walkDir(dir: string, out: string[], extSet: Set<string>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(absPath, out, extSet);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!extSet.has(ext)) continue;
    out.push(absPath);
  }
}

/** Internal result type from `renderMarkdownSafe`. */
interface RenderedMarkdown {
  html?: string;
  Component: () => unknown;
  mode: CompiledCollectionEntry<unknown>["compilationMode"];
  error?: Error;
}

/**
 * Lazy markdown renderer. Attempts to load `unified` + the standard
 * remark/rehype plugin chain; when any piece is missing, falls back
 * to returning a `<pre>` shell so the caller gets a stable API.
 *
 * We use a variable dynamic import so TS doesn't resolve the optional
 * modules during typecheck — they are NOT in `@mandujs/core` deps by design.
 *
 * The `options.remarkPlugins` / `options.rehypePlugins` arrays let
 * docs sites add `rehype-slug`, `rehype-autolink-headings`, `shiki`,
 * etc. — the caller is responsible for installing those modules.
 */
async function renderMarkdownSafe(
  body: string,
  options: CompileOptions = {}
): Promise<RenderedMarkdown> {
  const { remarkPlugins = [], rehypePlugins = [], silent = false } = options;

  const tryImport = async (id: string): Promise<unknown> => {
    try {
      return await import(id);
    } catch {
      return null;
    }
  };

  const unified = (await tryImport("unified")) as
    | { unified: () => unknown }
    | null;
  const remarkParse = (await tryImport("remark-parse")) as
    | { default: unknown }
    | null;
  const remarkRehype = (await tryImport("remark-rehype")) as
    | { default: unknown }
    | null;
  const rehypeStringify = (await tryImport("rehype-stringify")) as
    | { default: unknown }
    | null;

  // Collect the names of missing modules so the warning is
  // actionable — a generic "MDX tooling not installed" is hard to
  // act on when you DO have some of it installed.
  const missing: string[] = [];
  if (!unified) missing.push("unified");
  if (!remarkParse) missing.push("remark-parse");
  if (!remarkRehype) missing.push("remark-rehype");
  if (!rehypeStringify) missing.push("rehype-stringify");

  if (missing.length === 0 && unified && remarkParse && remarkRehype && rehypeStringify) {
    try {
      type Processor = {
        use: (plugin: unknown, options?: unknown) => Processor;
        process: (src: string) => Promise<{ toString: () => string }>;
      };
      // Type-punned unified chain — optional peer deps don't carry
      // their own types into our graph, so we route through `unknown`.
      let chain = unified.unified() as unknown as Processor;
      chain = chain.use(remarkParse.default);
      // User-supplied remark plugins run between `remark-parse`
      // and `remark-rehype` so they can transform the MDAST.
      for (const plugin of remarkPlugins) {
        chain = applyPlugin(chain, plugin);
      }
      chain = chain.use(remarkRehype.default);
      // Rehype plugins run AFTER `remark-rehype` so they see the
      // HAST — this is the hook point for `rehype-slug` etc.
      for (const plugin of rehypePlugins) {
        chain = applyPlugin(chain, plugin);
      }
      chain = chain.use(rehypeStringify.default);
      const file = await chain.process(body);
      const html = file.toString();
      return {
        html,
        Component: () => createHtmlElement(html),
        mode: "unified",
      };
    } catch (err) {
      // Pipeline itself threw — report it so the caller sees the
      // underlying failure instead of a silent `<pre>`.
      if (!silent) {
        console.warn(
          "[content] MDX pipeline failed; falling back to <pre>. Underlying error:",
          err instanceof Error ? err.message : err
        );
      }
      return {
        Component: () => createPreElement(body),
        mode: "fallback-pipeline-error",
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  // Fallback: emit a simple React element wrapping the raw body in a
  // `<pre>` so pages don't 500. Pages that need real MDX should
  // install `unified` + remark/rehype in their project.
  if (!silent && missing.length > 0) {
    // One warning per call — if the project is rendering 500 pages
    // this will be noisy, but that noise is the feedback users
    // need to know WHY their markdown is not compiling. `silent:
    // true` mutes this for build scripts that deliberately opt out.
    console.warn(
      `[content] MDX tooling missing: ${missing.join(
        ", "
      )}. Install these peer deps to enable full rendering — falling back to <pre> shell.`
    );
  }
  return {
    Component: () => createPreElement(body),
    mode: "fallback-missing-deps",
  };
}

/**
 * Apply a plugin spec to a unified chain. The unified plugin
 * ecosystem accepts either a bare function or a `[plugin, options]`
 * tuple, so we handle both without pulling the unified types in.
 */
function applyPlugin<P extends { use: (plugin: unknown, options?: unknown) => P }>(
  chain: P,
  plugin: unknown
): P {
  if (Array.isArray(plugin)) {
    const [fn, ...rest] = plugin;
    return chain.use(fn, ...rest);
  }
  return chain.use(plugin);
}

/**
 * Build a lightweight React element carrying HTML content. We avoid
 * importing React directly so `@mandujs/core/content` stays
 * React-free at import time — the returned value is the plain React
 * element shape (`{ type, props, key }`) which matches what
 * `React.createElement('div', { dangerouslySetInnerHTML: ... })`
 * produces. If the project hosts a React version that uses a
 * different shape, users can swap to their own compiler.
 */
function createHtmlElement(html: string): unknown {
  return {
    type: "div",
    props: {
      dangerouslySetInnerHTML: { __html: html },
    },
    key: null,
    // React 19 uses a $$typeof symbol to distinguish elements —
    // stamp it so React.isValidElement() accepts us.
    $$typeof: Symbol.for("react.element"),
    ref: null,
  };
}

function createPreElement(body: string): unknown {
  return {
    type: "pre",
    props: { children: body },
    key: null,
    $$typeof: Symbol.for("react.element"),
    ref: null,
  };
}

// ---------------------------------------------------------------------------
// defineCollection overloads
// ---------------------------------------------------------------------------

/**
 * Legacy signature — pass-through for projects using the existing
 * ContentLayer (`{ loader, schema }`). We detect the shape at runtime
 * and return the config unchanged so downstream
 * `defineContentConfig({ collections: { ... } })` keeps working.
 */
export function defineCollection<T extends LegacyCollectionConfig>(
  config: T
): T;

/**
 * MVP signature — create a typed `Collection` from a directory path
 * and optional Zod schema.
 */
export function defineCollection<T>(
  options: DefineCollectionOptions<T>
): Collection<T>;

export function defineCollection(
  config: LegacyCollectionConfig | DefineCollectionOptions<unknown>
): unknown {
  // Disambiguate by the presence of a `loader` property — the legacy
  // config always has one, the MVP config never does. Passing both
  // throws so the error points to the conflict rather than letting
  // one branch silently win.
  if (isLegacyConfig(config)) {
    if ("path" in config) {
      throw new Error(
        "[defineCollection] config has both `loader` and `path`; pick one — the legacy ContentLayer uses `loader`, the MVP Collection API uses `path`."
      );
    }
    return config;
  }
  return new Collection(config as DefineCollectionOptions<unknown>);
}

function isLegacyConfig(
  cfg: LegacyCollectionConfig | DefineCollectionOptions<unknown>
): cfg is LegacyCollectionConfig {
  return typeof cfg === "object" && cfg !== null && "loader" in cfg;
}

/**
 * Module-scoped registry of every `Collection` instance ever constructed
 * in this process. Consumed by the dev bundler's content-change handler
 * to invalidate in-memory entries after a filesystem add/remove so the
 * next SSR request rescans disk. Readers must treat the set as read-only.
 */
const collectionRegistry = new Set<Collection<unknown>>();

/**
 * Return the live registry of Collections. The returned set is live —
 * a Collection constructed after the call still shows up on the next
 * iteration. Intended for dev tooling; production code should go
 * through the typed `getCollection()` / `defineCollection()` APIs.
 */
export function getRegisteredCollections(): ReadonlySet<Collection<unknown>> {
  return collectionRegistry;
}

/**
 * Invalidate every registered collection's in-memory cache. Called by
 * the dev bundler when a file under a collection root is added or
 * removed. Cheap (walks the registry and nulls each `entries` cache);
 * the next `.all()` / `.get()` call rescans disk.
 */
export function invalidateAllCollections(): void {
  for (const c of collectionRegistry) c.invalidate();
}
