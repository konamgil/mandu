import { afterEach, describe, expect, test } from "bun:test";
import {
  INTERNAL_EVENTS_ENDPOINT,
  createRuntimeObservabilityLifecycle,
} from "../observability-lifecycle";
import { eventBus } from "../../observability/event-bus";
import {
  resetTracer,
  type Span,
  type SpanExporter,
} from "../../observability/tracing";

class CaptureExporter implements SpanExporter {
  readonly spans: Span[] = [];
  export(spans: Span[]): void {
    this.spans.push(...spans);
  }
}

afterEach(() => {
  resetTracer();
});

describe("runtime observability lifecycle", () => {
  test("serves heap snapshots with perf data when exposed", async () => {
    const lifecycle = createRuntimeObservabilityLifecycle({ isDev: true });
    const response = lifecycle.handleEndpoint(
      new Request("http://localhost/_mandu/heap"),
      "/_mandu/heap"
    );

    expect(response?.status).toBe(200);
    const body = await response!.json() as {
      process: { heapUsed: number };
      perf: unknown;
    };
    expect(body.process.heapUsed).toBeGreaterThan(0);
    expect(body.perf).toBeDefined();
  });

  test("keeps metrics hidden in production unless explicitly enabled", () => {
    const hidden = createRuntimeObservabilityLifecycle({ isDev: false });
    const shown = createRuntimeObservabilityLifecycle({
      isDev: false,
      metricsEndpoint: true,
    });

    expect(hidden.handleEndpoint(new Request("http://localhost/_mandu/metrics"), "/_mandu/metrics")).toBeNull();
    expect(shown.handleEndpoint(new Request("http://localhost/_mandu/metrics"), "/_mandu/metrics")?.status).toBe(200);
  });

  test("serves recent EventBus snapshots from the lifecycle endpoint", async () => {
    const lifecycle = createRuntimeObservabilityLifecycle({ isDev: true });
    const source = `observability-lifecycle-${Date.now()}`;
    eventBus.emit({
      type: "http",
      severity: "info",
      source,
      message: "GET /observed 200",
    });

    const response = lifecycle.handleEndpoint(
      new Request(`http://localhost${INTERNAL_EVENTS_ENDPOINT}/recent?source=${source}`),
      `${INTERNAL_EVENTS_ENDPOINT}/recent`
    );

    expect(response?.status).toBe(200);
    const body = await response!.json() as {
      events: Array<{ source: string; message: string }>;
    };
    expect(body.events.some((event) => event.source === source)).toBe(true);
  });

  test("wraps requests in a root tracing span", async () => {
    const exporter = new CaptureExporter();
    const lifecycle = createRuntimeObservabilityLifecycle({
      isDev: false,
      tracing: {
        enabled: true,
        customExporter: exporter,
      },
    });
    const incomingTraceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const incomingSpanId = "00f067aa0ba902b7";
    const response = await lifecycle.runRequest(
      new Request("https://example.test/users", {
        headers: {
          traceparent: `00-${incomingTraceId}-${incomingSpanId}-01`,
        },
      }),
      Date.now(),
      "corr-1",
      async () => new Response("created", { status: 201 })
    );

    expect(response.status).toBe(201);
    expect(exporter.spans).toHaveLength(1);
    expect(exporter.spans[0].traceId).toBe(incomingTraceId);
    expect(exporter.spans[0].parentSpanId).toBe(incomingSpanId);
    expect(exporter.spans[0].attributes["http.status_code"]).toBe(201);
    expect(exporter.spans[0].status).toBe("ok");
  });
});
