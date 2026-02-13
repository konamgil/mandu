export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  const safeMessage = message || "(empty)";
  const reply = `mandu starter echo: ${safeMessage}`;

  return Response.json({ reply, ts: Date.now() });
}
