---
title: "Installing Mandu"
status: stable
updated: 2026-04-18
---

# Installing Mandu

Mandu ships in two parallel formats. Pick the one that matches how you plan to use it.

| Track | Artifact | Who | Size | Prerequisite |
|---|---|---|---|---|
| **Standalone binary** | `mandu-<target>` / `mandu.exe` from GitHub Releases | Beginners, onboarding, desktop users | ~132 MB (Bun runtime embedded) | None |
| **npm / Bun package** | `@mandujs/cli` on npmjs.org | Framework contributors, CI, monorepos | ~5 MB + deps | Bun 1.4.0+ installed |

If you are just kicking the tires, grab the binary. If you already have Bun and want to contribute, install the npm package.

---

## For users — standalone binary

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/konamgil/mandu/main/install.sh | sh
```

What it does:

1. Detects your OS and CPU architecture (`uname -sm`).
2. Detects glibc vs musl on Linux (Alpine / Docker gets the `-musl` binary).
3. Downloads the matching binary from the latest GitHub Release.
4. Verifies its SHA-256 checksum.
5. Installs it to `~/.mandu/bin/mandu`.
6. Appends a `PATH` entry to `~/.bashrc` / `~/.zshrc` / `~/.profile` (whichever exists).

### Windows (PowerShell)

```powershell
iwr https://raw.githubusercontent.com/konamgil/mandu/main/install.ps1 -useb | iex
```

What it does:

1. Reads `PROCESSOR_ARCHITECTURE` (or `PROCESSOR_ARCHITEW6432`).
2. Downloads `mandu-bun-windows-x64.exe` from the latest release.
3. Verifies its SHA-256 checksum.
4. Installs to `%LOCALAPPDATA%\Mandu\bin\mandu.exe`.
5. Adds that directory to your **User** `PATH` (no admin required).

> The binary is currently unsigned. Windows SmartScreen will display a warning on first launch — click **More info** -> **Run anyway**, or unblock the file once via `Unblock-File`. Code signing is on the Phase 9.1 follow-up track.

### Git Bash / WSL / Cygwin

Prefer the PowerShell script for native Windows installs. If you specifically want a unix-target binary on a Windows host (for use inside WSL or a Cygwin toolchain):

```bash
curl -fsSL https://raw.githubusercontent.com/konamgil/mandu/main/install.bash | MANDU_FORCE_UNIX=1 bash
```

### Installer flags

All of these are accepted by `install.sh`, `install.bash`, and `install.ps1` (PowerShell uses PascalCase).

| Flag | Env var | Default | Description |
|---|---|---|---|
| `--version <tag>` | `MANDU_VERSION` | `latest` | Install a specific release tag, e.g. `v0.23.0`. |
| `--install-dir <path>` | `MANDU_INSTALL_DIR` | `~/.mandu/bin` (unix), `%LOCALAPPDATA%\Mandu\bin` (Windows) | Where to place the binary. |
| `--dry-run` | — | off | Print planned actions, download nothing. |
| `--force` | `MANDU_FORCE=1` | off | Overwrite an existing binary without prompting. |
| `--no-modify-path` | `MANDU_NO_MODIFY_PATH=1` | off | Skip shell-profile / User-PATH edits. |

Examples:

```bash
# Pin to a specific release
curl -fsSL https://raw.githubusercontent.com/konamgil/mandu/main/install.sh \
  | sh -s -- --version v0.23.0

# Install into a custom prefix without touching shell profiles
MANDU_NO_MODIFY_PATH=1 MANDU_INSTALL_DIR=/opt/mandu/bin \
  curl -fsSL https://raw.githubusercontent.com/konamgil/mandu/main/install.sh | sh

# Test what the installer would do (no network, no writes)
curl -fsSL https://raw.githubusercontent.com/konamgil/mandu/main/install.sh \
  | sh -s -- --dry-run
```

### Manual download

If you would rather not pipe a script into a shell, browse the [Releases page](https://github.com/konamgil/mandu/releases), download the binary matching your platform, verify it against `SHA256SUMS.txt`, and drop it on your `PATH`. The artifacts are:

| Filename | Target |
|---|---|
| `mandu-bun-linux-x64` | Linux x86_64 (glibc — Ubuntu, Debian, RHEL, Arch) |
| `mandu-bun-linux-x64-musl` | Linux x86_64 (musl — Alpine, distroless) |
| `mandu-bun-linux-arm64` | Linux aarch64 (AWS Graviton, Raspberry Pi 4/5, 64-bit Pi OS) |
| `mandu-bun-darwin-arm64` | macOS on Apple Silicon (M1/M2/M3/M4) |
| `mandu-bun-darwin-x64` | macOS on Intel |
| `mandu-bun-windows-x64.exe` | Windows 10/11 x86_64 |

Each binary ships a sibling `.sha256` file. Verify before running:

```bash
shasum -a 256 -c mandu-bun-linux-x64.sha256
```

---

## For developers — npm / Bun package

```bash
bun install -g @mandujs/cli
# or project-scoped (recommended for reproducibility)
bun add -d @mandujs/cli
```

Verify:

```bash
bun x mandu --version
```

This is the recommended path for anyone who will run `bun run mandu ...` inside a workspace, contribute patches, or invoke Mandu from CI (where installing a 132 MB binary per job is wasteful).

---

## Choosing a track

Use the binary if any of the following apply:

- You want to try Mandu without installing Bun first.
- You distribute Mandu to a team of mixed-tooling developers.
- You run `mandu init` on a clean machine for demos.

Use the npm package if any of the following apply:

- You already have Bun installed and do not want a second copy of the runtime.
- You need lockfile-level reproducibility for CI.
- You contribute to Mandu itself (the monorepo workflow assumes `@mandujs/cli` is linked from `packages/cli`).

You can mix the two — the binary is self-contained and does not interfere with a `@mandujs/cli` install on the same machine, because their commands live in different directories.

---

## Upgrading

**Binary**: re-run the same one-liner. `install.sh` / `install.ps1` overwrite in place and the version banner will change on next invocation. A first-party `mandu upgrade` that rewrites the binary without a shell script is on the Phase 9.1 follow-up track.

**npm / Bun**: `bun update -g @mandujs/cli` (or bump the dev dependency in your workspace and `bun install`).

---

## Uninstalling

**Binary (unix)**:

```bash
rm -f ~/.mandu/bin/mandu
# optionally remove the PATH line from ~/.bashrc / ~/.zshrc
```

**Binary (Windows, PowerShell)**:

```powershell
Remove-Item "$env:LOCALAPPDATA\Mandu\bin\mandu.exe"
# Remove the PATH entry from User environment variables (optional)
```

**npm / Bun**:

```bash
bun remove -g @mandujs/cli
```

---

## Security

- Install scripts fetch binaries over HTTPS from `github.com` only.
- Every binary has a SHA-256 checksum published alongside it. The installer verifies that checksum before writing anything to `$PATH`.
- The installers run as the current user and write only to the user's install prefix — no `sudo`, no system-wide changes.
- Binaries are unsigned during Phase 9b rollout. Signed binaries (Windows EV cert + Apple Developer ID + notarization) land in Phase 9.1 follow-up. If you need signed artifacts today, install via Bun from npm.

Reports of installer issues: open a ticket at [github.com/konamgil/mandu/issues](https://github.com/konamgil/mandu/issues) with the failing command, `uname -a` output, and the installer's stderr.
