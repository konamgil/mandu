import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  renderMetadata,
  createDefaultMetadata,
  resolveMetadata,
  renderSitemap,
  renderRobots,
  createDefaultRobots,
  createArticleJsonLd,
  createBreadcrumbJsonLd,
  createFAQJsonLd,
  createProductJsonLd,
  createWebSiteJsonLd,
  createOrganizationJsonLd,
  createLocalBusinessJsonLd,
  createVideoJsonLd,
  createEventJsonLd,
  type Metadata,
  type Sitemap,
  type RobotsFile,
  type JsonLd,
} from "@mandujs/core";
import { getProjectPaths, readJsonFile, writeJsonFile } from "../utils/project.js";
import * as fs from "fs";
import * as path from "path";

export const seoToolDefinitions: Tool[] = [
  {
    name: "mandu_preview_seo",
    description: "Preview rendered SEO HTML for given metadata. Useful for testing metadata before applying.",
    inputSchema: {
      type: "object",
      properties: {
        metadata: {
          type: "object",
          description: "Metadata object to render (title, description, openGraph, twitter, etc.)",
        },
      },
      required: ["metadata"],
    },
  },
  {
    name: "mandu_generate_sitemap_preview",
    description: "Generate sitemap.xml preview from entries",
    inputSchema: {
      type: "object",
      properties: {
        entries: {
          type: "array",
          description: "Array of sitemap entries with url, lastModified, changeFrequency, priority",
          items: {
            type: "object",
            properties: {
              url: { type: "string", description: "Page URL" },
              lastModified: { type: "string", description: "Last modified date (ISO string)" },
              changeFrequency: {
                type: "string",
                enum: ["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"],
              },
              priority: { type: "number", description: "Priority 0.0 to 1.0" },
              images: {
                type: "array",
                items: { type: "string" },
                description: "Image URLs for this page",
              },
            },
            required: ["url"],
          },
        },
      },
      required: ["entries"],
    },
  },
  {
    name: "mandu_generate_robots_preview",
    description: "Generate robots.txt preview from configuration",
    inputSchema: {
      type: "object",
      properties: {
        rules: {
          type: "object",
          description: "Robots rules (userAgent, allow, disallow, crawlDelay)",
        },
        sitemap: {
          type: "string",
          description: "Sitemap URL",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu_create_jsonld",
    description: "Create JSON-LD structured data for SEO. Supports Article, WebSite, Organization, Breadcrumb, FAQ, Product, LocalBusiness, Video, Event types.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["Article", "WebSite", "Organization", "Breadcrumb", "FAQ", "Product", "LocalBusiness", "Video", "Event"],
          description: "Type of JSON-LD to create",
        },
        data: {
          type: "object",
          description: "Data for the JSON-LD (varies by type)",
        },
      },
      required: ["type", "data"],
    },
  },
  {
    name: "mandu_write_seo_file",
    description: "Write SEO configuration file (sitemap.ts or robots.ts) to app directory",
    inputSchema: {
      type: "object",
      properties: {
        fileType: {
          type: "string",
          enum: ["sitemap", "robots"],
          description: "Type of SEO file to create",
        },
        config: {
          type: "object",
          description: "Configuration object for the file",
        },
      },
      required: ["fileType"],
    },
  },
  {
    name: "mandu_seo_analyze",
    description: "Analyze SEO metadata for common issues and provide recommendations",
    inputSchema: {
      type: "object",
      properties: {
        metadata: {
          type: "object",
          description: "Metadata object to analyze",
        },
        url: {
          type: "string",
          description: "Page URL for context",
        },
      },
      required: ["metadata"],
    },
  },
];

