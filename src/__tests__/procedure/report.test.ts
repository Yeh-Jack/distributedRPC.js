import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReportProcedure } from "../../procedure/report";
import { ConfigManager } from "../../common/config";
import { TcpClient } from "../../network/tcp-client";
import { TcpServer } from "../../network/tcp-server";
import {
  AckType,
  ApiCall,
  ApiSpec,
  ExecutionState,
} from "../../types/basal-protocol";

vi.mock("../../aop/container", () => ({
  TYPES: {
    ConfigManager: "ConfigManager",
  },
}));

vi.mock("os", () => ({
  freemem: vi.fn().mockReturnValue(8 * 1024 * 1024 * 1024),
  totalmem: vi.fn().mockReturnValue(16 * 1024 * 1024 * 1024),
  cpus: vi.fn().mockReturnValue([{}, {}, {}, {}]),
  loadavg: vi.fn().mockReturnValue([2.5, 2.0, 1.5]),
}));

// Define mockApiSpec at module level so it's available in all describe blocks
const mockApiSpec: ApiSpec = {
  request: "ReportRequest",
  response: "ReportResponse",
  ack: AckType.Single,
};

describe("ReportProcedure", () => {
  let mockConfigManager: ConfigManager;
  let reportProcedure: ReportProcedure;
  let mockTcpClient: any;
  let mockTcpServer: any;
  let mockContext: any;
  let mockParent: any;

  const mockApiCounter = new Map<
    string,
    { success: number; invalidRequest: number; failedOnProcess: number }
  >();

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock TcpClient that passes instanceof check
    mockTcpClient = Object.create(TcpClient.prototype);
    Object.assign(mockTcpClient, {
      on: vi.fn(),
      emit: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      getTxBytes: vi.fn().mockReturnValue(1024),
      getRxBytes: vi.fn().mockReturnValue(2048),
    });

    // Create mock TcpServer that passes instanceof check
    mockTcpServer = Object.create(TcpServer.prototype);
    Object.assign(mockTcpServer, {
      on: vi.fn(),
      emit: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      getTxBytes: vi.fn().mockReturnValue(512),
      getRxBytes: vi.fn().mockReturnValue(768),
    });

    mockParent = {
      getState: vi.fn().mockReturnValue(ExecutionState.Running),
    };

    mockConfigManager = {
      getCoreConfig: () => ({
        report: {
          enabled: true,
          max_retries: 3,
          retry_delay: 10,
        },
      }),
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        silly: vi.fn(),
      }),
    } as unknown as ConfigManager;

    mockContext = {
      parent: mockParent,
      taskName: "_svcManager",
      tasks: new Map([
        ["_chnAPI", mockTcpServer],
        ["_chnResponse", mockTcpServer],
        ["_svcManager", mockTcpClient],
      ]),
      idGenerator: { generate: () => "uuid", shortId: () => "short-id" },
      manager: {
        manager: {
          apis: {
            report: mockApiSpec,
          },
        },
      },
      apiCounter: mockApiCounter,
      ask: vi.fn(),
      buildMessage: vi.fn().mockReturnValue({
        peer: { service: "TestProvider", instance: "provider-1" },
        api: "report",
        args: {},
        msgId: "msg-1",
      } as ApiCall),
    };

    reportProcedure = new ReportProcedure(mockConfigManager);
  });

  describe("constructor", () => {
    it("should create ReportProcedure with configManager", () => {
      expect(reportProcedure).toBeInstanceOf(ReportProcedure);
    });
  });

  describe("execute", () => {
    it("should return early when context is not provided", async () => {
      const consoleSpy = vi.spyOn(console, "log");
      await reportProcedure.execute();
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it("should return early when smTask is not a TcpClient", async () => {
      const invalidContext = {
        ...mockContext,
        tasks: new Map([["_svcManager", "not-a-tcp-client"]]),
      };

      await reportProcedure.execute(invalidContext);

      expect(mockContext.ask).not.toHaveBeenCalled();
    });

    it("should return early when smTask does not exist", async () => {
      const invalidContext = {
        ...mockContext,
        tasks: new Map(),
      };

      await reportProcedure.execute(invalidContext);

      expect(mockContext.ask).not.toHaveBeenCalled();
    });

    it("should send report to ServiceManager", async () => {
      const mockPromise = Promise.resolve({
        response: Buffer.from("ack"),
        request: {} as ApiCall,
      });

      // Set up ask mock before execution
      const askMock = vi.fn().mockResolvedValue({
        msgId: "msg-1",
        promise: mockPromise,
      });
      mockContext.ask = askMock;

      await reportProcedure.execute(mockContext);

      expect(mockContext.buildMessage).toHaveBeenCalledWith(
        "report",
        expect.objectContaining({
          timestamp: expect.any(Number),
          state: ExecutionState.Running,
          ramUsed: expect.any(Number),
          ramFree: expect.any(Number),
          cpuLoad: expect.any(Number),
        }),
      );
      expect(askMock).toHaveBeenCalled();
    });

    it("should retry on failure up to max_retries", async () => {
      let callCount = 0;
      const askMock = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          // Return a promise that rejects when awaited
          return Promise.reject(new Error("Network error"));
        }
        // Return a successful promise with the expected structure
        return Promise.resolve({
          msgId: `msg-${callCount}`,
          promise: Promise.resolve({
            response: Buffer.from("ack"),
            request: {} as ApiCall,
          }),
        });
      });
      mockContext.ask = askMock;

      await reportProcedure.execute(mockContext);

      expect(mockContext.ask).toHaveBeenCalledTimes(3);
    });

    it("should handle successful report without promise", async () => {
      const askMock = vi.fn().mockResolvedValue({
        msgId: "msg-1",
      });
      mockContext.ask = askMock;

      await reportProcedure.execute(mockContext);

      expect(askMock).toHaveBeenCalled();
    });

    it("should collect report data with network bytes from tasks", async () => {
      const mockPromise = Promise.resolve({
        response: Buffer.from("ack"),
        request: {} as ApiCall,
      });

      mockContext.ask = vi.fn().mockResolvedValue({
        msgId: "msg-1",
        promise: mockPromise,
      });

      // Set up buildMessage to capture the report data
      let capturedReportData: any;
      mockContext.buildMessage = vi
        .fn()
        .mockImplementation((api: string, args: any) => {
          capturedReportData = args;
          return {
            peer: { service: "TestProvider", instance: "provider-1" },
            api: "report",
            args: args,
            msgId: "msg-1",
          } as ApiCall;
        });

      await reportProcedure.execute(mockContext);

      expect(capturedReportData).toBeDefined();
      expect(capturedReportData.netTxBytes).toBeGreaterThan(0);
      expect(capturedReportData.netRxBytes).toBeGreaterThan(0);
    });
  });

  describe("_formatBytes", () => {
    it("should format bytes to B", () => {
      const result = (reportProcedure as any)._formatBytes(500);
      expect(result).toBe("500.00 B");
    });

    it("should format bytes to KB", () => {
      const result = (reportProcedure as any)._formatBytes(2048);
      expect(result).toBe("2.00 KB");
    });

    it("should format bytes to MB", () => {
      const result = (reportProcedure as any)._formatBytes(5 * 1024 * 1024);
      expect(result).toBe("5.00 MB");
    });

    it("should format bytes to GB", () => {
      const result = (reportProcedure as any)._formatBytes(
        2 * 1024 * 1024 * 1024,
      );
      expect(result).toBe("2.00 GB");
    });
  });
});

describe("ReportManagerInfo interface", () => {
  it("should have correct structure", () => {
    const managerInfo: ReportProcedure.ReportManagerInfo = {
      apis: {
        report: mockApiSpec,
      },
    };

    expect(managerInfo.apis.report).toBeDefined();
    expect(managerInfo.apis.report.ack).toBe(AckType.Single);
  });
});
