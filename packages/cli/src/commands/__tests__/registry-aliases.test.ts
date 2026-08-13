/**
 * Tests for the `aliases` field on CommandRegistration.
 *
 * Background: issue #256 reported that `mandu create` (the spelling
 * documented in mandujs.com/docs/start/quickstart) returned
 * CLI_E100 (Unknown command) because only `init` was bound. We added
 * an `aliases` field to CommandRegistration so the same registration
 * dispatches under multiple names without forcing the registration
 * body to be duplicated (PR #255 took the duplication route — the
 * infra here lets us collapse it back).
 *
 * Side-discovery: the help text already advertised `mandu g` as an
 * alias of `mandu guard` via a hardcoded special-case, but `g` was
 * never bound in the registry — `mandu g` printed CLI_E100. The
 * tests below also assert the alias is real now.
 */

import { describe, expect, test } from "bun:test";

import {
  registerCommand,
  getCommand,
  getAllCommands,
  getAllCommandRegistrations,
  commandRegistry,
  type CommandRegistration,
} from "../registry";

describe("CommandRegistration.aliases", () => {
  test("guard alias `g` dispatches to guard (was a docs-only alias before)", () => {
    const guard = getCommand("guard");
    const g = getCommand("g");
    expect(guard).toBeDefined();
    expect(g).toBe(guard!);
  });

  test("getAllCommands surfaces both canonical id and aliases", () => {
    const keys = getAllCommands();
    expect(keys).toContain("init");
    expect(keys).toContain("create");
    expect(keys).toContain("guard");
    expect(keys).toContain("g");
  });

  test("getAllCommandRegistrations dedupes by registration object", () => {
    const all = getAllCommandRegistrations();
    const guardCount = all.filter((r) => r.id === "guard").length;
    expect(guardCount).toBe(1);
    // `g` is a real alias of `guard`, so the deduped list is strictly
    // smaller than the raw key list.
    expect(all.length).toBeLessThan(getAllCommands().length);
  });

  test("init and create are now distinct registrations (Phase 2 split)", () => {
    // Phase 1 had `create` registered as an alias of `init`. Phase 2
    // splits the semantics — `init` is retrofit, `create` is scaffold.
    const init = getCommand("init")!;
    const create = getCommand("create")!;
    expect(init).not.toBe(create);
    // Neither carries the other in its aliases list.
    expect(init.aliases ?? []).not.toContain("create");
    expect(create.aliases ?? []).not.toContain("init");
  });

  test("guard registration exposes `g` in its aliases array", () => {
    const guard = getCommand("guard")!;
    expect(guard.aliases).toEqual(["g"]);
  });

  test("one-shot guardrail commands exit after successful completion", () => {
    expect(getCommand("guard")?.exitOnSuccess).toBe(true);
    expect(getCommand("check")?.exitOnSuccess).toBe(true);
    expect(getCommand("lock")?.exitOnSuccess).toBe(true);
  });

  test("registerCommand throws when an alias collides with an existing command", () => {
    // Pick an alias that already exists as a canonical id.
    const collidingRegistration: CommandRegistration = {
      id: "__test_alias_collide_canonical__",
      aliases: ["dev"],
      description: "test fixture — should fail to register",
      async run() {
        return true;
      },
    };
    expect(() => registerCommand(collidingRegistration)).toThrow(
      /collides with existing command "dev"/
    );
    // Cleanup: ensure the canonical id wasn't left behind. registerCommand
    // sets the canonical key before iterating aliases, so a partial state
    // is possible — we explicitly remove it so the rest of the suite is
    // not contaminated.
    commandRegistry.delete("__test_alias_collide_canonical__");
  });

  test("registerCommand is idempotent when the same alias is re-registered", () => {
    // Re-registering the existing init registration with its real alias
    // must not throw, because the alias resolves to the same object.
    const init = getCommand("init")!;
    expect(() => registerCommand(init)).not.toThrow();
  });
});
