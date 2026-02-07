export function importFresh<T = unknown>(modulePath: string): Promise<T> {
  const url = Bun.pathToFileURL(modulePath);
  const cacheBusted = new URL(url.href);
  cacheBusted.searchParams.set("t", Date.now().toString());
  return import(cacheBusted.href) as Promise<T>;
}
