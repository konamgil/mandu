#!/usr/bin/env node

const { chromium } = require("playwright");

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error("Usage: node scripts/test-hydration-e2e-browser.cjs <base-url>");
  process.exit(1);
}

let browser;
let page;

const hardExitTimer = setTimeout(() => {
  console.error("Hydration E2E browser hard timeout after 60000ms");
  process.exit(1);
}, 60_000);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertHydratedCounter(page, {
  path,
  boundaryId,
  label,
  initial,
  next,
  consoleErrors,
  pageErrors,
  networkErrors,
  expectedHydrate = "visible",
  expectedPriority = "visible",
  expectPropsScript = true,
  expectDataProps = false,
  expectVisibleObserver = true,
  expectConflictingServerData = true,
  expectComplexProps = false,
  expectHookWrapper = false,
}) {
  const targetUrl = new URL(path, baseUrl).toString();

  console.log(`[hydration-e2e:browser] navigate ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

  console.log(`[hydration-e2e:browser] assert boundary marker and props script for ${boundaryId}`);
  await page.waitForSelector(`[data-mandu-island="${boundaryId}"]`, { state: "attached" });
  const boundaryCount = await page.locator("[data-mandu-island]").count();
  assert(boundaryCount === 1, `Expected exactly one boundary marker for ${boundaryId}, got ${boundaryCount}`);
  const boundaryAttrs = await page.locator(`[data-mandu-island="${boundaryId}"]`).evaluate((element) => ({
    dataProps: element.getAttribute("data-props"),
    hydrate: element.getAttribute("data-hydrate"),
    priority: element.getAttribute("data-mandu-priority"),
  }));
  assert(boundaryAttrs.hydrate === expectedHydrate, `Expected ${boundaryId} ${expectedHydrate} hydrate strategy, got ${boundaryAttrs.hydrate}`);
  assert(boundaryAttrs.priority === expectedPriority, `Expected ${boundaryId} ${expectedPriority} priority, got ${boundaryAttrs.priority}`);
  if (expectDataProps) {
    assert(boundaryAttrs.dataProps?.includes('"label"'), `Expected ${boundaryId} legacy data-props to include label`);
  } else {
    assert(boundaryAttrs.dataProps === null, `Expected ${boundaryId} to avoid legacy data-props, got ${boundaryAttrs.dataProps}`);
  }

  const propsScript = page.locator(`script[data-mandu-props="${boundaryId}"]`);
  if (expectPropsScript) {
    assert(await propsScript.count() === 1, `Expected one boundary-local data-mandu-props script for "${boundaryId}"`);
    const propsText = await propsScript.textContent();
    assert(propsText?.includes('"label"'), `Expected ${boundaryId} boundary-local props to include label`);
    assert(propsText?.includes('"initial"'), `Expected ${boundaryId} boundary-local props to include initial`);
    if (expectComplexProps) {
      assert(propsText?.includes('"complex"'), `Expected ${boundaryId} boundary-local props to include complex props`);
    }
    if (expectHookWrapper) {
      assert(propsText?.includes('"hookId"'), `Expected ${boundaryId} boundary-local props to include hookId from the server wrapper hook`);
      const hookWrapperCount = await page.locator("[data-e2e-hook-wrapper]").count();
      assert(hookWrapperCount === 1, `Expected one hook server wrapper for ${boundaryId}, got ${hookWrapperCount}`);
    }
  } else {
    assert(await propsScript.count() === 0, `Expected no boundary-local data-mandu-props script for "${boundaryId}"`);
  }

  console.log(`[hydration-e2e:browser] wait for hydration of ${boundaryId}`);
  await page.waitForFunction((id) => {
    const boundary = document.querySelector(`[data-mandu-island="${id}"]`);
    return Boolean(
      boundary &&
      (boundary.hasAttribute("data-mandu-hydrated") || boundary.hasAttribute("data-mandu-error"))
    );
  }, boundaryId);
  const boundaryState = await page.locator(`[data-mandu-island="${boundaryId}"]`).evaluate((element) => ({
    hydrated: element.hasAttribute("data-mandu-hydrated"),
    error: element.hasAttribute("data-mandu-error"),
  }));

  const events = await page.evaluate(() => window.__MANDU_E2E_EVENTS__ ?? []);
  const hydrationErrors = events.filter((event) => event.type === "mandu:hydration-error");
  const flags = await page.evaluate((id) => ({
    ioObserved: window.__MANDU_E2E_IO_OBSERVED__ === true,
    conflictingServerData: window.__MANDU_DATA__?.[id]?.serverData?.initial === 99,
  }), boundaryId);
  const earlyFailures = [
    ...consoleErrors.map((error) => `console error: ${error}`),
    ...pageErrors.map((error) => `page error: ${error}`),
    ...networkErrors.map((error) => `network error: ${error}`),
  ];
  assert(
    !boundaryState.error,
    `Boundary ${boundaryId} entered data-mandu-error state. Events: ${JSON.stringify(events)}${earlyFailures.length > 0 ? `\n${earlyFailures.join("\n")}` : ""}`,
  );
  assert(hydrationErrors.length === 0, `Browser emitted hydration errors for ${boundaryId}: ${JSON.stringify(hydrationErrors)}`);
  assert(boundaryState.hydrated, `Boundary ${boundaryId} did not enter data-mandu-hydrated state. Events: ${JSON.stringify(events)}`);
  if (expectVisibleObserver) {
    assert(flags.ioObserved, `Expected ${boundaryId} visible hydration to observe a target through IntersectionObserver`);
  }
  if (expectConflictingServerData) {
    assert(flags.conflictingServerData, `Expected conflicting route-level server data for ${boundaryId} to be present before hydration`);
  }
  const hydratedEvents = events.filter((event) => event.type === "mandu:hydrated");
  assert(hydratedEvents.length === boundaryCount, `Expected ${boundaryCount} mandu:hydrated event(s) for ${boundaryId}, got ${hydratedEvents.length}`);

  await page.waitForSelector("[data-e2e-counter]");
  const initialText = await page.locator("[data-e2e-counter]").textContent();
  assert(initialText?.trim() === `${label}: ${initial}`, `Expected hydrated counter text "${label}: ${initial}", got ${JSON.stringify(initialText)}`);
  if (expectComplexProps) {
    const complexState = await page.locator("[data-e2e-counter]").getAttribute("data-complex-props");
    assert(complexState === "ok", `Expected ${boundaryId} complex props to deserialize through the shared runtime path, got ${JSON.stringify(complexState)}`);
  }

  if (expectHookWrapper) {
    const hookIds = await page.evaluate(() => {
      const wrapper = document.querySelector("[data-e2e-hook-wrapper]");
      const counter = document.querySelector("[data-e2e-counter]");
      return {
        wrapper: wrapper?.getAttribute("data-hook-id") ?? "",
        counter: counter?.getAttribute("data-hook-id") ?? "",
      };
    });
    assert(hookIds.wrapper.length > 0, `Expected ${boundaryId} server hook wrapper to expose a hook id`);
    assert(hookIds.counter === hookIds.wrapper, `Expected ${boundaryId} hook id prop to survive hydration. Wrapper=${hookIds.wrapper}, counter=${hookIds.counter}`);
  }

  console.log(`[hydration-e2e:browser] click hydrated counter for ${boundaryId}`);
  await page.locator("[data-e2e-counter]").click();
  await page.waitForFunction((expected) => {
    return document.querySelector("[data-e2e-counter]")?.getAttribute("data-count") === String(expected);
  }, next);

  const nextText = await page.locator("[data-e2e-counter]").textContent();
  assert(nextText?.trim() === `${label}: ${next}`, `Expected clicked counter text "${label}: ${next}", got ${JSON.stringify(nextText)}`);
}

async function assertInteractionCounter({
  path,
  boundaryId,
  label,
  initial,
  next,
  consoleErrors,
  pageErrors,
  networkErrors,
}) {
  const targetUrl = new URL(path, baseUrl).toString();
  console.log(`[hydration-e2e:browser] navigate ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

  await page.waitForSelector(`[data-mandu-island="${boundaryId}"]`, { state: "attached" });
  const attrs = await page.locator(`[data-mandu-island="${boundaryId}"]`).evaluate((element) => ({
    hydrate: element.getAttribute("data-hydrate"),
    priority: element.getAttribute("data-mandu-priority"),
    hydrated: element.hasAttribute("data-mandu-hydrated"),
  }));
  assert(attrs.hydrate === "interaction", `Expected ${boundaryId} interaction hydrate strategy, got ${attrs.hydrate}`);
  assert(attrs.priority === "interaction", `Expected ${boundaryId} interaction priority, got ${attrs.priority}`);
  assert(attrs.hydrated === false, `Expected ${boundaryId} not to hydrate before interaction`);
  await page.waitForTimeout(250);
  const preClickHydrated = await page.locator(`[data-mandu-island="${boundaryId}"]`).evaluate((element) =>
    element.hasAttribute("data-mandu-hydrated")
  );
  assert(preClickHydrated === false, `Expected ${boundaryId} to remain unhydrated before click`);

  console.log(`[hydration-e2e:browser] click interaction target for ${boundaryId}`);
  await page.locator("[data-e2e-interaction-target]").click();

  await page.waitForFunction((id) => {
    const boundary = document.querySelector(`[data-mandu-island="${id}"]`);
    return Boolean(
      boundary &&
      (boundary.hasAttribute("data-mandu-hydrated") || boundary.hasAttribute("data-mandu-error"))
    );
  }, boundaryId);
  const boundaryState = await page.locator(`[data-mandu-island="${boundaryId}"]`).evaluate((element) => ({
    hydrated: element.hasAttribute("data-mandu-hydrated"),
    error: element.hasAttribute("data-mandu-error"),
  }));
  const events = await page.evaluate(() => window.__MANDU_E2E_EVENTS__ ?? []);
  const earlyFailures = [
    ...consoleErrors.map((error) => `console error: ${error}`),
    ...pageErrors.map((error) => `page error: ${error}`),
    ...networkErrors.map((error) => `network error: ${error}`),
  ];
  assert(!boundaryState.error, `Interaction boundary ${boundaryId} entered error state. Events: ${JSON.stringify(events)}${earlyFailures.length > 0 ? `\n${earlyFailures.join("\n")}` : ""}`);
  assert(boundaryState.hydrated, `Interaction boundary ${boundaryId} did not hydrate after click. Events: ${JSON.stringify(events)}`);

  await page.waitForSelector("[data-e2e-counter]");
  const initialText = await page.locator("[data-e2e-counter]").textContent();
  assert(initialText?.trim() === `${label}: ${initial}`, `Expected hydrated counter text "${label}: ${initial}", got ${JSON.stringify(initialText)}`);

  await page.locator("[data-e2e-counter]").click();
  await page.waitForFunction((expected) => {
    return document.querySelector("[data-e2e-counter]")?.getAttribute("data-count") === String(expected);
  }, next);
  const nextText = await page.locator("[data-e2e-counter]").textContent();
  assert(nextText?.trim() === `${label}: ${next}`, `Expected clicked counter text "${label}: ${next}", got ${JSON.stringify(nextText)}`);
}

async function main() {
  const consoleErrors = [];
  const pageErrors = [];
  const networkErrors = [];

  console.log("[hydration-e2e:browser] launch chromium");
  browser = await chromium.launch({ headless: true, timeout: 30_000 });
  page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(15_000);

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("/.mandu/client/")) {
      networkErrors.push(`${request.url()} failed: ${request.failure()?.errorText ?? "unknown"}`);
    }
  });
  page.on("response", (response) => {
    if (response.url().includes("/.mandu/client/") && response.status() >= 400) {
      networkErrors.push(`${response.url()} responded ${response.status()}`);
    }
  });

  await page.addInitScript(() => {
    window.__MANDU_E2E_EVENTS__ = [];
    window.__MANDU_E2E_IO_OBSERVED__ = false;
    window.__MANDU_DATA__ = {
      "index--0": { serverData: { label: "RouteData", initial: 99 } },
      "hook--0": { serverData: { label: "RouteData", initial: 99 } },
      "default--0": { serverData: { label: "RouteData", initial: 99 } },
      "async--0": { serverData: { label: "RouteData", initial: 99 } },
      "interaction--0": { serverData: { label: "RouteData", initial: 99 } },
      "streaming--0": { serverData: { label: "RouteData", initial: 99 } },
      "route-data-fallback-raw": { serverData: { label: "RouteData Fallback", initial: 10 } },
      index: { serverData: { label: "RouteData", initial: 99 } },
      hook: { serverData: { label: "RouteData", initial: 99 } },
      default: { serverData: { label: "RouteData", initial: 99 } },
      async: { serverData: { label: "RouteData", initial: 99 } },
      interaction: { serverData: { label: "RouteData", initial: 99 } },
      streaming: { serverData: { label: "RouteData", initial: 99 } },
      "route-data-fallback": { serverData: { label: "RouteData Fallback", initial: 10 } },
    };

    const NativeIntersectionObserver = window.IntersectionObserver;
    if (NativeIntersectionObserver) {
      window.IntersectionObserver = class ManduE2EIntersectionObserver extends NativeIntersectionObserver {
        observe(target) {
          window.__MANDU_E2E_IO_OBSERVED__ = true;
          return super.observe(target);
        }
      };
    }

    document.addEventListener(
      "mandu:hydrated",
      (event) => {
        window.__MANDU_E2E_EVENTS__?.push({
          type: "mandu:hydrated",
          detail: event.detail,
        });
      },
      true,
    );
    document.addEventListener(
      "mandu:hydration-error",
      (event) => {
        window.__MANDU_E2E_EVENTS__?.push({
          type: "mandu:hydration-error",
          detail: event.detail,
        });
      },
      true,
    );
  });

  await assertHydratedCounter(page, {
    path: "/",
    boundaryId: "index--0",
    label: "Count",
    initial: 2,
    next: 3,
    consoleErrors,
    pageErrors,
    networkErrors,
    expectComplexProps: true,
  });
  await assertHydratedCounter(page, {
    path: "/hook",
    boundaryId: "hook--0",
    label: "Hook Count",
    initial: 7,
    next: 8,
    consoleErrors,
    pageErrors,
    networkErrors,
    expectHookWrapper: true,
  });
  await assertHydratedCounter(page, {
    path: "/default",
    boundaryId: "default--0",
    label: "Default Count",
    initial: 3,
    next: 4,
    consoleErrors,
    pageErrors,
    networkErrors,
  });
  await assertHydratedCounter(page, {
    path: "/async",
    boundaryId: "async--0",
    label: "Async Count",
    initial: 4,
    next: 5,
    consoleErrors,
    pageErrors,
    networkErrors,
  });
  await assertInteractionCounter({
    path: "/interaction",
    boundaryId: "interaction--0",
    label: "Interaction Count",
    initial: 5,
    next: 6,
    consoleErrors,
    pageErrors,
    networkErrors,
  });
  await assertHydratedCounter(page, {
    path: "/streaming",
    boundaryId: "streaming--0",
    label: "Streaming Count",
    initial: 6,
    next: 7,
    consoleErrors,
    pageErrors,
    networkErrors,
  });
  await assertHydratedCounter(page, {
    path: "/legacy-data-props",
    boundaryId: "legacy-data-props",
    label: "Legacy Props",
    initial: 8,
    next: 9,
    consoleErrors,
    pageErrors,
    networkErrors,
    expectedHydrate: "load",
    expectedPriority: "immediate",
    expectPropsScript: false,
    expectDataProps: true,
    expectVisibleObserver: false,
    expectConflictingServerData: false,
  });
  await assertHydratedCounter(page, {
    path: "/route-data-fallback",
    boundaryId: "route-data-fallback-raw",
    label: "RouteData Fallback",
    initial: 10,
    next: 11,
    consoleErrors,
    pageErrors,
    networkErrors,
    expectedHydrate: "load",
    expectedPriority: "immediate",
    expectPropsScript: false,
    expectVisibleObserver: false,
    expectConflictingServerData: false,
  });

  const failures = [
    ...consoleErrors.map((error) => `console error: ${error}`),
    ...pageErrors.map((error) => `page error: ${error}`),
    ...networkErrors.map((error) => `network error: ${error}`),
  ];
  assert(failures.length === 0, `Hydration E2E browser failures:\n${failures.join("\n")}`);
}

main()
  .then(() => {
    console.log("Hydration E2E browser passed: bundle load -> mandu:hydrated -> React state update");
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    if (page) {
      const snapshot = await page.content().catch(() => "");
      if (snapshot) {
        console.error(`Hydration E2E page snapshot:\n${snapshot.slice(0, 3000)}`);
      }
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    clearTimeout(hardExitTimer);
    await browser?.close().catch(() => {});
    process.exit(process.exitCode ?? 0);
  });
