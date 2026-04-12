export function collectPositionals(args: string[], startIndex = 1): string[] {
  const positionals: string[] = [];

  for (let i = startIndex; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      if (!arg.includes("=") && i + 1 < args.length && !args[i + 1].startsWith("-")) {
        i++;
      }
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      continue;
    }

    positionals.push(arg);
  }

  return positionals;
}
