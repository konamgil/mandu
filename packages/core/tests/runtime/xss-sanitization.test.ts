import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToHTML } from "../../src/runtime/ssr";
import { generateDeferredDataScript, renderStreamingResponse } from "../../src/runtime/streaming-ssr";
import type { BundleManifest } from "../../src/bundler/types";

const manifest: BundleManifest = {
  version: 1,
  buildTime: new Date().toISOString(),
  env: "development",
  bundles: {
    'route\" onmouseover=\"alert(1)': {
      js: '/main.js\" onerror=\"alert(2)',
      dependencies: [],
      priority: "visible",
    },
  },
  shared: {
    runtime: '/runtime.js\" onerror=\"alert(3)',
    vendor: '/vendor.js\" onerror=\"alert(4)',
    router: '/router.js\" onerror=\"alert(5)',
  },
  importMap: {
    imports: {
      react: 'https://cdn.example/react</script><script>alert(9)</script>',
      'react-dom': '/react-dom.js\" onerror=\"alert(6)',
      'react-dom/client': '/react-dom-client.js\" onerror=\"alert(7)',
    },
  },
};

describe("XSS sanitization in SSR/runtime output", () => {
  it("escapes dangerous values in SSR HTML attributes and inline scripts", () => {
    const html = renderToHTML(React.createElement("div", null, "hello"), {
      title: 'bad </title><script>alert(1)</script>',
      lang: 'ko\" onmouseover=\"alert(2)',
      cssPath: '/app.css\" onerror=\"alert(3)',
      hydration: { strategy: "island", priority: "visible", preload: false },
      routeId: 'route\" onmouseover=\"alert(1)',
      bundleManifest: manifest,
      enableClientRouter: true,
      routePattern: '/xss\";alert(4)//',
    });

    expect(html).not.toContain('onmouseover="alert(1)');
    expect(html).not.toContain('onerror="alert(3)');
    expect(html).not.toContain('</script><script>alert(9)</script>');
    expect(html).toContain("&quot; onmouseover=&quot;alert(1)");
    expect(html).toContain("\\u003c/script\\u003e\\u003cscript\\u003ealert(9)\\u003c/script\\u003e");
  });

  it("escapes route/key interpolation in deferred inline script", () => {
    const script = generateDeferredDataScript('r\";alert(1);//', 'k\";alert(2);//', {
      payload: "ok",
    });

    expect(script).not.toContain('window.__MANDU_DEFERRED__["r";alert(1);//"]');
    expect(script).toContain('window.__MANDU_DEFERRED__["r\\u0022;alert(1);//"]');
    expect(script).toContain('key: "k\\u0022;alert(2);//"');
  });

  it("escapes import map/script payloads in streaming HTML", async () => {
    const res = await renderStreamingResponse(React.createElement("div", null, "stream"), {
      title: 'stream </title><script>alert(10)</script>',
      routeId: 'route\" onmouseover=\"alert(1)',
      hydration: { strategy: "island", priority: "visible", preload: false },
      bundleManifest: manifest,
      criticalData: {
        xss: '</script><script>alert(11)</script>',
      },
      enableClientRouter: true,
      routePattern: '/stream\";alert(12)//',
    });

    const html = await res.text();
    expect(html).not.toContain('</script><script>alert(11)</script>');
    expect(html).not.toContain('data-mandu-island="route" onmouseover="alert(1)"');
    expect(html).toContain('data-mandu-island="route&quot; onmouseover=&quot;alert(1)"');
    expect(html).toContain('\\u003c/script\\u003e\\u003cscript\\u003ealert(11)\\u003c/script\\u003e');
  });
});
