export async function maybeHandleImageFeatureRequest(
  request: Request,
  settings: {
    edge?: boolean;
    rootDir: string;
    publicDir: string;
  },
): Promise<Response | null> {
  if (settings.edge) return null;
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/_mandu/image") return null;

  const { handleImageRequest } = await import("./image-handler");
  return await handleImageRequest(request, settings.rootDir, settings.publicDir);
}
