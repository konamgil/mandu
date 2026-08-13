/**
 * @mandujs/core/routes
 *
 * File-convention metadata routes: sitemap, robots, llms.txt, manifest.
 *
 * This subpath intentionally scopes only the Metadata Routes API so
 * users can import types without pulling in the full `@mandujs/core`
 * surface:
 *
 * ```ts
 * import type { SitemapEntry, Robots, WebAppManifest } from "@mandujs/core/compat/routes/index";
 * ```
 *
 * Runtime helpers (`renderSitemap`, `renderRobots`, `renderManifest`,
 * `renderLlmsTxt`, `handleMetadataRoute`) are also re-exported so
 * advanced callers can bypass the auto-discovery pipeline and wire
 * their own handlers.
 *
 * See `docs/architect/metadata-routes.md` for the file-convention
 * contract.
 */

// Types
export type {
  // Sitemap
  ChangeFrequency,
  SitemapAlternates,
  SitemapEntry,
  Sitemap,

  // Robots
  RobotsRule,
  Robots,

  // Web App Manifest
  DisplayMode,
  Orientation,
  WebAppManifestIcon,
  WebAppManifestShortcut,
  WebAppManifest,

  // Default-export contracts
  SitemapFn,
  RobotsFn,
  LlmsTxtFn,
  ManifestFn,

  // Manifest / fs-scanner discriminator
  MetadataRouteKind,
} from "./types";

// Validation schemas + fixed route table (low-level — advanced)
export {
  SitemapEntrySchema,
  SitemapSchema,
  RobotsRuleSchema,
  RobotsSchema,
  WebAppManifestIconSchema,
  WebAppManifestSchema,
  METADATA_ROUTES,
} from "./types";

// Runtime handlers
export {
  renderSitemap,
  renderRobots,
  renderManifest,
  renderLlmsTxt,
  renderValidated,
  handleMetadataRoute,
  getMetadataRouteMeta,
  MetadataRouteValidationError,
  type MetadataRouteHandlerOptions,
} from "./metadata-routes";
