import {
  eventBus,
  type EventType,
  type ObservabilityEvent,
  type ObservabilitySeverity,
} from "../observability/event-bus";
import {
  HEAP_ENDPOINT,
  METRICS_ENDPOINT,
  buildMetricsResponse,
  collectHeapSnapshot,
  isObservabilityExposed,
  recordHttpRequest,
} from "../observability/metrics";
import {
  createTracerFromConfig,
  runWithSpan,
  setTracer,
  type Tracer,
  type TracerConfig,
} from "../observability/tracing";
import { collectPerfSnapshot } from "../perf/user-marks";

export const INTERNAL_EVENTS_ENDPOINT = "/__mandu/events";

export interface RuntimeRequestRecord {
  id: string;
  method: string;
  path: string;
  status: number;
  duration: number;
  timestamp: number;
  cacheStatus?: string;
}

export interface RuntimeRequestObservation {
  req: Request;
  path: string;
  status: number;
  duration: number;
  correlationId: string;
  cacheStatus?: string;
  error?: boolean;
  recordRequest?: (entry: RuntimeRequestRecord) => void;
}

export interface RuntimeObservabilityLifecycle {
  readonly tracer: Tracer | undefined;
  handleEndpoint(req: Request, pathname: string): Response | null;
  runRequest<T extends Response>(
    req: Request,
    requestStart: number,
    correlationId: string,
    handler: () => Promise<T>
  ): Promise<T>;
  recordHttpResponse(req: Request, response: Response | undefined): void;
  recordDevRequest(observation: RuntimeRequestObservation): void;
}

export interface CreateRuntimeObservabilityLifecycleOptions {
  isDev: boolean;
  heapEndpoint?: boolean;
  metricsEndpoint?: boolean;
  tracing?: TracerConfig;
}

export function createRuntimeObservabilityLifecycle(
  options: CreateRuntimeObservabilityLifecycleOptions
): RuntimeObservabilityLifecycle {
  const tracerInstance = createTracerFromConfig(options.tracing);
  setTracer(tracerInstance);
  const tracer = tracerInstance.enabled ? tracerInstance : undefined;

  return {
    tracer,
    handleEndpoint(req, pathname) {
      return handleRuntimeObservabilityEndpoint(req, pathname, options);
    },
    async runRequest(req, requestStart, correlationId, handler) {
      if (!tracer || !tracer.enabled) {
        return await handler();
      }

      const url = new URL(req.url);
      const rootSpan = tracer.startSpanFromRequest("http.request", req, {
        kind: "server",
        attributes: {
          "http.method": req.method,
          "http.url": req.url,
          "http.target": url.pathname,
          "http.scheme": url.protocol.replace(":", ""),
          "http.host": url.host,
          "mandu.correlation_id": correlationId,
          "mandu.request_start_ms": requestStart,
        },
      });

      try {
        const response = await runWithSpan(rootSpan, handler);
        rootSpan.setAttribute("http.status_code", response.status);
        if (response.status >= 500) {
          rootSpan.setStatus("error", `HTTP ${response.status}`);
        } else if (rootSpan.status === "unset") {
          rootSpan.setStatus("ok");
        }
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        rootSpan.setStatus("error", message);
        throw err;
      } finally {
        rootSpan.end();
      }
    },
    recordHttpResponse(req, response) {
      if (!response) return;
      try {
        recordHttpRequest(req.method, response.status);
      } catch {
        // Observability must never break the request path.
      }
    },
    recordDevRequest(observation) {
      recordRuntimeObservation(observation);
    },
  };
}

function handleRuntimeObservabilityEndpoint(
  req: Request,
  pathname: string,
  options: CreateRuntimeObservabilityLifecycleOptions
): Response | null {
  if (pathname === INTERNAL_EVENTS_ENDPOINT) {
    return handleEventsStreamRequest(req);
  }
  if (pathname === `${INTERNAL_EVENTS_ENDPOINT}/recent`) {
    return handleEventsRecentRequest(req);
  }
  if (pathname === HEAP_ENDPOINT) {
    if (!isObservabilityExposed(options.isDev, options.heapEndpoint)) return null;
    const base = collectHeapSnapshot();
    const perf = collectPerfSnapshot();
    const body = { ...base, perf };
    return new Response(JSON.stringify(body, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
  if (pathname === METRICS_ENDPOINT) {
    if (!isObservabilityExposed(options.isDev, options.metricsEndpoint)) return null;
    return buildMetricsResponse();
  }
  return null;
}

function handleEventsStreamRequest(req: Request): Response {
  const url = new URL(req.url);
  const filterType = url.searchParams.get("type") || undefined;
  const filterSeverity = url.searchParams.get("severity") || undefined;
  const filterSource = url.searchParams.get("source") || undefined;
  const filterTrace = url.searchParams.get("trace") || undefined;

  const matches = (event: ObservabilityEvent): boolean => {
    if (filterType && event.type !== filterType) return false;
    if (filterSeverity && event.severity !== filterSeverity) return false;
    if (filterSource && event.source !== filterSource) return false;
    if (filterTrace && event.correlationId !== filterTrace) return false;
    return true;
  };

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: string, eventName?: string) => {
        try {
          const prefix = eventName ? `event: ${eventName}\n` : "";
          controller.enqueue(encoder.encode(`${prefix}data: ${data}\n\n`));
        } catch {
          // Stream closed.
        }
      };

      for (const event of eventBus.getRecent()) {
        if (matches(event)) send(JSON.stringify(event));
      }

      unsubscribe = eventBus.on("*", (event) => {
        if (matches(event)) send(JSON.stringify(event));
      });

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // Ignore closed streams.
        }
      }, 15000);

      req.signal.addEventListener("abort", () => {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        try {
          controller.close();
        } catch {
          // No-op when already closed.
        }
      });
    },
    cancel() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function handleEventsRecentRequest(req: Request): Response {
  const url = new URL(req.url);
  const count = url.searchParams.get("count");
  const type = url.searchParams.get("type") || undefined;
  const severity = url.searchParams.get("severity") || undefined;
  const windowParam = url.searchParams.get("windowMs");
  const windowMs = windowParam ? Number(windowParam) : undefined;

  const events = eventBus.getRecent(count ? Number(count) : undefined, {
    type: type as EventType | undefined,
    severity: severity as ObservabilitySeverity | undefined,
  });
  const stats = eventBus.getStats(windowMs);
  return Response.json({ events, stats });
}

function recordRuntimeObservation(observation: RuntimeRequestObservation): void {
  const cacheTag = observation.cacheStatus ? ` ${observation.cacheStatus}` : "";
  console.log(
    `[${new Date().toLocaleTimeString()}] ${observation.req.method} ${observation.path} ${observation.status} ${observation.duration}ms${cacheTag}`
  );
  observation.recordRequest?.({
    id: observation.correlationId,
    method: observation.req.method,
    path: observation.path,
    status: observation.status,
    duration: observation.duration,
    timestamp: Date.now(),
    cacheStatus: observation.cacheStatus,
  });
  eventBus.emit({
    type: "http",
    severity: observation.status >= 500 ? "error" : observation.status >= 400 ? "warn" : "info",
    source: "server",
    correlationId: observation.correlationId,
    message: `${observation.req.method} ${observation.path} ${observation.status}${cacheTag}`,
    duration: observation.duration,
    data: {
      method: observation.req.method,
      path: observation.path,
      status: observation.status,
      cache: observation.cacheStatus,
      error: observation.error || undefined,
    },
  });
}
