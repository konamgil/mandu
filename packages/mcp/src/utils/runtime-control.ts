import path from "path";

export interface RuntimeControlRecord {
  mode: "dev" | "start";
  port: number;
  token: string;
  baseUrl: string;
  startedAt: string;
}

const RUNTIME_CONTROL_RELATIVE_PATH = path.join(".mandu", "runtime-control.json");

export async function readRuntimeControl(rootDir: string): Promise<RuntimeControlRecord | null> {
  try {
    const file = Bun.file(path.join(rootDir, RUNTIME_CONTROL_RELATIVE_PATH));
    if (!(await file.exists())) {
      return null;
    }
    return await file.json() as RuntimeControlRecord;
  } catch {
    return null;
  }
}

export async function requestRuntimeCache(
  rootDir: string,
  action: "stats" | "clear",
  payload: Record<string, unknown> = {}
): Promise<{ control: RuntimeControlRecord; response: Response; body: unknown } | null> {
  const control = await readRuntimeControl(rootDir);
  if (!control) {
    return null;
  }

  const response = await fetch(`${control.baseUrl}/_mandu/cache`, {
    method: action === "stats" ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "x-mandu-control-token": control.token,
    },
    ...(action === "clear" ? { body: JSON.stringify(payload) } : {}),
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // ignore invalid JSON
  }

  return { control, response, body };
}
