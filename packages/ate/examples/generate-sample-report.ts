#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateHtmlTemplate } from "../src/reporter/html-template";
import type { SummaryJson } from "../src/types";

const __filename = fileURLToPath(import.meta.url);
const examplesDir = dirname(__filename);
const summaryPath = join(examplesDir, "sample-summary.json");
const outputPath = join(examplesDir, "sample-report.html");

const summaryContent = readFileSync(summaryPath, "utf-8");
const summary: SummaryJson = JSON.parse(summaryContent);

const screenshotUrls = [
  "https://via.placeholder.com/800x600/4CAF50/FFFFFF?text=Login+Page+Screenshot",
  "https://via.placeholder.com/800x600/2196F3/FFFFFF?text=Dashboard+Screenshot",
  "https://via.placeholder.com/800x600/FF9800/FFFFFF?text=Error+State+Screenshot",
];

const html = generateHtmlTemplate(summary, screenshotUrls);

writeFileSync(outputPath, html, "utf-8");

console.log(`✅ Sample HTML report generated at: ${outputPath}`);
console.log(`   Open it in your browser to view the report`);
