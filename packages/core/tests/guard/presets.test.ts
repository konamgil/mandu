/**
 * Guard Presets Tests
 */

import { describe, it, expect } from "vitest";
import {
  presets,
  getPreset,
  listPresets,
  fsdPreset,
  cleanPreset,
  hexagonalPreset,
  atomicPreset,
  manduPreset,
  FSD_HIERARCHY,
  CLEAN_HIERARCHY,
  HEXAGONAL_HIERARCHY,
  ATOMIC_HIERARCHY,
} from "../../src/guard/presets";

describe("presets", () => {
  it("should have all preset definitions", () => {
    expect(presets.fsd).toBe(fsdPreset);
    expect(presets.clean).toBe(cleanPreset);
    expect(presets.hexagonal).toBe(hexagonalPreset);
    expect(presets.atomic).toBe(atomicPreset);
    expect(presets.mandu).toBe(manduPreset);
  });

  it("should get preset by name", () => {
    expect(getPreset("fsd")).toBe(fsdPreset);
    expect(getPreset("clean")).toBe(cleanPreset);
    expect(getPreset("hexagonal")).toBe(hexagonalPreset);
    expect(getPreset("atomic")).toBe(atomicPreset);
    expect(getPreset("mandu")).toBe(manduPreset);
  });

  it("should throw for unknown preset", () => {
    expect(() => getPreset("unknown" as any)).toThrow("Unknown guard preset");
  });

  it("should list all presets", () => {
    const list = listPresets();
    expect(list).toHaveLength(5);
    expect(list.map((p) => p.name)).toEqual(["fsd", "clean", "hexagonal", "atomic", "mandu"]);
  });
});

describe("FSD preset", () => {
  it("should have correct hierarchy", () => {
    expect(FSD_HIERARCHY).toEqual(["app", "pages", "widgets", "features", "entities", "shared"]);
  });

  it("should have all layers defined", () => {
    const layerNames = fsdPreset.layers.map((l) => l.name);
    expect(layerNames).toEqual(["app", "pages", "widgets", "features", "entities", "shared"]);
  });

  it("should enforce dependency rules", () => {
    const features = fsdPreset.layers.find((l) => l.name === "features")!;
    expect(features.canImport).toEqual(["entities", "shared"]);
    expect(features.canImport).not.toContain("widgets");
    expect(features.canImport).not.toContain("pages");

    const shared = fsdPreset.layers.find((l) => l.name === "shared")!;
    expect(shared.canImport).toEqual([]);
  });
});

describe("Clean Architecture preset", () => {
  it("should have correct hierarchy", () => {
    expect(CLEAN_HIERARCHY).toEqual(["api", "infra", "application", "domain", "core", "shared"]);
  });

  it("should have domain layer with no external deps except shared", () => {
    const domain = cleanPreset.layers.find((l) => l.name === "domain")!;
    expect(domain.canImport).toEqual(["shared"]);
  });

  it("should allow infra to import domain and application", () => {
    const infra = cleanPreset.layers.find((l) => l.name === "infra")!;
    expect(infra.canImport).toContain("application");
    expect(infra.canImport).toContain("domain");
  });
});

describe("Hexagonal Architecture preset", () => {
  it("should have correct hierarchy", () => {
    expect(HEXAGONAL_HIERARCHY).toEqual(["adapters/in", "adapters/out", "application", "ports", "domain"]);
  });

  it("should have pure domain layer", () => {
    const domain = hexagonalPreset.layers.find((l) => l.name === "domain")!;
    expect(domain.canImport).toEqual([]);
  });

  it("should allow ports to import only domain", () => {
    const ports = hexagonalPreset.layers.find((l) => l.name === "ports")!;
    expect(ports.canImport).toEqual(["domain"]);
  });

  it("should allow adapters to import application and ports", () => {
    const adapterIn = hexagonalPreset.layers.find((l) => l.name === "adapters/in")!;
    expect(adapterIn.canImport).toContain("application");
    expect(adapterIn.canImport).toContain("ports");
    expect(adapterIn.canImport).not.toContain("domain");
  });
});

describe("Atomic Design preset", () => {
  it("should have correct hierarchy", () => {
    expect(ATOMIC_HIERARCHY).toEqual(["pages", "templates", "organisms", "molecules", "atoms"]);
  });

  it("should have atoms with no deps", () => {
    const atoms = atomicPreset.layers.find((l) => l.name === "atoms")!;
    expect(atoms.canImport).toEqual([]);
  });

  it("should allow molecules to import only atoms", () => {
    const molecules = atomicPreset.layers.find((l) => l.name === "molecules")!;
    expect(molecules.canImport).toEqual(["atoms"]);
  });

  it("should allow organisms to import molecules and atoms", () => {
    const organisms = atomicPreset.layers.find((l) => l.name === "organisms")!;
    expect(organisms.canImport).toContain("molecules");
    expect(organisms.canImport).toContain("atoms");
  });
});

describe("Mandu preset", () => {
  it("should combine client FSD and server Clean Architecture", () => {
    const layerNames = manduPreset.layers.map((l) => l.name);

    // FSD layers
    expect(layerNames).toContain("client/app");
    expect(layerNames).toContain("client/pages");
    expect(layerNames).toContain("client/widgets");
    expect(layerNames).toContain("client/features");
    expect(layerNames).toContain("client/entities");

    // Clean layers
    expect(layerNames).toContain("server/api");
    expect(layerNames).toContain("server/application");
    expect(layerNames).toContain("server/domain");
    expect(layerNames).toContain("server/infra");

    // Shared layers
    expect(layerNames).toContain("server/core");
    expect(layerNames).toContain("shared/contracts");
    expect(layerNames).toContain("shared/types");
    expect(layerNames).toContain("shared/utils/client");
    expect(layerNames).toContain("shared/utils/server");
    expect(layerNames).toContain("shared/schema");
    expect(layerNames).toContain("shared/env");
  });
});

describe("preset default severities", () => {
  it("should have default severity settings", () => {
    expect(fsdPreset.defaultSeverity?.layerViolation).toBe("error");
    expect(fsdPreset.defaultSeverity?.circularDependency).toBe("warn");

    expect(cleanPreset.defaultSeverity?.layerViolation).toBe("error");
    expect(cleanPreset.defaultSeverity?.circularDependency).toBe("error");

    expect(hexagonalPreset.defaultSeverity?.circularDependency).toBe("error");
  });
});
