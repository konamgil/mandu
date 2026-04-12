/**
 * mandu cache - Cache management CLI
 *
 * Cache operations require a running Mandu server because the
 * global cache store lives in the server process memory.
 *
 * Usage:
 *   mandu cache clear [path]     Revalidate by path
 *   mandu cache clear --tag=x    Revalidate by tag
 *   mandu cache clear --all      Clear entire cache
 *   mandu cache stats            Print cache info hint
 */

export interface CacheOptions {
  tag?: string;
  all?: boolean;
  path?: string;
}

const SERVER_NOT_RUNNING = `\
  Cache operations require a running server.
  Use revalidatePath/revalidateTag in your route handlers, or
  restart the server to clear all caches.`;

/**
 * Execute cache command
 */
export async function cache(action: string, options: CacheOptions = {}): Promise<boolean> {
  switch (action) {
    case "clear":
      return handleClear(options);
    case "stats":
      return handleStats();
    default:
      return false;
  }
}

function handleClear(options: CacheOptions): boolean {
  if (options.all) {
    console.log("cache clear --all");
    console.log(`\n${SERVER_NOT_RUNNING}`);
    return true;
  }

  if (options.tag) {
    console.log(`cache clear --tag=${options.tag}`);
    console.log(`\n${SERVER_NOT_RUNNING}`);
    return true;
  }

  if (options.path) {
    console.log(`cache clear ${options.path}`);
    console.log(`\n${SERVER_NOT_RUNNING}`);
    return true;
  }

  console.log("cache clear");
  console.log(`\n${SERVER_NOT_RUNNING}`);
  return true;
}

function handleStats(): boolean {
  console.log(
    "Cache statistics are available at http://localhost:3333/__kitchen\n" +
      "(requires mandu dev or mandu start)"
  );
  return true;
}
