import { ensureEnvExampleEntries } from "../util/scaffold-files";
import { scaffold } from "./scaffold";

export async function sessionInit(): Promise<boolean> {
  const success = await scaffold("session", "");
  if (!success) {
    return false;
  }

  const envResult = await ensureEnvExampleEntries(process.cwd(), {
    SESSION_SECRET: "change-me-in-production",
  });

  if (envResult.addedKeys.length > 0) {
    console.log(`Added ${envResult.addedKeys.join(", ")} to ${envResult.displayPath}`);
  } else {
    console.log(`${envResult.displayPath} already contains SESSION_SECRET`);
  }

  return true;
}
