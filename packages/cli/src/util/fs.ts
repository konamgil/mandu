import path from "path";

export function resolveFromCwd(...paths: string[]): string {
  return path.resolve(process.cwd(), ...paths);
}

export function getRootDir(): string {
  return process.cwd();
}
