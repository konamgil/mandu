import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import path from "path";
import fs from "fs/promises";

export const componentToolDefinitions: Tool[] = [
  {
    name: "mandu_add_component",
    description:
      "Scaffold a new client-side component in the correct FSD (Feature-Sliced Design) layer. " +
      "Mandu projects organize client components under src/client/ following FSD layers: " +
      "shared (reusable primitives), entities (domain objects), features (user interactions), " +
      "widgets (composite blocks), pages (page-level controllers). " +
      "Creates the component file and updates the layer's public API index.ts. " +
      "Use this instead of manually creating files in app/ to maintain FSD architecture.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Component name in PascalCase (e.g., 'ReactionBar', 'UserAvatar')",
        },
        layer: {
          type: "string",
          enum: ["shared", "entities", "features", "widgets", "pages"],
          description:
            "FSD layer: " +
            "'shared' (reusable UI primitives, utils — no business logic), " +
            "'entities' (domain models and their UI — User, Message, Post), " +
            "'features' (user interactions that change state — like, comment, follow), " +
            "'widgets' (composite sections combining entities+features), " +
            "'pages' (page-level client components — use sparingly, prefer features/entities)",
        },
        slice: {
          type: "string",
          description:
            "Feature slice name in kebab-case (required for features/entities/widgets). " +
            "Examples: 'chat-reaction', 'user-profile', 'post-feed'. " +
            "For 'shared' layer, use segment name like 'ui', 'lib', 'api'.",
        },
        segment: {
          type: "string",
          enum: ["ui", "model", "api", "lib", "config"],
          description: "Segment within the slice (default: 'ui'). 'ui' for React components, 'model' for hooks/store, 'api' for data fetching.",
        },
        description: {
          type: "string",
          description: "Brief description of what this component does (added as a comment)",
        },
      },
      required: ["name", "layer"],
    },
  },
];

function toKebabCase(name: string): string {
  return name
    .replace(/([A-Z])/g, "-$1")
    .toLowerCase()
    .replace(/^-/, "");
}

export function componentTools(projectRoot: string) {
  return {
    mandu_add_component: async (args: Record<string, unknown>) => {
      const {
        name,
        layer,
        slice,
        segment = "ui",
        description = "",
      } = args as {
        name: string;
        layer: "shared" | "entities" | "features" | "widgets" | "pages";
        slice?: string;
        segment?: string;
        description?: string;
      };

      // Validate: features/entities/widgets require a slice
      if (["features", "entities", "widgets"].includes(layer) && !slice) {
        return {
          success: false,
          error: `The '${layer}' layer requires a 'slice' name (e.g., 'chat-reaction', 'user-profile').`,
        };
      }

      // Build the file path
      const clientBase = path.join(projectRoot, "src", "client");
      let componentDir: string;
      let indexPath: string;

      if (layer === "shared") {
        const sliceName = slice || "ui";
        componentDir = path.join(clientBase, "shared", sliceName);
        indexPath = path.join(clientBase, "shared", sliceName, "index.ts");
      } else if (layer === "pages") {
        componentDir = path.join(clientBase, "pages");
        indexPath = path.join(clientBase, "pages", "index.ts");
      } else {
        const sliceName = slice!;
        componentDir = path.join(clientBase, layer, sliceName, segment);
        indexPath = path.join(clientBase, layer, sliceName, "index.ts");
      }

      const kebabName = toKebabCase(name);
      const componentFile = path.join(componentDir, `${kebabName}.tsx`);
      const relativePath = path.relative(projectRoot, componentFile).replace(/\\/g, "/");

      // Check if file already exists
      try {
        await fs.access(componentFile);
        return {
          success: false,
          error: `Component file already exists: ${relativePath}`,
        };
      } catch {
        // Good - file doesn't exist
      }

      // Create directory
      await fs.mkdir(componentDir, { recursive: true });

      // Generate component template
      const descComment = description ? `\n * ${description}` : "";
      const template = `/**
 * ${name} Component${descComment}
 * Layer: ${layer}${slice ? ` / ${slice}` : ""}
 */

import { useState } from "react";

interface ${name}Props {
  // TODO: Define props
  className?: string;
}

export function ${name}({ className }: ${name}Props) {
  return (
    <div className={className}>
      {/* TODO: Implement ${name} */}
    </div>
  );
}
`;

      await fs.writeFile(componentFile, template, "utf-8");

      // Update index.ts (create or append export)
      const exportLine = `export { ${name} } from "./${segment}/${kebabName}.js";\n`;
      const simpleExportLine = `export { ${name} } from "./${kebabName}.js";\n`;

      try {
        let indexContent = "";
        try {
          indexContent = await fs.readFile(indexPath, "utf-8");
        } catch {
          // index.ts doesn't exist yet
        }

        const exportToAdd = layer === "shared" || layer === "pages" ? simpleExportLine : exportLine;

        if (!indexContent.includes(`{ ${name} }`)) {
          await fs.writeFile(indexPath, indexContent + exportToAdd, "utf-8");
        }
      } catch {
        // index update failed - not critical
      }

      return {
        success: true,
        component: name,
        layer,
        slice: slice || null,
        segment,
        createdFiles: [relativePath],
        updatedFiles: [path.relative(projectRoot, indexPath).replace(/\\/g, "/")],
        message: `Created ${name} in ${layer}${slice ? `/${slice}` : ""}/${segment}`,
        nextSteps: [
          `Edit ${relativePath} to implement the component`,
          `Import with: import { ${name} } from "@/client/${layer}${slice ? `/${slice}` : ""}"`,
        ],
      };
    },
  };
}
