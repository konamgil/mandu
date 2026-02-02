<p align="center">
  <img src="https://raw.githubusercontent.com/konamgil/mandu/main/mandu_only_simbol.png" alt="Mandu" width="200" />
</p>

<h1 align="center">@mandujs/mcp</h1>

<p align="center">
  <strong>Mandu MCP Server</strong><br/>
  Model Context Protocol server for AI agent integration
</p>

<p align="center">
  English | <a href="./README.ko.md"><strong>한국어</strong></a>
</p>

## What is MCP?

MCP (Model Context Protocol) enables AI agents to directly interact with the Mandu framework. Instead of generating code blindly, agents can:

- Query current project structure
- Add/modify routes with validation
- Write business logic with auto-correction
- Check architecture rules before making changes
- Receive real-time violation notifications

## Setup

### Claude Code / Claude Desktop

Add to your MCP configuration (`.mcp.json` or Claude settings):

```json
{
  "mcpServers": {
    "mandu": {
      "command": "bunx",
      "args": ["@mandujs/mcp"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

### Direct Execution

```bash
cd /path/to/project
bunx @mandujs/mcp
```

---

## Tools (25+)

### Spec Management

| Tool | Description |
|------|-------------|
| `mandu_list_routes` | List all routes with details |
| `mandu_get_route` | Get specific route by ID |
| `mandu_add_route` | Add new route to manifest |
| `mandu_update_route` | Modify existing route |
| `mandu_delete_route` | Remove route from manifest |
| `mandu_validate_spec` | Validate manifest schema |

### Code Generation

| Tool | Description |
|------|-------------|
| `mandu_generate` | Generate code from manifest |

### Transaction Management

| Tool | Description |
|------|-------------|
| `mandu_begin` | Start transaction with snapshot |
| `mandu_commit` | Finalize changes |
| `mandu_rollback` | Restore from snapshot |
| `mandu_tx_status` | Get transaction state |

### Slot Management

| Tool | Description |
|------|-------------|
| `mandu_read_slot` | Read slot file content |
| `mandu_write_slot` | Write slot file (with auto-correction) |
| `mandu_validate_slot` | Validate slot syntax |

### Guard & Architecture

| Tool | Description |
|------|-------------|
| `mandu_guard_check` | Run all guard checks |
| `mandu_check_location` | Validate file location before creating |
| `mandu_check_import` | Validate imports against architecture rules |
| `mandu_get_architecture` | Get project architecture rules |

### Brain & Monitoring

| Tool | Description |
|------|-------------|
| `mandu_doctor` | Analyze failures + suggest patches |
| `mandu_watch_start` | Start file watcher with notifications |
| `mandu_watch_status` | Get watcher status |
| `mandu_watch_stop` | Stop file watcher |

### Hydration & Build

| Tool | Description |
|------|-------------|
| `mandu_build` | Build client bundles |
| `mandu_build_status` | Get bundle statistics |
| `mandu_list_islands` | List routes with hydration |
| `mandu_set_hydration` | Configure hydration strategy |
| `mandu_add_client_slot` | Create client slot for route |

### History

| Tool | Description |
|------|-------------|
| `mandu_list_changes` | View change history |
| `mandu_prune_history` | Clean old snapshots |

---

## Resources

| URI | Description |
|-----|-------------|
| `mandu://spec/manifest` | Current routes.manifest.json |
| `mandu://spec/lock` | Current spec.lock.json with hash |
| `mandu://generated/map` | Generated files mapping |
| `mandu://transaction/active` | Active transaction state |
| `mandu://slots/{routeId}` | Slot file content by route ID |
| `mandu://watch/warnings` | Recent architecture violation warnings |
| `mandu://watch/status` | Watcher status (active, uptime, count) |

---

## Real-Time Notifications

When `mandu_watch_start` is active, the agent receives real-time push notifications for architecture violations:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/message",
  "params": {
    "level": "warning",
    "logger": "mandu-watch",
    "data": {
      "type": "watch_warning",
      "ruleId": "GENERATED_DIRECT_EDIT",
      "file": "apps/server/generated/routes/home.route.ts",
      "message": "Generated file was directly modified",
      "timestamp": "2026-02-02T10:15:00.000Z"
    }
  }
}
```

### Watched Rules

| Rule | Description |
|------|-------------|
| `GENERATED_DIRECT_EDIT` | Manual edits to generated files |
| `WRONG_SLOT_LOCATION` | Slot files outside `spec/slots/` |
| `SLOT_NAMING` | Slot files not ending with `.slot.ts` |
| `CONTRACT_NAMING` | Contract files not ending with `.contract.ts` |
| `FORBIDDEN_IMPORT` | Dangerous imports in generated files |

---

## Agent Workflow Examples

### Adding a New API Route

```
Agent:
1. mandu_begin({ message: "Add users API" })
   → Creates snapshot

2. mandu_check_location({ path: "spec/slots/users.slot.ts" })
   → Validates location is allowed

3. mandu_add_route({
     id: "users-list",
     pattern: "/api/users",
     kind: "api",
     methods: ["GET", "POST"],
     slotModule: "spec/slots/users.slot.ts"
   })
   → Adds route to manifest

4. mandu_generate()
   → Creates route handlers

5. mandu_write_slot({
     routeId: "users-list",
     content: "...",
     autoCorrect: true
   })
   → Writes business logic

6. mandu_guard_check()
   → Validates architecture

7. mandu_commit()
   → Finalizes changes
```

### Checking Before Writing

```
Agent:
1. mandu_get_architecture()
   → Gets folder rules, import rules, naming rules

2. mandu_check_location({ path: "src/features/user/api.ts" })
   → Checks if location is valid

3. mandu_check_import({
     sourceFile: "src/features/user/api.ts",
     imports: ["../../entities/product"]
   })
   → Checks if imports are allowed

4. Proceed with writing if all checks pass
```

### Monitoring Architecture

```
Agent:
1. mandu_watch_start()
   → Starts watching with notifications

2. (Agent receives real-time warnings)

3. mandu_watch_status()
   → Gets current status and recent warnings

4. mandu_doctor()
   → Analyzes violations and suggests fixes

5. mandu_watch_stop()
   → Stops watching
```

---

## Architecture Integration

The MCP server integrates with Mandu Guard to enforce architecture rules:

```
┌─────────────────────────────────────────────────────────────┐
│                     AI Agent (Claude)                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   Before writing code:                                       │
│   1. mandu_get_architecture()    → Get rules                 │
│   2. mandu_check_location()      → Validate placement        │
│   3. mandu_check_import()        → Validate dependencies     │
│                                                              │
│   While writing:                                             │
│   - mandu_watch_start()          → Real-time notifications   │
│                                                              │
│   After writing:                                             │
│   - mandu_guard_check()          → Full validation           │
│   - mandu_doctor()               → Get fix suggestions       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Requirements

- Bun >= 1.0.0
- @mandujs/core >= 0.9.25

## Related Packages

- [@mandujs/core](https://www.npmjs.com/package/@mandujs/core) - Core runtime
- [@mandujs/cli](https://www.npmjs.com/package/@mandujs/cli) - CLI tool

## License

MIT