export function seoTools(projectRoot: string) {
  const paths = getProjectPaths(projectRoot);

  return {
    mandu_preview_seo: async (args: Record<string, unknown>) => {
      const { metadata } = args as { metadata: Metadata };

      try {
        // Create resolved metadata from input
        const resolved = await resolveMetadata([metadata]);
        const html = renderMetadata(resolved);

        return {
          success: true,
          html,
          resolved: {
            title: resolved.title?.absolute,
            description: resolved.description,
            hasOpenGraph: !!resolved.openGraph,
            hasTwitter: !!resolved.twitter,
            hasJsonLd: !!resolved.jsonLd && resolved.jsonLd.length > 0,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    mandu_generate_sitemap_preview: async (args: Record<string, unknown>) => {
      const { entries } = args as { entries: Sitemap };

      try {
        // Convert date strings to Date objects
        const processedEntries = entries.map((entry) => ({
          ...entry,
          lastModified: entry.lastModified
            ? new Date(entry.lastModified as string)
            : undefined,
        }));

        const xml = renderSitemap(processedEntries);

        return {
          success: true,
          xml,
          entryCount: entries.length,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    mandu_generate_robots_preview: async (args: Record<string, unknown>) => {
      const { rules, sitemap } = args as {
        rules?: RobotsFile["rules"];
        sitemap?: string;
      };

      try {
        const robotsConfig: RobotsFile = rules
          ? { rules, sitemap }
          : createDefaultRobots(sitemap || "");

        const txt = renderRobots(robotsConfig);

        return {
          success: true,
          txt,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    mandu_create_jsonld: async (args: Record<string, unknown>) => {
      const { type, data } = args as { type: string; data: Record<string, unknown> };

      try {
        let jsonLd: JsonLd;

        switch (type) {
          case "Article":
            jsonLd = createArticleJsonLd(data as Parameters<typeof createArticleJsonLd>[0]);
            break;
          case "WebSite":
            jsonLd = createWebSiteJsonLd(data as Parameters<typeof createWebSiteJsonLd>[0]);
            break;
          case "Organization":
            jsonLd = createOrganizationJsonLd(data as Parameters<typeof createOrganizationJsonLd>[0]);
            break;
          case "Breadcrumb":
            jsonLd = createBreadcrumbJsonLd(data as Array<{ name: string; url: string }>);
            break;
          case "FAQ":
            jsonLd = createFAQJsonLd(data as Array<{ question: string; answer: string }>);
            break;
          case "Product":
            jsonLd = createProductJsonLd(data as Parameters<typeof createProductJsonLd>[0]);
            break;
          case "LocalBusiness":
            jsonLd = createLocalBusinessJsonLd(data as Parameters<typeof createLocalBusinessJsonLd>[0]);
            break;
          case "Video":
            jsonLd = createVideoJsonLd(data as Parameters<typeof createVideoJsonLd>[0]);
            break;
          case "Event":
            jsonLd = createEventJsonLd(data as Parameters<typeof createEventJsonLd>[0]);
            break;
          default:
            return {
              success: false,
              error: `Unknown JSON-LD type: ${type}`,
            };
        }

        return {
          success: true,
          jsonLd,
          script: `<script type="application/ld+json">${JSON.stringify(jsonLd, null, 2)}</script>`,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    mandu_write_seo_file: async (args: Record<string, unknown>) => {
      const { fileType, config } = args as {
        fileType: "sitemap" | "robots";
        config?: Record<string, unknown>;
      };

      try {
        const appDir = path.join(projectRoot, "app");

        // Ensure app directory exists
        if (!fs.existsSync(appDir)) {
          fs.mkdirSync(appDir, { recursive: true });
        }

        let filePath: string;
        let content: string;

        if (fileType === "sitemap") {
          filePath = path.join(appDir, "sitemap.ts");
          content = `import type { Sitemap } from '@mandujs/core'

export default function sitemap(): Sitemap {
  return [
    {
      url: 'https://example.com',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    // Add more entries here
  ]
}
`;
        } else {
          filePath = path.join(appDir, "robots.ts");
          content = `import type { RobotsFile } from '@mandujs/core'

export default function robots(): RobotsFile {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/private'],
    },
    sitemap: 'https://example.com/sitemap.xml',
  }
}
`;
        }

        fs.writeFileSync(filePath, content, "utf-8");

        return {
          success: true,
          filePath,
          message: `Created ${fileType}.ts at ${filePath}`,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    mandu_seo_analyze: async (args: Record<string, unknown>) => {
      const { metadata, url } = args as { metadata: Metadata; url?: string };

      const issues: Array<{ severity: "error" | "warning" | "info"; message: string }> = [];
      const recommendations: string[] = [];

      // Title checks
      if (!metadata.title) {
        issues.push({ severity: "error", message: "Missing title" });
      } else if (typeof metadata.title === "string") {
        if (metadata.title.length < 10) {
          issues.push({ severity: "warning", message: "Title is too short (< 10 chars)" });
        } else if (metadata.title.length > 60) {
          issues.push({ severity: "warning", message: "Title is too long (> 60 chars)" });
        }
      }

      // Description checks
      if (!metadata.description) {
        issues.push({ severity: "error", message: "Missing description" });
      } else if (metadata.description.length < 50) {
        issues.push({ severity: "warning", message: "Description is too short (< 50 chars)" });
      } else if (metadata.description.length > 160) {
        issues.push({ severity: "warning", message: "Description is too long (> 160 chars)" });
      }

      // Open Graph checks
      if (!metadata.openGraph) {
        issues.push({ severity: "warning", message: "Missing Open Graph metadata" });
        recommendations.push("Add openGraph with title, description, and images for better social sharing");
      } else {
        if (!metadata.openGraph.images) {
          issues.push({ severity: "warning", message: "Missing Open Graph image" });
        }
      }

      // Twitter checks
      if (!metadata.twitter) {
        issues.push({ severity: "info", message: "Missing Twitter Card metadata" });
        recommendations.push("Add twitter card metadata for Twitter sharing");
      }

      // JSON-LD checks
      if (!metadata.jsonLd) {
        recommendations.push("Add JSON-LD structured data for rich search results");
      }

      // Viewport check
      if (!metadata.viewport) {
        recommendations.push("Add viewport meta for mobile optimization");
      }

      // Calculate score
      const errorCount = issues.filter((i) => i.severity === "error").length;
      const warningCount = issues.filter((i) => i.severity === "warning").length;
      const score = Math.max(0, 100 - errorCount * 20 - warningCount * 10);

      return {
        score,
        issues,
        recommendations,
        summary: `SEO Score: ${score}/100 (${errorCount} errors, ${warningCount} warnings)`,
      };
    },
  };
}
