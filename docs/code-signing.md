---
title: "Binary signing & SLSA provenance — roadmap and operator guide"
status: reference
audience: Mandu maintainers + release operators
phase: 11.A (SLSA Level 2 shipped — EV cert / Apple Dev ID still pending)
related:
  - .github/workflows/release-binaries.yml
  - docs/security/phase-9-audit.md (M-01)
  - docs/bun/phase-11-team-plan.md (Agent A)
  - https://slsa.dev/spec/v1.0/
created: 2026-04-19
---

# Binary signing & SLSA provenance

Mandu ships 6 cross-compiled CLI binaries (`mandu-bun-linux-*`, `mandu-bun-darwin-*`,
`mandu-bun-windows-x64.exe`) per release. Trust in those binaries is layered, and
each layer has a separate operational cost + external dependency.

This document is the source-of-truth for **where we are** and **what ships next**
on each layer.

## 1. Trust layers (current state)

| Layer | Purpose | Status | Operator cost |
|---|---|---|---|
| **SHA-256 checksum sidecar** | Detect transport-level corruption; used by `install.sh`. | ✅ shipped since Phase 9b | $0 |
| **SLSA Build Level 2 provenance** | Independent attestation that the binary came out of *this* workflow, from *this* commit. Verifiable via `gh attestation verify`. | ✅ **Phase 11.A — shipped** | $0 (GitHub-hosted OIDC + Sigstore Fulcio) |
| **Windows EV code-signing cert** | Suppress Microsoft SmartScreen "Unknown publisher" warning. | ❌ not yet (external-wait track) | $10/mo (Azure Trusted Signing) – $500/yr (DigiCert EV) |
| **Apple Developer ID + notarization** | Suppress macOS Gatekeeper "cannot be opened because the developer cannot be verified". | ❌ not yet (external-wait track) | $99/yr |

