/**
 * DNA-015: Semantic Help System Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  formatHelpExample,
  formatHelpExampleGroup,
  formatHelpOption,
  formatHelpSubcommand,
  formatSectionTitle,
  renderHelp,
  renderCommandHelp,
  formatUsageHint,
  formatErrorHint,
  MANDU_HELP,
  type HelpDefinition,
} from "../../src/terminal/help";

describe("DNA-015: Semantic Help System", () => {
  // 테스트 시 색상 비활성화
  beforeEach(() => {
    process.env.NO_COLOR = "1";
  });

  afterEach(() => {
    delete process.env.NO_COLOR;
  });

  describe("formatHelpExample", () => {
    it("should format command and description", () => {
      const result = formatHelpExample("mandu dev", "Start development server");

      expect(result).toContain("mandu dev");
      expect(result).toContain("Start development server");
    });

    it("should indent properly", () => {
      const result = formatHelpExample("mandu build", "Build project");

      // 명령어는 2칸 들여쓰기
      expect(result.startsWith("  ")).toBe(true);
      // 설명은 4칸 들여쓰기
      expect(result).toContain("\n    ");
    });
  });

  describe("formatHelpExampleGroup", () => {
    it("should format group with label and examples", () => {
      const result = formatHelpExampleGroup("Examples:", [
        ["mandu dev", "Start dev server"],
        ["mandu build", "Build project"],
      ]);

      expect(result).toContain("Examples:");
      expect(result).toContain("mandu dev");
      expect(result).toContain("mandu build");
    });
  });

  describe("formatHelpOption", () => {
    it("should format option with flags and description", () => {
      const result = formatHelpOption({
        flags: "--port",
        description: "Server port",
      });

      expect(result).toContain("--port");
      expect(result).toContain("Server port");
    });

    it("should include default value", () => {
      const result = formatHelpOption({
        flags: "--port",
        description: "Server port",
        default: "3000",
      });

      expect(result).toContain("(default: 3000)");
    });

    it("should mark required options", () => {
      const result = formatHelpOption({
        flags: "--name",
        description: "Project name",
        required: true,
      });

      expect(result).toContain("[required]");
    });
  });

  describe("formatHelpSubcommand", () => {
    it("should format subcommand with name and description", () => {
      const result = formatHelpSubcommand({
        name: "init",
        description: "Create a new project",
      });

      expect(result).toContain("init");
      expect(result).toContain("Create a new project");
    });

    it("should include aliases", () => {
      const result = formatHelpSubcommand({
        name: "guard",
        description: "Check architecture",
        aliases: ["g"],
      });

      expect(result).toContain("guard");
      expect(result).toContain("g");
    });
  });

  describe("formatSectionTitle", () => {
    it("should format section title", () => {
      const result = formatSectionTitle("Options:");
      expect(result).toBe("Options:");
    });
  });

  describe("renderHelp", () => {
    it("should render complete help", () => {
      const def: HelpDefinition = {
        name: "mandu",
        description: "Test CLI",
        usage: "mandu <command>",
        options: [
          { flags: "--help", description: "Show help" },
        ],
        subcommands: [
          { name: "init", description: "Initialize" },
        ],
        examples: [
          ["mandu init", "Create project"],
        ],
      };

      const result = renderHelp(def);

      expect(result).toContain("mandu - Test CLI");
      expect(result).toContain("Usage:");
      expect(result).toContain("Commands:");
      expect(result).toContain("Options:");
      expect(result).toContain("Examples:");
    });

    it("should include custom sections", () => {
      const def: HelpDefinition = {
        name: "test",
        description: "Test",
        sections: [
          { title: "Custom:", content: "  Custom content here" },
        ],
      };

      const result = renderHelp(def);
      expect(result).toContain("Custom:");
      expect(result).toContain("Custom content here");
    });

    it("should include see also references", () => {
      const def: HelpDefinition = {
        name: "test",
        description: "Test",
        seeAlso: ["https://example.com"],
      };

      const result = renderHelp(def);
      expect(result).toContain("See Also:");
      expect(result).toContain("https://example.com");
    });
  });

  describe("renderCommandHelp", () => {
    it("should render command-specific help", () => {
      const result = renderCommandHelp("dev", {
        description: "Start development server",
        options: [
          { flags: "--port", description: "Server port", default: "3000" },
        ],
      });

      expect(result).toContain("mandu dev");
      expect(result).toContain("Start development server");
      expect(result).toContain("--port");
    });
  });

  describe("formatUsageHint", () => {
    it("should format usage hint", () => {
      const result = formatUsageHint("mandu --help", "For more information:");

      expect(result).toContain("For more information:");
      expect(result).toContain("mandu --help");
    });
  });

  describe("formatErrorHint", () => {
    it("should format error with help hint", () => {
      const result = formatErrorHint("Unknown command", "mandu --help");

      expect(result).toContain("Unknown command");
      expect(result).toContain("mandu --help");
    });
  });

  describe("MANDU_HELP", () => {
    it("should have required fields", () => {
      expect(MANDU_HELP.name).toBe("mandu");
      expect(MANDU_HELP.description).toBeDefined();
      expect(MANDU_HELP.subcommands).toBeDefined();
      expect(MANDU_HELP.options).toBeDefined();
      expect(MANDU_HELP.examples).toBeDefined();
    });

    it("should have all main commands", () => {
      const commandNames = MANDU_HELP.subcommands?.map((s) => s.name) ?? [];

      expect(commandNames).toContain("init");
      expect(commandNames).toContain("dev");
      expect(commandNames).toContain("build");
      expect(commandNames).toContain("guard");
    });

    it("should render without errors", () => {
      const result = renderHelp(MANDU_HELP);
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
