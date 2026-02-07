import path from "path";
import fs from "fs/promises";

export function resolveFromCwd(...paths: string[]): string {
  return path.resolve(process.cwd(), ...paths);
}

export function getRootDir(): string {
  return process.cwd();
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
