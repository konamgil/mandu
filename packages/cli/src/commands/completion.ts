/**
 * mandu completion - Generate shell completion scripts
 *
 * Outputs a completion script for the specified shell to stdout.
 * Usage: mandu completion bash >> ~/.bashrc
 */

import { getAllCommands } from "./registry";

const SHELLS = ["bash", "zsh", "fish"] as const;
type Shell = (typeof SHELLS)[number];

function bashCompletion(commands: string[]): string {
  const list = commands.join(" ");
  return `# mandu bash completion
_mandu() {
  local cur=\${COMP_WORDS[COMP_CWORD]}
  COMPREPLY=($(compgen -W "${list}" -- "$cur"))
}
complete -F _mandu mandu
`;
}

function zshCompletion(commands: string[]): string {
  const list = commands.join(" ");
  return `# mandu zsh completion
_mandu() {
  local -a commands=(${list})
  _describe 'mandu commands' commands
}
compdef _mandu mandu
`;
}

function fishCompletion(commands: string[]): string {
  return (
    "# mandu fish completion\n" +
    commands
      .map((c) => `complete -c mandu -n '__fish_use_subcommand' -a '${c}' -d '${c}'`)
      .join("\n") +
    "\n"
  );
}

export async function completion(shell: string): Promise<boolean> {
  if (!SHELLS.includes(shell as Shell)) {
    console.error(`❌ Unsupported shell: ${shell}`);
    console.error(`   Supported: ${SHELLS.join(", ")}`);
    return false;
  }

  const commands = getAllCommands();

  switch (shell as Shell) {
    case "bash":
      process.stdout.write(bashCompletion(commands));
      break;
    case "zsh":
      process.stdout.write(zshCompletion(commands));
      break;
    case "fish":
      process.stdout.write(fishCompletion(commands));
      break;
  }

  return true;
}
