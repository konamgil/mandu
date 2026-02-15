---
"@mandujs/core": patch
"@mandujs/cli": patch
"@mandujs/mcp": patch
---

fix: resolve 9 GitHub issues (6 root causes)

**React 19 Compatibility (#99, #102)**
- Added React 19 client internals shim to prevent hydration crashes
- Added version export and null-safe __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

**Plain React Component Support (#96)**
- Added fallback hydration logic for plain React components without __mandu_island marker
- Prevents hydration failure for standard React components

**Lockfile UX Improvements (#100, #101, #103)**
- Changed --diff command to work gracefully without snapshot
- Shows helpful warning message instead of hard failure
- Returns success status for better CI/CD integration

**Workspace Dependencies (#97, #104)**
- Fixed workspace:* protocol in published packages
- Changed to proper semantic version ranges (^0.18.0, ^0.17.0)

**Zod Dependency (#98)**
- Moved zod from peerDependencies to dependencies in @mandujs/core
- Ensures correct installation without peer dependency warnings
