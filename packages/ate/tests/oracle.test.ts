import { describe, test, expect } from "bun:test";
import {
  detectDomain,
  detectDomainFromRoute,
  detectDomainFromSource,
  type AppDomain,
} from "../src/domain-detector";
import {
  generateL1Assertions,
  upgradeL0ToL1,
  getAssertionCount,
} from "../src/oracle";

describe("Domain Detection", () => {
  describe("detectDomainFromRoute", () => {
    test("detects ecommerce domain from /cart route", () => {
      const result = detectDomainFromRoute("/cart");
      expect(result.domain).toBe("ecommerce");
      expect(result.confidence).toBeGreaterThan(0);
    });

    test("detects ecommerce domain from /shop/products route", () => {
      const result = detectDomainFromRoute("/shop/products");
      expect(result.domain).toBe("ecommerce");
      expect(result.confidence).toBeGreaterThan(0);
    });

    test("detects blog domain from /blog/post route", () => {
      const result = detectDomainFromRoute("/blog/post/123");
      expect(result.domain).toBe("blog");
      expect(result.confidence).toBeGreaterThan(0);
    });

    test("detects dashboard domain from /dashboard route", () => {
      const result = detectDomainFromRoute("/dashboard");
      expect(result.domain).toBe("dashboard");
      expect(result.confidence).toBeGreaterThan(0);
    });

    test("detects auth domain from /login route", () => {
      const result = detectDomainFromRoute("/login");
      expect(result.domain).toBe("auth");
      expect(result.confidence).toBeGreaterThan(0);
    });

    test("falls back to generic for unknown routes", () => {
      const result = detectDomainFromRoute("/random/path");
      expect(result.domain).toBe("generic");
      expect(result.confidence).toBe(1);
    });
  });

  describe("detectDomainFromSource", () => {
    test("detects ecommerce from import statements", () => {
      const source = `
        import { Cart } from "@/lib/cart";
        import { stripe } from "stripe";

        export default function CheckoutPage() {
          const cart = useCart();
          return <div>Checkout</div>;
        }
      `;
      const result = detectDomainFromSource(source);
      expect(result.domain).toBe("ecommerce");
      expect(result.confidence).toBeGreaterThan(0);
    });

    test("detects blog from code keywords", () => {
      const source = `
        export default function BlogPost({ post, author }) {
          return (
            <article>
              <h1>{post.title}</h1>
              <p>By {author.name}</p>
              <div>{post.content}</div>
            </article>
          );
        }
      `;
      const result = detectDomainFromSource(source);
      expect(result.domain).toBe("blog");
      expect(result.confidence).toBeGreaterThan(0);
    });

    test("detects dashboard from imports and keywords", () => {
      const source = `
        import { useQuery } from "react-query";
        import { Chart } from "recharts";

        export default function Analytics() {
          const { data } = useQuery("analytics");
          return <Chart data={data} />;
        }
      `;
      const result = detectDomainFromSource(source);
      expect(result.domain).toBe("dashboard");
      expect(result.confidence).toBeGreaterThan(0);
    });
  });

  describe("detectDomain (combined)", () => {
    test("combines route and source detection for higher confidence", () => {
      const source = `
        import { addToCart } from "@/lib/cart";
        export default function ProductPage() {
          return <button onClick={addToCart}>Add to Cart</button>;
        }
      `;
      const result = detectDomain("/product/123", source);
      expect(result.domain).toBe("ecommerce");
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    test("prefers route detection when source is not provided", () => {
      const result = detectDomain("/dashboard/analytics");
      expect(result.domain).toBe("dashboard");
    });
  });
});

describe("L1 Assertion Generation", () => {
  test("generates ecommerce cart assertions", () => {
    const assertions = generateL1Assertions("ecommerce", "/cart");
    expect(assertions.length).toBeGreaterThan(0);
    expect(assertions.some((a) => a.includes("cart"))).toBe(true);
    expect(assertions.some((a) => a.includes("Checkout"))).toBe(true);
  });

  test("generates ecommerce product assertions", () => {
    const assertions = generateL1Assertions("ecommerce", "/product/123");
    expect(assertions.length).toBeGreaterThan(0);
    expect(assertions.some((a) => a.includes("Add to Cart"))).toBe(true);
    expect(assertions.some((a) => a.includes("price"))).toBe(true);
  });

  test("generates blog post assertions", () => {
    const assertions = generateL1Assertions("blog", "/post/hello-world");
    expect(assertions.length).toBeGreaterThan(0);
    expect(assertions.some((a) => a.includes("article"))).toBe(true);
    expect(assertions.some((a) => a.includes("post-title") || a.includes("h1"))).toBe(true);
  });

  test("generates dashboard assertions", () => {
    const assertions = generateL1Assertions("dashboard", "/dashboard");
    expect(assertions.length).toBeGreaterThan(0);
    expect(assertions.some((a) => a.includes("navigation") || a.includes("sidebar"))).toBe(true);
  });

  test("generates auth login assertions", () => {
    const assertions = generateL1Assertions("auth", "/login");
    expect(assertions.length).toBeGreaterThan(0);
    expect(assertions.some((a) => a.includes("email"))).toBe(true);
    expect(assertions.some((a) => a.includes("password"))).toBe(true);
    expect(assertions.some((a) => a.includes("Login") || a.includes("Sign in"))).toBe(true);
  });

  test("generates generic fallback assertions", () => {
    const assertions = generateL1Assertions("generic", "/random");
    expect(assertions.length).toBeGreaterThan(0);
    expect(assertions.some((a) => a.includes("h1"))).toBe(true);
  });

  test("all assertions include expect() calls", () => {
    const assertions = generateL1Assertions("ecommerce", "/shop");
    const expectAssertions = assertions.filter((a) => a.includes("expect("));
    expect(expectAssertions.length).toBeGreaterThanOrEqual(3);
  });
});

describe("L0 to L1 Upgrade", () => {
  test("upgrades L0 test with domain-aware assertions", () => {
    const l0Code = `
import { test, expect } from "@playwright/test";

test.describe("cart-page", () => {
  test("smoke /cart", async ({ page, baseURL }) => {
    const url = (baseURL ?? "http://localhost:3333") + "/cart";
    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
    page.on("pageerror", (err) => errors.push(String(err)));
    await page.goto(url);
    expect(errors, "console/page errors").toEqual([]);
  });
});
`;

    const upgraded = upgradeL0ToL1(l0Code, "/cart");

    // Should contain original L0 error check
    expect(upgraded).toContain('expect(errors, "console/page errors").toEqual([])');

    // Should contain L1 assertions before L0 check
    expect(upgraded).toContain("cart");
    expect(upgraded).toContain("Checkout");

    // L1 assertions should come before the error check
    const errorCheckIndex = upgraded.indexOf('expect(errors');
    const cartAssertionIndex = upgraded.indexOf("cart");
    expect(cartAssertionIndex).toBeLessThan(errorCheckIndex);
  });

  test("handles test code without L0 error check", () => {
    const basicCode = `
test("basic test", async ({ page }) => {
  await page.goto("/login");
});
`;

    const upgraded = upgradeL0ToL1(basicCode, "/login");

    // Should add L1 assertions
    expect(upgraded).toContain("email");
    expect(upgraded).toContain("password");
  });
});

describe("Assertion Count", () => {
  test("ecommerce cart has at least 3 assertions", () => {
    const count = getAssertionCount("ecommerce", "/cart");
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("blog post has at least 4 assertions", () => {
    const count = getAssertionCount("blog", "/post/test");
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test("dashboard has at least 3 assertions", () => {
    const count = getAssertionCount("dashboard", "/dashboard");
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("auth login has at least 4 assertions", () => {
    const count = getAssertionCount("auth", "/login");
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test("generic has at least 3 assertions", () => {
    const count = getAssertionCount("generic", "/random");
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

describe("Domain Coverage", () => {
  test("supports all required domains", () => {
    const domains: AppDomain[] = ["ecommerce", "blog", "dashboard", "auth", "generic"];

    for (const domain of domains) {
      const assertions = generateL1Assertions(domain, `/${domain}`);
      expect(assertions.length).toBeGreaterThan(0);
      const assertionCount = assertions.filter((a) => a.includes("expect(")).length;
      // Log for debugging
      if (assertionCount < 2) {
        console.log(`Domain: ${domain}, Route: /${domain}`);
        console.log(`Assertions:`, assertions);
        console.log(`Assertion count: ${assertionCount}`);
      }
      expect(assertionCount).toBeGreaterThanOrEqual(2);
    }
  });

  test("each domain has unique assertions", () => {
    const ecommerceAssertions = generateL1Assertions("ecommerce", "/shop");
    const blogAssertions = generateL1Assertions("blog", "/blog");
    const dashboardAssertions = generateL1Assertions("dashboard", "/dashboard");

    // Each domain should have some unique content
    const ecommerceStr = ecommerceAssertions.join(" ");
    const blogStr = blogAssertions.join(" ");
    const dashboardStr = dashboardAssertions.join(" ");

    // Check that domains are actually different
    expect(ecommerceStr).not.toBe(blogStr);
    expect(blogStr).not.toBe(dashboardStr);
    expect(dashboardStr).not.toBe(ecommerceStr);
  });
});
