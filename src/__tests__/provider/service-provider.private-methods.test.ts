import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ServiceProvider } from "../../provider/service-provider";
import { ExecutionState, AccessPoint } from "../../types/basal-protocol";
import { DefaultIdGenerator } from "../../common/id-generator";
import { TcpClient } from "../../network/tcp-client";
import { TcpServer } from "../../network/tcp-server";

const mockIdGenerator = new DefaultIdGenerator();

const mockTracerInstance = {
  createNetworkSpan: () => ({
    setStatus: vi.fn(),
    setAttribute: vi.fn(),
    end: vi.fn(),
    recordException: vi.fn(),
  }),
  createBroadcastSpan: () => ({
    setStatus: vi.fn(),
    setAttribute: vi.fn(),
    end: vi.fn(),
    recordException: vi.fn(),
  }),
  shutdown: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../metrics/otel-tracing", () => ({
  OtelTracer: {
    getInstance: vi.fn(() => mockTracerInstance),
  },
}));

vi.mock("../../metrics/otel-metrics", () => ({
  activeConnections: { add: vi.fn() },
  bytesCounter: { add: vi.fn() },
  tcpConnectionDuration: { record: vi.fn() },
  tcpConnectionsFailed: { add: vi.fn() },
  tcpDataTransferSize: { record: vi.fn() },
  retryAttempts: { add: vi.fn() },
  retryDuration: { record: vi.fn() },
  executionTime: { record: vi.fn() },
  serverState: { observe: vi.fn() },
  listenerState: { observe: vi.fn() },
  udpBroadcastLatency: { record: vi.fn() },
  udpBroadcastRequests: { add: vi.fn() },
  udpBroadcastResponses: { add: vi.fn() },
  OtelProviderState: class {
    setState(state: any) {}
    getState() {
      return ExecutionState.Running;
    }
  },
  OtelMeterics: class {
    getMeter() {
      return {};
    }
    shutdown() {
      return Promise.resolve();
    }
  },
}));

class TestServiceProvider extends ServiceProvider {
  public testConfig: any;
  public testLogger: any;

  constructor(enableReport: boolean = false) {
    super(mockIdGenerator);
    this.testLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      silly: vi.fn(),
    };

    this.testConfig = {
      getCoreConfig: () => ({
        net: {
          tcp: {
            address: "127.0.0.1",
            port: 0,
            client: {
              timeout: 5000,
              keep_alive: false,
              keep_alive_initial_delay: 0,
            },
          },
          udp: { address: "127.0.0.1", port: 0 },
          sm_discovery: "None",
        },
        retry: {
          interval: 100,
          max_try: 3,
          backoff: { enable: true, max_delay: 1000, multiplier: 1.5 },
        },
        report: { enabled: enableReport },
        provider_id: "test-id",
        service_name: "TestProvider",
      }),
      getAppConfig: () => ({ redis: {} }),
      getLogger: () => this.testLogger,
      getProviderId: () => "test-id",
      reload: vi.fn(),
    };

    (this as any)._setConfigManager(this.testConfig);
  }

  protected override async starting(): Promise<void> {}
  protected override async stopping(): Promise<void> {}
  protected override buildAccessPointInfo(baseInfo: AccessPoint): AccessPoint {
    return { ...baseInfo, authorization: "test-auth", function: ["testFn"] };
  }
  protected override async initializingResources(): Promise<void> {}
}

