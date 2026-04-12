import fs from "fs/promises";
import path from "path";

export interface ScaffoldWriteResult {
  displayPath: string;
  filePath: string;
  created: boolean;
}

export interface EnvExampleResult {
  displayPath: string;
  addedKeys: string[];
  created: boolean;
}

export async function writeFileIfMissing(
  rootDir: string,
  relativePath: string,
  content: string,
): Promise<ScaffoldWriteResult> {
  const filePath = path.join(rootDir, relativePath);

  try {
    await fs.access(filePath);
    return {
      displayPath: relativePath,
      filePath,
      created: false,
    };
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    return {
      displayPath: relativePath,
      filePath,
      created: true,
    };
  }
}

export async function ensureEnvExampleEntries(
  rootDir: string,
  entries: Record<string, string>,
): Promise<EnvExampleResult> {
  const displayPath = ".env.example";
  const filePath = path.join(rootDir, displayPath);
  let content = "";
  let created = false;

  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    created = true;
  }

  const normalized = content.length > 0 && !content.endsWith("\n")
    ? `${content}\n`
    : content;

  let nextContent = normalized;
  const addedKeys: string[] = [];

  for (const [key, value] of Object.entries(entries)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`^${escapedKey}=`, "m").test(nextContent)) {
      continue;
    }

    nextContent += `${key}=${value}\n`;
    addedKeys.push(key);
  }

  if (created || addedKeys.length > 0) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, nextContent);
  }

  return {
    displayPath,
    addedKeys,
    created,
  };
}
