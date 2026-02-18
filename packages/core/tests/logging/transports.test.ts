/**
 * DNA-008: Structured Logging - Transports Tests
 */

import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test";
import {
  transportRegistry,
  attachLogTransport,
  detachLogTransport,
  entryToTransportRecord,
  createConsoleTransport,
  createBufferTransport,
  createFilteredTransport,
  createBatchTransport,
  type LogTransportRecord,
} from "../../src/logging/transports";
import type { LogEntry } from "../../src/runtime/logger";

describe("DNA-008: Structured Logging - Transports", () => {
  beforeEach(() => {
    transportRegistry.clear();
  });

  describe("transportRegistry", () => {
    it("should attach and detach transports", () => {
      const transport = mock();

      attachLogTransport("test", transport);
      expect(transportRegistry.has("test")).toBe(true);
      expect(transportRegistry.size).toBe(1);

      const removed = detachLogTransport("test");
      expect(removed).toBe(true);
      expect(transportRegistry.has("test")).toBe(false);
      expect(transportRegistry.size).toBe(0);
    });

    it("should dispatch records to all transports", async () => {
      const transport1 = mock();
      const transport2 = mock();

      attachLogTransport("t1", transport1);
      attachLogTransport("t2", transport2);

      const record: LogTransportRecord = {
        timestamp: new Date().toISOString(),
        level: "info",
        method: "GET",
        path: "/test",
      };

      await transportRegistry.dispatch(record);

      expect(transport1).toHaveBeenCalledWith(record);
      expect(transport2).toHaveBeenCalledWith(record);
    });

    it("should filter by minLevel", async () => {
      const transport = mock();
      attachLogTransport("filtered", transport, { minLevel: "warn" });

      // info 레벨 - 무시됨
      await transportRegistry.dispatch({
        timestamp: new Date().toISOString(),
        level: "info",
      });
      expect(transport).not.toHaveBeenCalled();

      // warn 레벨 - 전송됨
      await transportRegistry.dispatch({
        timestamp: new Date().toISOString(),
        level: "warn",
      });
      expect(transport).toHaveBeenCalledTimes(1);

      // error 레벨 - 전송됨
      await transportRegistry.dispatch({
        timestamp: new Date().toISOString(),
        level: "error",
      });
      expect(transport).toHaveBeenCalledTimes(2);
    });

    it("should respect enabled flag", async () => {
      const transport = mock();
      attachLogTransport("toggleable", transport, { enabled: false });

      await transportRegistry.dispatch({
        timestamp: new Date().toISOString(),
        level: "info",
      });
      expect(transport).not.toHaveBeenCalled();

      transportRegistry.setEnabled("toggleable", true);

      await transportRegistry.dispatch({
        timestamp: new Date().toISOString(),
        level: "info",
      });
      expect(transport).toHaveBeenCalledTimes(1);
    });

    it("should handle async transports", async () => {
      const results: string[] = [];
      const asyncTransport = async (record: LogTransportRecord) => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(record.level);
      };

      attachLogTransport("async", asyncTransport);

      await transportRegistry.dispatch({
        timestamp: new Date().toISOString(),
        level: "info",
      });

      expect(results).toContain("info");
    });

    it("should handle transport errors gracefully", async () => {
      const errorTransport = () => {
        throw new Error("Transport error");
      };
      const goodTransport = mock();

      attachLogTransport("error", errorTransport);
      attachLogTransport("good", goodTransport);

      // 에러가 발생해도 다른 전송은 호출됨
      await transportRegistry.dispatch({
        timestamp: new Date().toISOString(),
        level: "info",
      });

      expect(goodTransport).toHaveBeenCalled();
    });

    it("should list all transports", () => {
      attachLogTransport("t1", mock());
      attachLogTransport("t2", mock(), { minLevel: "warn" });

      const list = transportRegistry.list();
      expect(list).toHaveLength(2);
      expect(list.map((t) => t.id)).toContain("t1");
      expect(list.map((t) => t.id)).toContain("t2");
    });
  });

  describe("entryToTransportRecord", () => {
    it("should convert LogEntry to TransportRecord", () => {
      const entry: LogEntry = {
        timestamp: "2024-01-01T00:00:00.000Z",
        requestId: "abc123",
        method: "GET",
        path: "/api/users",
        status: 200,
        duration: 50,
        level: "info",
        slow: false,
      };

      const record = entryToTransportRecord(entry);

      expect(record.timestamp).toBe(entry.timestamp);
      expect(record.level).toBe("info");
      expect(record.requestId).toBe("abc123");
      expect(record.method).toBe("GET");
      expect(record.path).toBe("/api/users");
      expect(record.status).toBe(200);
      expect(record.duration).toBe(50);
      expect(record.raw).toBe(entry);
    });

    it("should handle error entry", () => {
      const entry: LogEntry = {
        timestamp: "2024-01-01T00:00:00.000Z",
        requestId: "abc123",
        method: "POST",
        path: "/api/error",
        status: 500,
        duration: 10,
        level: "error",
        error: {
          message: "Something went wrong",
          stack: "Error: Something went wrong\n    at ...",
        },
      };

      const record = entryToTransportRecord(entry);

      expect(record.error?.message).toBe("Something went wrong");
      expect(record.error?.stack).toContain("Error:");
    });
  });

  describe("createConsoleTransport", () => {
    it("should log to console based on level", () => {
      const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
      const consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});

      const transport = createConsoleTransport({ format: "pretty" });

      transport({ timestamp: new Date().toISOString(), level: "info" });
      expect(consoleSpy).toHaveBeenCalled();

      transport({ timestamp: new Date().toISOString(), level: "warn" });
      expect(consoleWarnSpy).toHaveBeenCalled();

      transport({ timestamp: new Date().toISOString(), level: "error" });
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });

  describe("createBufferTransport", () => {
    it("should collect records in buffer", () => {
      const buffer: LogTransportRecord[] = [];
      const transport = createBufferTransport(buffer);

      transport({ timestamp: "t1", level: "info" });
      transport({ timestamp: "t2", level: "warn" });

      expect(buffer).toHaveLength(2);
      expect(buffer[0].timestamp).toBe("t1");
      expect(buffer[1].timestamp).toBe("t2");
    });
  });

  describe("createFilteredTransport", () => {
    it("should filter records based on predicate", () => {
      const inner = mock();
      const filtered = createFilteredTransport(inner, (r) => r.status === 500);

      filtered({ timestamp: "t1", level: "info", status: 200 });
      expect(inner).not.toHaveBeenCalled();

      filtered({ timestamp: "t2", level: "error", status: 500 });
      expect(inner).toHaveBeenCalledTimes(1);
    });
  });

  describe("createBatchTransport", () => {
    it("should batch records and flush", async () => {
      const flushed: LogTransportRecord[][] = [];
      const { transport, flush, stop } = createBatchTransport(
        (records) => { flushed.push([...records]); },
        { maxSize: 3, flushInterval: 10000 }
      );

      transport({ timestamp: "t1", level: "info" });
      transport({ timestamp: "t2", level: "info" });
      expect(flushed).toHaveLength(0);

      transport({ timestamp: "t3", level: "info" }); // maxSize 도달
      expect(flushed).toHaveLength(1);
      expect(flushed[0]).toHaveLength(3);

      // 수동 flush
      transport({ timestamp: "t4", level: "info" });
      await flush();
      expect(flushed).toHaveLength(2);
      expect(flushed[1]).toHaveLength(1);

      stop();
    });
  });
});
