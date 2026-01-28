/**
 * Contract Guard Tests
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import {
  checkMissingContract,
  checkContractFileExists,
  checkContractSlotConsistency,
  runContractGuardCheck,
} from "./contract-guard";
import type { RoutesManifest } from "../spec/schema";

const TEST_DIR = path.join(process.cwd(), ".test-guard");

describe("Contract Guard", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await mkdir(path.join(TEST_DIR, "spec/contracts"), { recursive: true });
    await mkdir(path.join(TEST_DIR, "spec/slots"), { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("checkMissingContract", () => {
    test("should detect API routes without contracts", async () => {
      const manifest: RoutesManifest = {
        version: 1,
        routes: [
          {
            id: "users",
            pattern: "/api/users",
            kind: "api",
            module: "generated/routes/api/users.ts",
            slotModule: "spec/slots/users.slot.ts",
            // No contractModule
          },
        ],
      };

      const violations = await checkMissingContract(manifest, TEST_DIR);

      expect(violations.length).toBe(1);
      expect(violations[0].ruleId).toBe("CONTRACT_MISSING");
      expect(violations[0].routeId).toBe("users");
    });

    test("should pass API routes with contracts", async () => {
      const manifest: RoutesManifest = {
        version: 1,
        routes: [
          {
            id: "users",
            pattern: "/api/users",
            kind: "api",
            module: "generated/routes/api/users.ts",
            slotModule: "spec/slots/users.slot.ts",
            contractModule: "spec/contracts/users.contract.ts",
          },
        ],
      };

      const violations = await checkMissingContract(manifest, TEST_DIR);

      expect(violations.length).toBe(0);
    });

    test("should skip non-API routes", async () => {
      const manifest: RoutesManifest = {
        version: 1,
        routes: [
          {
            id: "home",
            pattern: "/",
            kind: "page",
            module: "generated/routes/home.ts",
            slotModule: "spec/slots/home.slot.ts",
            // No contractModule - but that's fine for pages
          },
        ],
      };

      const violations = await checkMissingContract(manifest, TEST_DIR);

      expect(violations.length).toBe(0);
    });
  });

  describe("checkContractFileExists", () => {
    test("should detect missing contract files", async () => {
      const manifest: RoutesManifest = {
        version: 1,
        routes: [
          {
            id: "users",
            pattern: "/api/users",
            kind: "api",
            module: "generated/routes/api/users.ts",
            contractModule: "spec/contracts/users.contract.ts",
          },
        ],
      };

      const violations = await checkContractFileExists(manifest, TEST_DIR);

      expect(violations.length).toBe(1);
      expect(violations[0].ruleId).toBe("CONTRACT_NOT_FOUND");
    });

    test("should pass when contract file exists", async () => {
      // Create contract file
      await writeFile(
        path.join(TEST_DIR, "spec/contracts/users.contract.ts"),
        `export default { request: {}, response: {} }`
      );

      const manifest: RoutesManifest = {
        version: 1,
        routes: [
          {
            id: "users",
            pattern: "/api/users",
            kind: "api",
            module: "generated/routes/api/users.ts",
            contractModule: "spec/contracts/users.contract.ts",
          },
        ],
      };

      const violations = await checkContractFileExists(manifest, TEST_DIR);

      expect(violations.length).toBe(0);
    });
  });

  describe("checkContractSlotConsistency", () => {
    test("should detect methods in contract but not in slot", async () => {
      // Create contract with GET and POST
      await writeFile(
        path.join(TEST_DIR, "spec/contracts/users.contract.ts"),
        `
        export default {
          request: {
            GET: { query: {} },
            POST: { body: {} },
            DELETE: {},
          },
          response: {},
        };
        `
      );

      // Create slot with only GET
      await writeFile(
        path.join(TEST_DIR, "spec/slots/users.slot.ts"),
        `
        export default Mandu.filling()
          .get((ctx) => ctx.ok({ data: [] }));
        `
      );

      const manifest: RoutesManifest = {
        version: 1,
        routes: [
          {
            id: "users",
            pattern: "/api/users",
            kind: "api",
            module: "generated/routes/api/users.ts",
            contractModule: "spec/contracts/users.contract.ts",
            slotModule: "spec/slots/users.slot.ts",
          },
        ],
      };

      const violations = await checkContractSlotConsistency(manifest, TEST_DIR);

      expect(violations.length).toBe(1);
      expect(violations[0].ruleId).toBe("CONTRACT_METHOD_NOT_IMPLEMENTED");
      expect(violations[0].missingMethods).toContain("POST");
      expect(violations[0].missingMethods).toContain("DELETE");
    });

    test("should detect methods in slot but not in contract", async () => {
      // Create contract with only GET
      await writeFile(
        path.join(TEST_DIR, "spec/contracts/users.contract.ts"),
        `
        export default {
          request: {
            GET: { query: {} },
          },
          response: {},
        };
        `
      );

      // Create slot with GET, POST, and DELETE
      await writeFile(
        path.join(TEST_DIR, "spec/slots/users.slot.ts"),
        `
        export default Mandu.filling()
          .get((ctx) => ctx.ok({ data: [] }))
          .post((ctx) => ctx.created({}))
          .delete((ctx) => ctx.noContent());
        `
      );

      const manifest: RoutesManifest = {
        version: 1,
        routes: [
          {
            id: "users",
            pattern: "/api/users",
            kind: "api",
            module: "generated/routes/api/users.ts",
            contractModule: "spec/contracts/users.contract.ts",
            slotModule: "spec/slots/users.slot.ts",
          },
        ],
      };

      const violations = await checkContractSlotConsistency(manifest, TEST_DIR);

      expect(violations.length).toBe(1);
      expect(violations[0].ruleId).toBe("CONTRACT_METHOD_UNDOCUMENTED");
      expect(violations[0].undocumentedMethods).toContain("POST");
      expect(violations[0].undocumentedMethods).toContain("DELETE");
    });

    test("should pass when contract and slot are in sync", async () => {
      // Create contract with GET and POST
      await writeFile(
        path.join(TEST_DIR, "spec/contracts/users.contract.ts"),
        `
        export default {
          request: {
            GET: { query: {} },
            POST: { body: {} },
          },
          response: {},
        };
        `
      );

      // Create slot with GET and POST
      await writeFile(
        path.join(TEST_DIR, "spec/slots/users.slot.ts"),
        `
        export default Mandu.filling()
          .get((ctx) => ctx.ok({ data: [] }))
          .post((ctx) => ctx.created({}));
        `
      );

      const manifest: RoutesManifest = {
        version: 1,
        routes: [
          {
            id: "users",
            pattern: "/api/users",
            kind: "api",
            module: "generated/routes/api/users.ts",
            contractModule: "spec/contracts/users.contract.ts",
            slotModule: "spec/slots/users.slot.ts",
          },
        ],
      };

      const violations = await checkContractSlotConsistency(manifest, TEST_DIR);

      expect(violations.length).toBe(0);
    });
  });

  describe("runContractGuardCheck", () => {
    test("should run all checks", async () => {
      // Missing contract file
      const manifest: RoutesManifest = {
        version: 1,
        routes: [
          {
            id: "users",
            pattern: "/api/users",
            kind: "api",
            module: "generated/routes/api/users.ts",
            contractModule: "spec/contracts/users.contract.ts",
            slotModule: "spec/slots/users.slot.ts",
          },
        ],
      };

      const violations = await runContractGuardCheck(manifest, TEST_DIR);

      // Should find CONTRACT_NOT_FOUND
      expect(violations.some((v) => v.ruleId === "CONTRACT_NOT_FOUND")).toBe(true);
    });
  });
});
