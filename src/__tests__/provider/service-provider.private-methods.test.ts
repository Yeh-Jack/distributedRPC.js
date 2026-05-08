import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ServiceProvider } from "../../provider/service-provider";
import { ExecutionState, AccessPoint, AckValue, ApiCall, SECOND } from "../../types/basal-protocol";
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

  describe("_initializeResources", () => {
    it("should initialize TCP server and response channel", async () => {
      vi.spyOn(provider as any, "getTcpServer").mockResolvedValue(
        {} as TcpServer,
      );
      vi.spyOn(provider as any, "setResponseChannel").mockResolvedValue(
        undefined,
      );

      await (provider as any)._initializeResources();

      expect((provider as any).getTcpServer).toHaveBeenCalledWith(
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

  describe("_setConfigManager", () => {
    it("should set config manager and reinitialize logger", () => {
      const newConfig = {
        getCoreConfig: () => ({}),
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          silly: vi.fn(),
        }),
      };

      (provider as any)._setConfigManager(newConfig);

      expect((provider as any).configManager).toBe(newConfig);
      expect((provider as any).logger).toBeDefined();
    });
  });

  describe("_updateApiCounter", () => {
    it("should increment success counter", () => {
      const json = { api: "testApi" };
      (provider as any)._apiCounter = new Map();

      (provider as any)._updateApiCounter(AckValue.None, json);

      const counter = (provider as any)._apiCounter.get("testApi");
      expect(counter?.success).toBe(1);
    });

    it("should increment invalidRequest counter", () => {
      const json = { api: "testApi" };
      (provider as any)._apiCounter = new Map();

      (provider as any)._updateApiCounter(AckValue.InvalidReqData, json);

      const counter = (provider as any)._apiCounter.get("testApi");
      expect(counter?.invalidRequest).toBe(1);
    });

    it("should increment failedOnProcess counter", () => {
      const json = { api: "testApi" };
      (provider as any)._apiCounter = new Map();

      (provider as any)._updateApiCounter(AckValue.Error, json);

      const counter = (provider as any)._apiCounter.get("testApi");
      expect(counter?.failedOnProcess).toBe(1);
    });
  });

  describe("_handleRequestError", () => {
    it("should return AckValue.Error for generic errors", () => {
      const error = new Error("test error");
      const result = (provider as any)._handleRequestError(
        error,
        "{}",
        "testApi",
      );
      expect(result).toBe(AckValue.Error);
    });

    it("should return AckValue.InvalidReqData for JSON parse errors", () => {
      const error = new SyntaxError("Invalid JSON");
      const result = (provider as any)._handleRequestError(
        error,
        "invalid json",
        "testApi",
      );
      expect(result).toBe(AckValue.InvalidReqData);
    });

    it("should return AckValue.InvalidReqData for TypeErrors", () => {
      const error = new TypeError("null is not an object");
      const result = (provider as any)._handleRequestError(
        error,
        "{}",
        "testApi",
      );
      expect(result).toBe(AckValue.InvalidReqData);
    });
  });

  describe("_updateProviderInfo", () => {
    it("should update provider info", () => {
      (provider as any).PROVIDER_INFO = {} as any;
      (provider as any).PROTOCOL = {
        provider: { id: "new-id", name: "NewName", version: "2.0" },
      };

      (provider as any)._updateProviderInfo();

      expect((provider as any).PROVIDER_INFO).toBeDefined();
    });
  });

  describe("getState", () => {
    it("should return current state", () => {
      (provider as any)._providerState = {
        getState: vi.fn().mockReturnValue(ExecutionState.Running),
      };

      const state = (provider as any).getState();

      expect(state).toBe(ExecutionState.Running);
    });
  });

  describe("getState", () => {
    it("should return current state", () => {
      (provider as any)._providerState = {
        getState: vi.fn().mockReturnValue(ExecutionState.Running),
      };

      const state = (provider as any).getState();

      expect(state).toBe(ExecutionState.Running);
    });
  });

  describe("getTask", () => {
    it("should return task by name", () => {
      const mockTask = { name: "test-task" };
      (provider as any).tasks = new Map([["test-task", mockTask]]);

      const result = (provider as any).getTask("test-task");

      expect(result).toBe(mockTask);
    });

    it("should return default task when name not specified", () => {
      const mockTask = { name: "_chnResponse" };
      (provider as any).tasks = new Map([["_chnResponse", mockTask]]);

      const result = (provider as any).getTask();

      expect(result).toBe(mockTask);
    });
  });

  describe("getPeerId", () => {
    it("should return arrowed peer id", () => {
      const data: ApiCall = {
        peer: { service: "TestService", instance: "inst-1" },
        api: "test",
        args: {},
      };

      const result = (provider as any).getPeerId(data, true);

      expect(result).toContain("TestService");
      expect(result).toContain("inst-1");
    });

    it("should return non-arrowed peer id", () => {
      const data: ApiCall = {
        peer: { service: "TestService", instance: "inst-1" },
        api: "test",
        args: {},
      };

      const result = (provider as any).getPeerId(data, false);

      expect(result).toContain("TestService");
      expect(result).toContain("inst-1");
    });
  });

  describe("delay", () => {
    it("should delay for specified milliseconds", async () => {
      const start = Date.now();
      await (provider as any).delay(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(45);
    });
  });

  describe("getMetrics", () => {
    it("should return metrics instance", () => {
      const mockMetrics = {};
      (provider as any).metrics = mockMetrics;

      const result = (provider as any).getMetrics();

      expect(result).toBe(mockMetrics);
    });
  });

  describe("_handleApiRequest", () => {
    it("should return early when data is missing", async () => {
      await (provider as any)._handleApiRequest(null as any);
      expect(provider.testLogger.debug).toHaveBeenCalledWith(
        "Incomplete message received.",
      );
    });
  });

  describe("_handleApiResponse", () => {
    it("should return early when peer is missing", () => {
      (provider as any)._handleApiResponse({ peer: null as any, data: "test" });
      expect(provider.testLogger.debug).toHaveBeenCalledWith(
        "Incomplete message received.",
      );
    });

    it("should return early when data is missing", () => {
      (provider as any)._handleApiResponse({ peer: {} as any, data: null as any });
      expect(provider.testLogger.debug).toHaveBeenCalledWith(
        "Incomplete message received.",
      );
    });

    it("should return early when data is too short", () => {
      (provider as any)._handleApiResponse({ peer: {} as any, data: "short" });
      expect(provider.testLogger.debug).toHaveBeenCalledWith(
        "Incomplete message received.",
      );
    });
  });

  describe("getResponseChannel", () => {
    it("should return existing channel client", async () => {
      const mockClient = { name: "client1" };
      (provider as any).chnResp = {
        "test-svc": { "inst-1": mockClient },
      };
      (provider as any).tasks = new Map();

      const result = await (provider as any).getResponseChannel({
        peer: { service: "test-svc", instance: "inst-1" },
        api: "test",
        args: {},
      });

      expect(result).toBe(mockClient);
    });
  });

  describe("setApiChannel", () => {
    it("should subscribe to API channel events", async () => {
      const mockServer = {
        on: vi.fn(),
        off: vi.fn(),
      };
      vi.spyOn(provider as any, "getTcpServer").mockResolvedValue(mockServer as any);

      await (provider as any).setApiChannel(true);

      expect(mockServer.on).toHaveBeenCalled();
    });

    it("should unsubscribe from API channel events", async () => {
      const mockServer = {
        on: vi.fn(),
        off: vi.fn(),
      };
      vi.spyOn(provider as any, "getTcpServer").mockResolvedValue(mockServer as any);

      await (provider as any).setApiChannel(false);

      expect(mockServer.off).toHaveBeenCalled();
    });
  });

  describe("setResponseChannel", () => {
    it("should subscribe to response channel events", async () => {
      const mockServer = {
        on: vi.fn(),
        off: vi.fn(),
      };
      vi.spyOn(provider as any, "getTcpServer").mockResolvedValue(mockServer as any);

      await (provider as any).setResponseChannel(true);

      expect(mockServer.on).toHaveBeenCalled();
    });

    it("should unsubscribe from response channel events", async () => {
      const mockServer = {
        on: vi.fn(),
        off: vi.fn(),
      };
      vi.spyOn(provider as any, "getTcpServer").mockResolvedValue(mockServer as any);

      await (provider as any).setResponseChannel(false);

      expect(mockServer.off).toHaveBeenCalled();
    });
  });
});
