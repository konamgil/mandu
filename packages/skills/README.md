# @mandujs/skills

Generated Mandu skills for the Agent-Safe workflow. The package contains no
independent framework logic; it distributes the repository's canonical six
skills and project setup files.

## Official skills

| Skill | Scope |
|---|---|
| `mandu-agent-workflow` | context → plan → apply → verify → repair |
| `mandu-fs-routes` | pages and API routes |
| `mandu-contract` | typed API contracts |
| `mandu-hydration` | islands and client boundaries |
| `mandu-guard` | architecture safety |
| `mandu-testing` | targeted Bun verification |

## Install

New projects receive these files through `mandu create`. For an existing
project:

```bash
bun add -D @mandujs/skills
bunx mandu-skills install
```

Use `--force` to replace installed copies or `--dry-run` to preview changes.

The installed layout is `.claude/skills/<id>/SKILL.md`. MCP configuration and
shared settings are merged without making deployment providers part of the
framework contract.

## Maintainers

Edit only `skills/official/` at the repository root, then run:

```bash
bun run generate:official-skills
bun run check:official-skills
```

`packages/skills/generated/skills` is generated and must not be edited by
hand. Legacy catalogs are preserved under `docs/archive/skills/` and are not
published.

## License

MPL-2.0