describe("ServiceProvider Private Methods Coverage", () => {
  let provider: TestServiceProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new TestServiceProvider();
  });

  afterEach(async () => {
    const timer = (provider as any)._reportTimer;
    if (timer) {
      clearInterval(timer);
    }
    if (provider) {
      try {
        await provider.shutdown();
      } catch {}
    }
  });

  describe("_releaseOtel", () => {
    it("should shutdown metrics when initialized", async () => {
      const mockMetrics = {
        shutdown: vi.fn().mockResolvedValue(undefined),
      };
      (provider as any).metrics = mockMetrics;
      (provider as any).tracer = undefined;

      await (provider as any)._releaseOtel();

      expect(mockMetrics.shutdown).toHaveBeenCalled();
      expect((provider as any).metrics).toBeUndefined();
    });

    it("should shutdown tracer when initialized", async () => {
      vi.mocked(mockTracerInstance.shutdown).mockClear();
      (provider as any).metrics = undefined;
      (provider as any).tracer = mockTracerInstance;

      await (provider as any)._releaseOtel();

      expect(mockTracerInstance.shutdown).toHaveBeenCalled();
      expect((provider as any).tracer).toBeUndefined();
    });

    it("should handle case when neither is initialized", async () => {
      (provider as any).metrics = undefined;
      (provider as any).tracer = undefined;

      await expect((provider as any)._releaseOtel()).resolves.not.toThrow();
    });
  });

  describe("_startReportSchedule", () => {
    it("should not start schedule when report is disabled", async () => {
      const disabledProvider = new TestServiceProvider(false);
      await (disabledProvider as any)._startReportSchedule();

      expect(disabledProvider.testLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("disabled"),
      );
    });

    it("should not start schedule when no ServiceManager task exists", async () => {
      const enabledProvider = new TestServiceProvider(true);
      await (enabledProvider as any)._startReportSchedule();

      expect(enabledProvider.testLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("No ServiceManager found"),
      );
    });

    it("should start schedule when report enabled and SM task exists", async () => {
      const enabledProvider = new TestServiceProvider(true);
      const mockClient = {
        stop: vi.fn().mockResolvedValue(undefined),
        getSocket: vi.fn(() => ({})),
      };
      Object.setPrototypeOf(mockClient, TcpClient.prototype);

      (enabledProvider as any).tasks.set("_svcManager", mockClient);

      await (enabledProvider as any)._startReportSchedule();

      expect(enabledProvider.testLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Automatic reporting started"),
      );
      expect((enabledProvider as any)._reportTimer).toBeDefined();
    });
  });

  describe("_stopReportSchedule", () => {
    it("should clear the report timer if running", async () => {
      const enabledProvider = new TestServiceProvider(true);
      const mockClient = {
        stop: vi.fn().mockResolvedValue(undefined),
        getSocket: vi.fn(() => ({})),
      };
      Object.setPrototypeOf(mockClient, TcpClient.prototype);

      (enabledProvider as any).tasks.set("_svcManager", mockClient);
      await (enabledProvider as any)._startReportSchedule();
      expect((enabledProvider as any)._reportTimer).toBeDefined();

      await (enabledProvider as any)._stopReportSchedule();

      expect((enabledProvider as any)._reportTimer).toBeNull();
    });

    it("should handle when timer is not running", async () => {
      (provider as any)._reportTimer = null;

      await expect(
        (provider as any)._stopReportSchedule(),
      ).resolves.not.toThrow();
    });
  });

  describe("_releaseResponseChannels", () => {
    it("should close all response channel clients", async () => {
      const mockClient1 = {
        stop: vi.fn().mockResolvedValue(undefined),
        off: vi.fn(),
        removeAllListeners: vi.fn(),
      };
      const mockClient2 = {
        stop: vi.fn().mockResolvedValue(undefined),
        off: vi.fn(),
        removeAllListeners: vi.fn(),
      };

      (provider as any).chnResp = {
        "svc-1": { "inst-1": mockClient1 },
        "svc-2": { "inst-2": mockClient2 },
      };

      await (provider as any)._releaseResponseChannels();

      expect(mockClient1.stop).toHaveBeenCalled();
      expect(mockClient1.off).toHaveBeenCalled();
      expect(mockClient2.stop).toHaveBeenCalled();
      expect(mockClient2.off).toHaveBeenCalled();
      expect((provider as any).chnResp).toEqual({});
    });

    it("should handle empty response channels", async () => {
      (provider as any).chnResp = {};

      await expect(
        (provider as any)._releaseResponseChannels(),
      ).resolves.not.toThrow();
    });
  });

  describe("_stopManagerTask", () => {
    it("should stop and remove the manager task", async () => {
      const mockManagerTask = {
        stop: vi.fn().mockResolvedValue(undefined),
      };
      (provider as any).tasks.set("_svcManager", mockManagerTask);

      await (provider as any)._stopManagerTask();

      expect(mockManagerTask.stop).toHaveBeenCalled();
      expect((provider as any).tasks.get("_svcManager")).toBeUndefined();
    });

    it("should handle when no manager task exists", async () => {
      (provider as any).tasks.delete("_svcManager");

      await expect((provider as any)._stopManagerTask()).resolves.not.toThrow();
    });
  });

  describe("_initializeResources", () => {
    it("should initialize TCP server and response channel", async () => {
      vi.spyOn(provider as any, "initializeTcpServer").mockResolvedValue(
        {} as TcpServer,
      );
      vi.spyOn(provider as any, "setResponseChannel").mockResolvedValue(
        undefined,
      );

      await (provider as any)._initializeResources();

      expect((provider as any).initializeTcpServer).toHaveBeenCalledWith(
        "_chnResponse",
      );
      expect((provider as any).setResponseChannel).toHaveBeenCalledWith(true);
      expect((provider as any)._initialized).toBe(true);
    });
  });

  describe("initializeApiFunctionMap", () => {
    it("should initialize API function map with empty object", () => {
      (provider as any).apis = {};

      (provider as any).initializeApiFunctionMap();

      expect((provider as any).apis).toBeDefined();
      expect(typeof (provider as any).apis).toBe("object");
    });
  });

  describe("_parseRequest", () => {
    it("should parse valid API request", () => {
      const mockHandler = vi.fn();
      (provider as any).apis = { testApi: mockHandler };
      (provider as any).PROTOCOL = {
        apis: { testApi: { request: "any", response: "any", ack: 0 } },
      };

      const result = (provider as any)._parseRequest({
        peer: { service: "test", instance: "123" },
        api: "testApi",
        args: {},
        msgId: "msg-1",
      });

      expect(result).toBeDefined();
      expect(result?.api).toBe(mockHandler);
    });

    it("should return undefined for non-existent API", () => {
      (provider as any).apis = {};
      (provider as any).PROTOCOL = { apis: {} };

      const result = (provider as any)._parseRequest({
        peer: { service: "test", instance: "123" },
        api: "nonExistent",
        args: {},
        msgId: "msg-1",
      });

      expect(result).toBeUndefined();
    });

    it("should handle nested API paths", () => {
      const mockHandler = vi.fn();
      (provider as any).apis = { nested: { api: mockHandler } };
      (provider as any).PROTOCOL = {
        apis: { nested: { api: { request: "any", response: "any", ack: 0 } } },
      };

      const result = (provider as any)._parseRequest({
        peer: { service: "test", instance: "123" },
        api: "/nested/api",
        args: {},
        msgId: "msg-1",
      });

      expect(result).toBeDefined();
      expect(result?.api).toBe(mockHandler);
    });
  });
});
