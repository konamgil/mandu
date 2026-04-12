import fs from "fs/promises";
import path from "path";

export interface RuntimeControlRecord {
  mode: "dev" | "start";
  port: number;
  token: string;
  baseUrl: string;
  startedAt: string;
}

const RUNTIME_CONTROL_RELATIVE_PATH = path.join(".mandu", "runtime-control.json");

function getRuntimeControlPath(rootDir: string): string {
  return path.join(rootDir, RUNTIME_CONTROL_RELATIVE_PATH);
}

export async function readRuntimeControl(rootDir: string): Promise<RuntimeControlRecord | null> {
  try {
    const file = Bun.file(getRuntimeControlPath(rootDir));
    if (!(await file.exists())) {
      return null;
    }
    return await file.json() as RuntimeControlRecord;
  } catch {
    return null;
  }
}

export async function writeRuntimeControl(rootDir: string, record: RuntimeControlRecord): Promise<void> {
  const targetPath = getRuntimeControlPath(rootDir);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await Bun.write(targetPath, JSON.stringify(record, null, 2));
}

export async function removeRuntimeControl(rootDir: string): Promise<void> {
  await fs.rm(getRuntimeControlPath(rootDir), { force: true });
}
