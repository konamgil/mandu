/**
 * Content Loaders - 빌트인 로더 모음
 *
 * @example
 * ```ts
 * import { file, glob, api } from '@mandujs/core/content';
 *
 * export default defineContentConfig({
 *   collections: {
 *     settings: { loader: file({ path: 'data/settings.json' }) },
 *     posts: { loader: glob({ pattern: 'content/posts/**\/*.md' }) },
 *     products: { loader: api({ url: 'https://api.example.com/products' }) },
 *   },
 * });
 * ```
 */

export { file } from "./file";
export { glob } from "./glob";
export { api } from "./api";

// 타입 재export
export type {
  Loader,
  FileLoaderOptions,
  GlobLoaderOptions,
  ApiLoaderOptions,
  PaginationConfig,
  ParsedMarkdown,
  LoaderEntry,
  LoaderFactory,
} from "./types";

export { inferParser, FILE_PARSERS, MARKDOWN_EXTENSIONS } from "./types";
