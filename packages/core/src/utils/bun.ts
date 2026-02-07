export async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    return await Bun.file(filePath).json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON in ${filePath}: ${message}`);
  }
}
