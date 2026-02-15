# Resource Troubleshooting Guide

<!-- TODO: Add common issues discovered during Phase 5 testing -->

This guide helps you resolve common issues when working with Mandu resources.

---

## Table of Contents

1. [Generation Errors](#generation-errors)
2. [Slot Preservation Issues](#slot-preservation-issues)
3. [Schema Validation Errors](#schema-validation-errors)
4. [Type Errors](#type-errors)
5. [CLI Issues](#cli-issues)
6. [MCP Tool Issues](#mcp-tool-issues)

---

## Generation Errors

### Error: Resource file not found

<!-- TODO: Add actual error message from implementation -->

**Problem:**
```
Error: Resource definition not found at spec/resources/user.resource.ts
```

**Solution:**
- Ensure file exists at correct path
- Check file exports `default defineResource(...)`
- Verify file extension is `.resource.ts`

---

### Error: Invalid resource schema

<!-- TODO: Add validation error examples -->

**Problem:**
```
Error: Invalid field type "stringg" in resource "user"
```

**Solution:**
- Check field type spelling (valid types: <!-- TODO: list from Phase 1 -->)
- Ensure required fields are present (`name`, `fields`)
- Validate JSON structure

---

## Slot Preservation Issues

### My custom code was overwritten!

<!-- TODO: Add slot troubleshooting based on implementation -->

**Problem:**
Custom logic disappeared after regeneration.

**Solution:**
1. Check if code was between `@slot:*` markers:
   ```typescript
   // ✅ SAFE - preserved
   // @slot:custom-logic-start
   const result = myCustomFunction();
   // @slot:custom-logic-end

   // ❌ UNSAFE - will be overwritten
   const result = myCustomFunction(); // outside slots
   ```

2. If slots were removed, check `.mandu/generated/backup/` for previous version

3. Manually restore logic within slot markers

---

### Slot markers missing in generated code

<!-- TODO: Add slot marker troubleshooting -->

**Problem:**
Generated file has no `@slot:*` comments.

**Solution:**
- Check resource template configuration
- Verify `slots: true` in generation options
- Report bug if using standard templates

---

## Schema Validation Errors

### Runtime validation fails for valid data

<!-- TODO: Add Zod validation troubleshooting -->

**Problem:**
```
ZodError: Expected string, received number at "age"
```

**Solution:**
1. Check field type in resource definition matches data
2. Use Zod coercion for flexible types:
   ```typescript
   { name: "age", type: "number", coerce: true }
   ```
3. Verify client is sending correct data types

---

### Custom validator not working

<!-- TODO: Add custom validator examples and debugging -->

**Problem:**
Custom validation function not called.

**Solution:**
<!-- TODO: Add troubleshooting steps from Phase 1 implementation -->

---

## Type Errors

### TypeScript errors in generated code

<!-- TODO: Add TypeScript troubleshooting -->

**Problem:**
```
Type 'string | undefined' is not assignable to type 'string'
```

**Solution:**
1. Mark field as required in resource definition:
   ```typescript
   { name: "email", type: "string", required: true }
   ```

2. Use optional chaining in slots:
   ```typescript
   const email = user.email ?? "unknown@example.com";
   ```

3. Regenerate after schema changes

---

### Client type inference incorrect

<!-- TODO: Add client type troubleshooting -->

**Problem:**
Generated client has incorrect types.

**Solution:**
- Ensure `bun run build` completed successfully
- Check TypeScript version compatibility (>= 5.0)
- Clear `.mandu/generated/` and regenerate

---

## CLI Issues

### `bunx mandu generate resource` not found

<!-- TODO: Add CLI troubleshooting from Phase 2 -->

**Problem:**
Command not recognized.

**Solution:**
1. Install latest Mandu CLI:
   ```bash
   bun add -d @mandujs/cli@latest
   ```

2. Use full package name:
   ```bash
   bunx @mandujs/cli generate resource user
   ```

3. Check Bun version: `bun --version` (>= 1.0.0)

---

### Generation hangs indefinitely

<!-- TODO: Add performance troubleshooting -->

**Problem:**
Command runs but never completes.

**Solution:**
- Check for circular dependencies in relations
- Verify file system permissions
- Check disk space
- Enable verbose logging: `bunx mandu generate resource user --verbose`

---

## MCP Tool Issues

### AI agent can't find MCP tools

<!-- TODO: Add MCP troubleshooting from Phase 3 -->

**Problem:**
MCP tools not available to AI agent.

**Solution:**
1. Verify MCP server configuration in `.mcp.json`:
   ```json
   {
     "mcpServers": {
       "mandu": {
         "command": "bunx",
         "args": ["@mandujs/mcp"],
         "cwd": "/path/to/project"
       }
     }
   }
   ```

2. Restart MCP server

3. Check MCP server logs

---

### MCP tool returns validation error

<!-- TODO: Add MCP validation troubleshooting -->

**Problem:**
```
Error: Invalid input schema for mandu_define_resource
```

**Solution:**
- Check MCP tool input schema requirements
- Verify all required fields are provided
- Use correct field types in JSON input

---

## FAQ

### Q: Can resources and manifests coexist?

<!-- TODO: Add coexistence explanation -->

**A:** Yes! Resources and manifests can coexist in the same project.

---

### Q: How do I migrate existing manifest routes to resources?

**A:** See the [Migration Guide](../migration/to-resources.md)

---

### Q: What happens if I edit generated code outside slots?

**A:** Changes outside slot markers will be **overwritten** on next generation. Always use slots for custom logic.

---

### Q: Can I customize the generation templates?

<!-- TODO: Add template customization guide -->

**A:** Yes, advanced users can provide custom templates. See <!-- TODO: add link -->

---

### Q: How do I add custom fields after initial generation?

**A:** Edit the resource definition, add fields, and regenerate. Slots preserve your custom logic.

---

## Still Having Issues?

1. Check [GitHub Issues](https://github.com/konamgil/mandu/issues)
2. Enable debug logging: `DEBUG=mandu:* bunx mandu generate resource user`
3. Report bug with reproduction steps

---

## Related Documentation

- [Architecture Overview](../resource-architecture.md)
- [API Reference](../api/defineResource.md)
- [Tutorial](./resource-workflow.md)
- [Migration Guide](../migration/to-resources.md)