As of **Phase 11.A** the chain covers **Level 2 SLSA**. That is enough to close
[Phase 9 audit M-01 first cut](./security/phase-9-audit.md#m-01--배포-바이너리가-서명되지-않음-windows-smartscreen--macos-gatekeeper).
The two OS-vendor signing layers remain tracked as Phase 9.1 follow-up and are
gated on external paperwork / purchases.

## 2. SLSA Build Level 2 — how it works

Phase 11.A added the [`actions/attest-build-provenance@v2`](https://github.com/actions/attest-build-provenance)
step to `.github/workflows/release-binaries.yml`. Every matrix leg now:

1. Produces its artifact (`bun build --compile`) locally on the matrix runner.
2. Computes the SHA-256 of that artifact (unchanged from Phase 9b).
3. Requests a short-lived OIDC token from GitHub Actions (`id-token: write`).
4. Hands that token + the artifact path to `attest-build-provenance`, which
   signs an in-toto SLSA [v1.0 provenance](https://slsa.dev/spec/v1.0/provenance)
   predicate with Sigstore's Fulcio CA.
5. Writes the signed bundle into the repository's **GitHub attestation store**
   (`attestations: write`), visible per-release on the repo's attestations tab
   and programmatically queryable.

### Why SLSA Level 2 (not 3) right now?

The four [SLSA track levels](https://slsa.dev/spec/v1.0/levels) are cumulative:

| Level | Gate | Mandu state |
|---|---|---|
| L1 | Provenance exists. | ✅ |
| **L2** | **Provenance is signed + hosted in a verifiable store.** | **✅ Phase 11.A** |
| L3 | Build is fully isolated and hosted by a hardened platform (GitHub Actions qualifies). | ⚠️ eligible, not yet declared |
| L4 | Two-party review of every build; hermetic builds. | ❌ |

GitHub Actions on `ubuntu-latest` / `macos-*` / `windows-latest` runners **does**
meet SLSA L3's hosted-platform requirement, and
`actions/attest-build-provenance` is specifically marketed as an L3-capable
producer. The blocker to formally declaring L3 is **hermeticity**: our build
installs dependencies from the public npm registry (via `bun install
--frozen-lockfile`). L3 asks that every bit the build consumes be verifiable
against the provenance. Closing that gap (via an npm proxy with provenance
pass-through, or via a locally-mirrored cache signed at audit time) is Phase
12+.

We are therefore **effectively L3** but declare **L2** until the dependency
provenance audit is in place.

### How end users verify

```sh
# After downloading a binary + its sidecar checksum:
gh attestation verify mandu-bun-linux-x64 --repo konamgil/mandu
# -> Loaded digest sha256:... for file://mandu-bun-linux-x64
# -> Loaded 1 attestation from GitHub API
# -> Verification succeeded!
#
# The following policy criteria will be enforced:
# - Predicate type must match: https://slsa.dev/provenance/v1
# - Source Repository Owner URI must match: https://github.com/konamgil
# - Source Repository URI must match: https://github.com/konamgil/mandu
# - Predicate must be signed by Fulcio
```

`gh attestation verify` ships with GitHub CLI ≥ 2.49.0. The install scripts
(`install.sh` / `install.ps1`) do **not** yet auto-run this verification
because (a) it depends on `gh`, which few users have, and (b) the SHA-256
sidecar is enough to defeat transport attacks. Adding an opt-in
`--verify-slsa` flag is tracked as a Phase 12 hardening item.

## 3. Windows EV code-signing — external-wait track

Windows SmartScreen currently warns users that the `mandu.exe` binary is from
an "unknown publisher". EV code-signing certificates bind the binary to a
registered legal entity and let SmartScreen's reputation system gradually
build trust.

### Recommended vendor: Azure Trusted Signing

[Azure Trusted Signing](https://learn.microsoft.com/en-us/azure/trusted-signing/)
is the recommended option for this project because:

- Pricing: ~$10/month pay-as-you-go. Dramatically cheaper than Sectigo / DigiCert.
- Certificate custody: Microsoft manages the HSM. No dedicated hardware token
  to ship between maintainers.
- Integration: first-party [`azure/trusted-signing-action`](https://github.com/Azure/trusted-signing-action)
  reads from `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` secrets.
- Turnaround: organization verification usually completes in 3–5 business days.

Alternative vendors for reference:

| Vendor | Price | Delivery | Notes |
|---|---|---|---|
| [Sectigo EV](https://www.sectigo.com/ssl-certificates-tls/code-signing) | ~$300/yr | 2–5 days, HSM required | Physical USB token — inconvenient for hosted CI. |
| [DigiCert EV](https://www.digicert.com/signing/code-signing-certificates) | ~$500/yr | Same-day after vetting | Offers Keylocker HSM-in-cloud, similar to Azure. |

### Wiring (future commit — do not merge yet)

The step added to `release-binaries.yml` once the cert is provisioned:

```yaml
- name: Sign Windows binary
  if: matrix.target.runner_target == 'bun-windows-x64'
  uses: azure/trusted-signing-action@v0.4.0  # pin to SHA when merging
  with:
    azure-tenant-id:      ${{ secrets.AZURE_TENANT_ID }}
    azure-client-id:      ${{ secrets.AZURE_CLIENT_ID }}
    azure-client-secret:  ${{ secrets.AZURE_CLIENT_SECRET }}
    endpoint:             https://eus.codesigning.azure.net/
    trusted-signing-account-name: mandu-signing
    certificate-profile-name: mandu-cli
    files-folder:         dist/
    files-folder-filter:  exe
    timestamp-rfc3161:    http://timestamp.acs.microsoft.com
    timestamp-digest:     SHA256
```

Secrets required (set via **Settings > Environments > release**):

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET` (or federated identity credential, preferred)

The signing step runs **after** `actions/attest-build-provenance` because the
attestation is computed over the **signed** artifact so the published provenance
predicate reflects the shipped bytes.

## 4. Apple Developer ID + notarization — external-wait track

macOS Gatekeeper currently blocks `mandu-bun-darwin-*` binaries. The release
notes instruct users to run `xattr -d com.apple.quarantine mandu` — that is a
**pedagogical hazard** (teaches users to unconditionally strip Gatekeeper
warnings) and must be eliminated as soon as the developer account is
provisioned.

### Prerequisites

- Apple Developer account: $99/yr. Register at <https://developer.apple.com/>.
- Generate a **Developer ID Application** certificate (not Mac Installer).
- Export as `.p12` with a strong passphrase.
- Create an [App-Specific Password](https://support.apple.com/en-us/102654) for
  `notarytool` authentication.

### Wiring (future commit — do not merge yet)

Two steps are needed, both applied only to macOS runners:

```yaml
- name: Import signing cert (macOS)
  if: startsWith(matrix.target.runner_target, 'bun-darwin-')
  uses: apple-actions/import-codesign-certs@v3  # pin to SHA when merging
  with:
    p12-file-base64: ${{ secrets.APPLE_DEVELOPER_ID_P12 }}
    p12-password:    ${{ secrets.APPLE_DEVELOPER_ID_P12_PASSWORD }}

- name: Sign + notarize macOS binary
  if: startsWith(matrix.target.runner_target, 'bun-darwin-')
  shell: bash
  env:
    APPLE_ID:             ${{ secrets.APPLE_ID }}
    APPLE_TEAM_ID:        ${{ secrets.APPLE_TEAM_ID }}
    APPLE_APP_PASSWORD:   ${{ secrets.APPLE_APP_PASSWORD }}
    RUNNER_TARGET:        ${{ matrix.target.runner_target }}
  run: |
    set -euo pipefail
    artifact="dist/mandu-${RUNNER_TARGET}"

    # 1. Sign — hardened runtime is required for notarization.
    codesign --force --timestamp --options=runtime \
      --sign "Developer ID Application: <Legal Name> (<team-id>)" \
      "${artifact}"

    # 2. Zip for notary submission (notarytool wants a container).
    ditto -c -k --keepParent "${artifact}" "${artifact}.zip"

    # 3. Submit + wait (typical turnaround: 5–15 minutes).
    xcrun notarytool submit "${artifact}.zip" \
      --apple-id "${APPLE_ID}" \
      --team-id  "${APPLE_TEAM_ID}" \
      --password "${APPLE_APP_PASSWORD}" \
      --wait

    # 4. Staple the notarization ticket so offline `spctl --assess` works.
    #    (`codesign` alone is sufficient for online gatekeeper checks; this
    #    step just improves the offline case.)
    xcrun stapler staple "${artifact}"
```

Secrets required:

- `APPLE_DEVELOPER_ID_P12` — base64-encoded `.p12` certificate.
- `APPLE_DEVELOPER_ID_P12_PASSWORD` — passphrase for the above.
- `APPLE_ID` — Apple ID email associated with the developer account.
- `APPLE_TEAM_ID` — 10-character team identifier from developer.apple.com.
- `APPLE_APP_PASSWORD` — app-specific password (not the Apple ID login).

### When to merge

Once all 5 secrets are populated in the repository environment. Remove the
`xattr -d com.apple.quarantine` instructions from both the release-body
template and `install.sh` help output in the same commit so users stop
learning the antipattern.

## 5. Why we pinned Actions SHAs

Phase 9 audit flagged
[I-01](./security/phase-9-audit.md#i-01--softpropsaction-gh-releasev2-non-sha-pin):
any action referenced by moving tag (`@v4`, `@v2`) can be silently redirected
by the upstream maintainer. Since those actions execute code inside our
release pipeline (with `GITHUB_TOKEN` and — now — OIDC access), a tag
substitution would defeat every layer above.

Phase 11.A therefore pins every third-party action to an immutable **commit
SHA** with a trailing `# v<major>` comment. Pinned SHAs as of 2026-04-18:

| Action | Pinned SHA | Tag comment |
|---|---|---|
| `actions/checkout` | `34e114876b0b11c390a56381ad16ebd13914f8d5` | `# v4` |
| `oven-sh/setup-bun` | `0c5077e51419868618aeaa5fe8019c62421857d6` | `# v2` |
| `actions/upload-artifact` | `ea165f8d65b6e75b540449e92b4886f43607fa02` | `# v4` |
| `actions/download-artifact` | `d3f86a106a0bac45b974a628896c90dbdf5c8093` | `# v4` |
| `softprops/action-gh-release` | `3bb12739c298aeb8a4eeaf626c5b8d85266b0e65` | `# v2` |
| `actions/attest-build-provenance` | `e8998f949152b193b063cb0ec769d69d929409be` | `# v2` |

### Bumping a pin

Don't bump pins reactively — a pin is the whole point. When a CVE lands on one
of the pinned actions:

1. Read the advisory; confirm Mandu's usage is actually affected.
2. Find the fixed release's SHA: `gh api repos/<owner>/<repo>/git/refs/tags/<tag> --jq '.object.sha'`.
   For annotated tags, follow up with `gh api repos/<owner>/<repo>/git/tags/<sha> --jq '.object.sha'`
   to resolve the tag object to the underlying commit.
3. Run `grep <old-sha> .github/workflows/*.yml` and replace all occurrences.
4. Commit with a message referencing the advisory (`chore(ci): bump
   actions/checkout pin to vX.Y.Z — <advisory-id>`).
5. Regenerate `docs/code-signing.md` §5 table (this document).

## 6. Change log

| Date | Change |
|---|---|
| 2026-04-19 | Phase 11.A — shipped SLSA Build L2 (`attest-build-provenance@v2`) + pinned every action to SHA. |
| 2026-04-18 | Phase 9 audit M-01 filed. This document created as the follow-up anchor. |
| TBD | Azure Trusted Signing onboarding — Windows EV cert. |
| TBD | Apple Developer ID signup — macOS notarization. |
