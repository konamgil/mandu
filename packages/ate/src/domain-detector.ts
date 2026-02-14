/**
 * Domain detection for context-aware test assertions
 * Analyzes route paths, imports, and keywords to identify application domain
 */

export type AppDomain = "ecommerce" | "blog" | "dashboard" | "auth" | "generic";

export interface DomainDetectionResult {
  domain: AppDomain;
  confidence: number; // 0-1
  signals: string[];
}

interface DomainPattern {
  domain: AppDomain;
  routePatterns: RegExp[];
  importKeywords: string[];
  codeKeywords: string[];
}

const DOMAIN_PATTERNS: DomainPattern[] = [
  {
    domain: "ecommerce",
    routePatterns: [
      /\/shop/i,
      /\/cart/i,
      /\/checkout/i,
      /\/product/i,
      /\/order/i,
      /\/payment/i,
    ],
    importKeywords: ["stripe", "commerce", "cart", "checkout", "payment"],
    codeKeywords: ["addToCart", "removeFromCart", "checkout", "price", "product", "order"],
  },
  {
    domain: "blog",
    routePatterns: [
      /\/blog/i,
      /\/post/i,
      /\/article/i,
      /\/author/i,
      /\/category/i,
    ],
    importKeywords: ["markdown", "mdx", "contentlayer", "sanity", "cms"],
    codeKeywords: ["post", "article", "author", "publish", "content", "comment"],
  },
  {
    domain: "dashboard",
    routePatterns: [
      /\/dashboard/i,
      /\/admin/i,
      /\/analytics/i,
      /\/settings/i,
      /\/profile/i,
    ],
    importKeywords: ["chart", "recharts", "d3", "analytics", "table", "zustand", "react-query"],
    codeKeywords: ["chart", "table", "sidebar", "analytics", "report", "metric"],
  },
  {
    domain: "auth",
    routePatterns: [
      /\/login/i,
      /\/signup/i,
      /\/register/i,
      /\/auth/i,
      /\/forgot-password/i,
    ],
    importKeywords: ["auth", "clerk", "nextauth", "supabase", "firebase"],
    codeKeywords: ["login", "logout", "signup", "register", "authenticate", "session"],
  },
];

/**
 * Detect application domain from route path
 */
export function detectDomainFromRoute(routePath: string): DomainDetectionResult {
  const results: Array<{ domain: AppDomain; score: number; signals: string[] }> = [];

  for (const pattern of DOMAIN_PATTERNS) {
    const signals: string[] = [];
    let score = 0;

    for (const regex of pattern.routePatterns) {
      if (regex.test(routePath)) {
        score += 1;
        signals.push(`route pattern: ${regex.source}`);
      }
    }

    if (score > 0) {
      results.push({ domain: pattern.domain, score, signals });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  if (results.length > 0 && results[0].score > 0) {
    const best = results[0];
    return {
      domain: best.domain,
      confidence: Math.min(best.score / 2, 1), // Normalize confidence
      signals: best.signals,
    };
  }

  return {
    domain: "generic",
    confidence: 1,
    signals: ["no domain-specific patterns detected"],
  };
}

/**
 * Detect application domain from source code content
 */
export function detectDomainFromSource(sourceCode: string): DomainDetectionResult {
  const results: Array<{ domain: AppDomain; score: number; signals: string[] }> = [];

  for (const pattern of DOMAIN_PATTERNS) {
    const signals: string[] = [];
    let score = 0;

    // Check import keywords
    for (const keyword of pattern.importKeywords) {
      const importRegex = new RegExp(`import\\s+.*from\\s+["'].*${keyword}.*["']`, "i");
      if (importRegex.test(sourceCode)) {
        score += 2;
        signals.push(`import: ${keyword}`);
      }
    }

    // Check code keywords
    for (const keyword of pattern.codeKeywords) {
      const codeRegex = new RegExp(`\\b${keyword}\\b`, "i");
      if (codeRegex.test(sourceCode)) {
        score += 1;
        signals.push(`code keyword: ${keyword}`);
      }
    }

    if (score > 0) {
      results.push({ domain: pattern.domain, score, signals });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  if (results.length > 0 && results[0].score >= 3) {
    const best = results[0];
    return {
      domain: best.domain,
      confidence: Math.min(best.score / 10, 1), // Normalize confidence
      signals: best.signals.slice(0, 5), // Limit signals
    };
  }

  return {
    domain: "generic",
    confidence: 1,
    signals: ["no strong domain signals in source code"],
  };
}

/**
 * Combine multiple detection strategies
 */
export function detectDomain(routePath: string, sourceCode?: string): DomainDetectionResult {
  const routeResult = detectDomainFromRoute(routePath);

  if (!sourceCode) {
    return routeResult;
  }

  const sourceResult = detectDomainFromSource(sourceCode);

  // If both agree, combine confidence
  if (routeResult.domain === sourceResult.domain) {
    return {
      domain: routeResult.domain,
      confidence: Math.min((routeResult.confidence + sourceResult.confidence) / 2 + 0.2, 1),
      signals: [...routeResult.signals, ...sourceResult.signals],
    };
  }

  // If they disagree, prefer route result if it's not generic
  if (routeResult.domain !== "generic") {
    return routeResult;
  }

  // Otherwise use source result
  return sourceResult;
}
