import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExecutionMetrics } from "../../metrics/exec-metrics";
import { LoggerManager } from "../../common/logger";

describe("ExecutionMetrics", () => {
  let metrics: ExecutionMetrics;
  let mockLogger: any;
  let mockLoggerManager: LoggerManager;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with LoggerManager", () => {
      mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      mockLoggerManager = {
        getLogger: () => mockLogger,
      } as unknown as LoggerManager;

      metrics = new ExecutionMetrics(mockLoggerManager);

      expect(metrics).toBeDefined();
    });

    it("should create instance with null LoggerManager (fallback to console)", () => {
      metrics = new ExecutionMetrics(null);

      expect(metrics).toBeDefined();
    });
  });

  describe("recordExecutionTime", () => {
    beforeEach(() => {
      mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      mockLoggerManager = {
        getLogger: () => mockLogger,
      } as unknown as LoggerManager;

      metrics = new ExecutionMetrics(mockLoggerManager);
    });

    it("should record successful execution time", () => {
      metrics.recordExecutionTime("TestService", "testMethod", 150.5, true);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("[EXEC]"),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("TestService.testMethod"),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("150.5000ms"),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("success"),
      );
    });

    it("should record failed execution time", () => {
      metrics.recordExecutionTime("TestService", "testMethod", 75.25, false);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("TestService.testMethod"),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("75.2500ms"),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("failed"),
      );
    });

    it("should record execution with zero duration", () => {
      metrics.recordExecutionTime("TestService", "fastMethod", 0, true);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("0.0000ms"),
      );
    });

    it("should record execution with very small duration", () => {
      metrics.recordExecutionTime("TestService", "fastMethod", 0.0001, true);

      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it("should record execution with large duration", () => {
      metrics.recordExecutionTime(
        "TestService",
        "slowMethod",
        999999.9999,
        true,
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("999999.9999ms"),
      );
    });

    it("should handle multiple calls with different parameters", () => {
      metrics.recordExecutionTime("ServiceA", "methodA", 100, true);
      metrics.recordExecutionTime("ServiceB", "methodB", 200, false);
      metrics.recordExecutionTime("ServiceC", "methodC", 300, true);

      expect(mockLogger.debug).toHaveBeenCalledTimes(3);
    });

    it("should record execution time for async methods", async () => {
      const start = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const duration = Date.now() - start;

      metrics.recordExecutionTime(
        "AsyncService",
        "asyncMethod",
        duration,
        true,
      );

      expect(mockLogger.debug).toHaveBeenCalled();
    });
  });

  describe("fallback behavior", () => {
    it("should use console when LoggerManager is null", () => {
      const consoleSpy = vi
        .spyOn(console, "debug")
        .mockImplementation(() => {});

      metrics = new ExecutionMetrics(null);
      metrics.recordExecutionTime("TestService", "testMethod", 100, true);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[EXEC]"),
      );

      consoleSpy.mockRestore();
    });

    it("should handle recordExecutionTime when logger is console", () => {
      const consoleSpy = vi
        .spyOn(console, "debug")
        .mockImplementation(() => {});

      metrics = new ExecutionMetrics(null);
      metrics.recordExecutionTime("TestService", "testMethod", 100, true);
      metrics.recordExecutionTime("TestService", "testMethod2", 200, false);

      expect(consoleSpy).toHaveBeenCalledTimes(2);

      consoleSpy.mockRestore();
    });
  });
});
