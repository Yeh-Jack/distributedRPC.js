import "reflect-metadata";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ServiceProvider } from "../../provider/service-provider";
import { ServiceManager } from "../../manager/service-manager";
import { ConfigManager } from "../../common/config";
import { LoggerManager } from "../../common/logger";
import { TcpClient } from "../../network/tcp-client";
import { TcpServer } from "../../network/tcp-server";
import {
  ExecutionState,
  AckType,
  AckValue,
  ApiCall,
  SECOND,
  ReportData,
  PeerIdentity,
} from "../../types/basal-protocol";
import * as containerModule from "../../aop/container";

vi.mock("../../aop/container", () => ({
  createNamedTcpServer: vi.fn((config: any, name: string) => {
    const mockServer = Object.create(TcpServer.prototype);
    Object.assign(mockServer, {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
      getState: vi.fn().mockReturnValue("Listening" as any),
      getPort: vi.fn().mockReturnValue(8080),
      getServer: vi.fn().mockReturnValue({
        address: () => ({ port: 8080, address: "127.0.0.1" }),
      }),
      name,
    });
    return mockServer;
  }),
  createNamedUdpServer: vi.fn((name: string) => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    setManagerInfo: vi.fn(),
    name,
  })),
  createServiceManagerDiscover: vi.fn().mockReturnValue({
    discover: vi.fn().mockResolvedValue({ responses: [] }),
  }),
  TYPES: {
    IdGenerator: "IdGenerator",
    ConfigManager: "ConfigManager",
  },
}));

vi.mock("../../network/tcp-client");
vi.mock("../../network/tcp-server");
vi.mock("../../metrics/otel-metrics");
vi.mock("../../metrics/otel-tracing");
vi.mock("../../manager/api-spec-260321");

const createMockIdGenerator = () => ({
  generate: vi.fn().mockReturnValue("mock-uuid-1234"),
  shortId: vi.fn().mockReturnValue("short-id-5678"),
});

const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  silly: vi.fn(),
});

const createMockTcpClient = () => {
  const mockClient = Object.create(TcpClient.prototype);
  Object.assign(mockClient, {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue("msg-id-1"),
    on: vi.fn(),
    off: vi.fn(),
    getSocket: vi.fn().mockReturnValue({
      address: () => ({ port: 8080, address: "127.0.0.1" }),
    }),
  });
  return mockClient;
};

const createMockTcpServer = (name: string) => {
  const mockServer = Object.create(TcpServer.prototype);
  Object.assign(mockServer, {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    getState: vi.fn().mockReturnValue("Listening" as any),
    getPort: vi.fn().mockReturnValue(0),
    getServer: vi.fn().mockReturnValue({
      address: () => ({ port: 8080, address: "127.0.0.1" }),
    }),
    getTxBytes: vi.fn().mockReturnValue(1024),
    getRxBytes: vi.fn().mockReturnValue(2048),
    name,
  });
  return mockServer;
};

describe("ServiceProvider", () => {
  let mockIdGenerator: any;
  let serviceProvider: any;
  let mockLogger: any;
  let mockProviderState: any;
  let mockConfigManager: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = createMockLogger();

    mockProviderState = {
      getState: vi.fn().mockReturnValue(ExecutionState.Stopped),
      setState: vi.fn(),
      getProvider: vi.fn().mockReturnValue({
        enabled: true,
        "service.name": "TestServiceProvider",
        "service.instance": "short-id-5678",
        "protocol.version": "1.0.0",
        "deployment.environment": "development",
      }),
      setProvider: vi.fn(),
    };

    mockIdGenerator = createMockIdGenerator();

    mockConfigManager = {
      getCoreConfig: () => ({
        net: {
          tcp_address: "127.0.0.1",
          tcp_port: 0,
          udp_address: "127.0.0.1",
          udp_port: 9999,
          sm_discovery: "None" as any,
        },
        retry: {
          interval: 10,
          max_try: 2,
        },
        report: {
          enabled: true,
          interval: 60 * SECOND,
        },
        provider_id: "short-id-5678",
        service_name: "TestServiceProvider",
      }),
      getConfig: () => ({
        app: {},
        core: {
          net: {
            tcp_address: "127.0.0.1",
            tcp_port: 0,
          },
        },
      }),
      reload: vi.fn(),
      getLogger: () => mockLogger,
      getProviderId: () => "mockinstance01",
    };

    const TestServiceProvider = class TestServiceProvider extends ServiceProvider {
      constructor(idGenerator: any) {
        super(idGenerator);
        (this as any).logger = mockLogger;
        (this as any)._providerState = mockProviderState;
        (this as any).configManager = mockConfigManager;
      }

      protected buildAccessPointInfo(baseInfo: any): any {
        return baseInfo;
      }

      protected async initializingResources(): Promise<void> {}
      protected async releasingResources(): Promise<void> {}
      protected async reloading(): Promise<void> {}
      protected async starting(): Promise<void> {}
      protected async stopping(): Promise<void> {}
    };

    serviceProvider = new TestServiceProvider(mockIdGenerator);
  });

  describe("constructor", () => {
    it("should create ServiceProvider with idGenerator", () => {
      expect(serviceProvider).toBeInstanceOf(ServiceProvider);
    });

    it("should initialize PROTOCOL with generated id and class name", () => {
      const protocol = (serviceProvider as any).PROTOCOL;
      expect(protocol.protocol_ver).toBe("1.0.0");
      expect(protocol.provider.name).toBe("TestServiceProvider");
      expect(protocol.provider.id).toBe("short-id-5678");
    });

    it("should initialize tasks as empty Map", () => {
      expect((serviceProvider as any).tasks).toBeInstanceOf(Map);
    });

    it("should initialize chnResp as empty object", () => {
      expect((serviceProvider as any).chnResp).toEqual({});
    });

    it("should initialize polReqs as empty Map", () => {
      expect((serviceProvider as any).polReqs).toBeInstanceOf(Map);
    });
  });

  describe("getLogger", () => {
    it("should return logger instance", () => {
      const logger = serviceProvider.getLogger();
      expect(logger).toBeDefined();
      expect(logger).toBe(mockLogger);
    });
  });

  describe("getState", () => {
    it("should return current provider state", () => {
      expect(serviceProvider.getState()).toBe(ExecutionState.Stopped);
    });
  });

  describe("getServiceName", () => {
    it("should return the service name from protocol", () => {
      const serviceName = serviceProvider.getServiceName();
      expect(serviceName).toBe("TestServiceProvider");
    });
  });

  describe("getIdentity", () => {
    it("should return arrowed identity by default", () => {
      const identity = serviceProvider.getIdentity();
      expect(identity).toBe("<TestServiceProvider-short-id-5678>");
    });

    it("should return non-arrowed identity when arrowed is false", () => {
      const identity = serviceProvider.getIdentity(undefined, false);
      expect(identity).toBe("TestServiceProvider-short-id-5678");
    });
  });

  describe("getPeerId", () => {
    it("should return arrowed peer id by default", () => {
      const apiCall: ApiCall = {
        peer: { service: "OtherService", instance: "inst-xyz" },
        api: "test",
        args: {},
        msgId: "msg-1",
      };

      const peerId = serviceProvider.getPeerId(apiCall);
      expect(peerId).toBe("<OtherService-inst-xyz>");
    });

    it("should return non-arrowed peer id when arrowed is false", () => {
      const apiCall: ApiCall = {
        peer: { service: "OtherService", instance: "inst-xyz" },
        api: "test",
        args: {},
        msgId: "msg-1",
      };

      const peerId = serviceProvider.getPeerId(apiCall, false);
      expect(peerId).toBe("OtherService-inst-xyz");
    });
  });

  describe("getSocketString", () => {
    it("should return arrowed socket string by default", () => {
      const socketAddr = {
        address: "192.168.1.1",
        port: 8080,
        protocol: "TCP" as any,
      };
      const socketString = serviceProvider.getSocketString(socketAddr);
      expect(socketString).toBe("<192.168.1.1:8080>");
    });

    it("should return non-arrowed socket string when arrowed is false", () => {
      const socketAddr = {
        address: "192.168.1.1",
        port: 8080,
        protocol: "TCP" as any,
      };
      const socketString = serviceProvider.getSocketString(socketAddr, false);
      expect(socketString).toBe("192.168.1.1:8080");
    });
  });

  describe("collectProviderInfo", () => {
    it("should return provider info object", () => {
      const info = serviceProvider.collectProviderInfo();
      expect(info.enabled).toBe(true);
      expect(info["service.name"]).toBe("TestServiceProvider");
      expect(info["service.instance"]).toBe("short-id-5678");
      expect(info["protocol.version"]).toBe("1.0.0");
    });
  });

  describe("buildMessage", () => {
    it("should build ApiCall with correct peer information", () => {
      const apiCall = serviceProvider.buildMessage(
        "testApi",
        { arg: "value" },
        "msg-1",
      );

      expect(apiCall.peer.service).toBe("TestServiceProvider");
      expect(apiCall.peer.instance).toBe("short-id-5678");
      expect(apiCall.api).toBe("testApi");
      expect(apiCall.args).toEqual({ arg: "value" });
      expect(apiCall.msgId).toBe("msg-1");
    });
  });

  describe("initializeApiFunctionMap", () => {
    it("should initialize api function map", () => {
      serviceProvider.initializeApiFunctionMap();
      const apis = (serviceProvider as any).apis;
      expect(apis.activate).toBeDefined();
      expect(apis.getProtocol).toBeDefined();
      expect(apis.getState).toBeDefined();
    });
  });

  describe("Symbol.dispose", () => {
    it("should call shutdown", async () => {
      const shutdownSpy = vi.spyOn(serviceProvider, "shutdown");
      (serviceProvider as any)[Symbol.dispose]();
      expect(shutdownSpy).toHaveBeenCalled();
    });
  });

  describe("delay", () => {
    it("should delay for specified milliseconds", async () => {
      const start = Date.now();
      await serviceProvider.delay(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(45);
    });
  });

  describe("getConfigManager", () => {
    it("should return configManager instance", () => {
      const configMgr = serviceProvider.getConfigManager();
      expect(configMgr).toBeDefined();
    });
  });

  describe("logProtocol", () => {
    it("should log protocol information", () => {
      serviceProvider.logProtocol();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Protocol of the TestServiceProvider"),
      );
    });
  });

  describe("getProtocol", () => {
    it("should return JSON stringified protocol", async () => {
      const protocol = await serviceProvider.getProtocol();
      expect(typeof protocol).toBe("string");
      const parsed = JSON.parse(protocol);
      expect(parsed.protocol_ver).toBe("1.0.0");
      expect(parsed.provider.name).toBe("TestServiceProvider");
    });
  });

  describe("getServiceManagerInfo", () => {
    it("should return empty array when no manager info", () => {
      const info = serviceProvider.getServiceManagerInfo();
      expect(info).toEqual([]);
    });

    it("should return manager info when set", () => {
      (serviceProvider as any)._managerInfo = [{ manager: {} } as any];
      const info = serviceProvider.getServiceManagerInfo();
      expect(info).toHaveLength(1);
    });
  });

  describe("getMetrics", () => {
    it("should return metrics instance when initialized", () => {
      const mockMetrics = {} as any;
      (serviceProvider as any).metrics = mockMetrics;
      expect(serviceProvider.getMetrics()).toBe(mockMetrics);
    });
  });

  describe("setState", () => {
    it("should update state when different from current", () => {
      mockProviderState.getState.mockReturnValue(ExecutionState.Stopped);
      serviceProvider.setState(ExecutionState.Running);
      expect(mockProviderState.setState).toHaveBeenCalledWith(
        ExecutionState.Running,
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Stopped") &&
          expect.stringContaining("Running"),
      );
    });

    it("should not update state when same as current", () => {
      mockProviderState.getState.mockReturnValue(ExecutionState.Running);
      serviceProvider.setState(ExecutionState.Running);
      expect(mockProviderState.setState).not.toHaveBeenCalled();
    });
  });

  describe("getTask", () => {
    it("should return task when exists", () => {
      const mockTask = { name: "test-task" };
      (serviceProvider as any).tasks.set("test-task", mockTask);
      const task = serviceProvider.getTask("test-task");
      expect(task).toBe(mockTask);
    });

    it("should throw error when task does not exist", () => {
      expect(() => serviceProvider.getTask("non-existent")).toThrow(
        "The <non-existent> task doesn't exist.",
      );
    });
  });

  describe("initializeTcpClient", () => {
    it("should return existing tcp client if already initialized", async () => {
      const existingClient = createMockTcpClient();
      (serviceProvider as any).tasks.set("test-client", existingClient);

      const result = await serviceProvider.initializeTcpClient("test-client", {
        address: "127.0.0.1",
        port: 8080,
        protocol: "TCP" as any,
        authorization: "",
        api: [],
      });

      expect(result).toBe(existingClient);
    });

    it("should throw error when access point is missing", async () => {
      await expect(
        serviceProvider.initializeTcpClient("new-client" as any),
      ).rejects.toThrow("Missing AccessPoint argument.");
    });
  });

  describe("initializeTcpServer", () => {
    it("should return existing tcp server if already initialized", async () => {
      const existingServer = createMockTcpServer("existing-server");
      (serviceProvider as any).tasks.set("existing-server", existingServer);

      const result =
        await serviceProvider.initializeTcpServer("existing-server");
      expect(result).toBe(existingServer);
    });
  });

  describe("setApiChannel", () => {
    it("should initialize and return TCP server with subscription", async () => {
      vi.spyOn(serviceProvider, "initializeTcpServer" as any).mockResolvedValue(
        createMockTcpServer("_chnAPI"),
      );

      const result = await serviceProvider.setApiChannel(true);
      expect(result).toBeDefined();
    });

    it("should unsubscribe when subscribe is false", async () => {
      vi.spyOn(serviceProvider, "initializeTcpServer" as any).mockResolvedValue(
        createMockTcpServer("_chnAPI"),
      );

      await serviceProvider.setApiChannel(false);
    });
  });

  describe("setResponseChannel", () => {
    it("should initialize and return TCP server with subscription", async () => {
      vi.spyOn(serviceProvider, "initializeTcpServer" as any).mockResolvedValue(
        createMockTcpServer("_chnResponse"),
      );

      const result = await serviceProvider.setResponseChannel(true);
      expect(result).toBeDefined();
    });
  });

  describe("report", () => {
    it("should not send report when no manager task exists", async () => {
      (serviceProvider as any).tasks.clear();
      await serviceProvider.report();
    });
  });

  describe("register", () => {
    it("should return early if register procedure already running", async () => {
      (serviceProvider as any)._procedure.register = true;
      await serviceProvider.register();
      (serviceProvider as any)._procedure.register = undefined;
    });
  });

  describe("start", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should not start if already Running", async () => {
      mockProviderState.getState.mockReturnValue(ExecutionState.Running);

      await serviceProvider.start();
    });

    it("should not start if in Error state", async () => {
      mockProviderState.getState.mockReturnValue(ExecutionState.Error);

      await serviceProvider.start();
    });
  });

  describe("stop", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should stop service successfully when in Running state", async () => {
      mockProviderState.getState.mockReturnValue(ExecutionState.Running);

      const mockTcpServer = createMockTcpServer("test-task");
      (serviceProvider as any).tasks.set("test-task", mockTcpServer);

      vi.spyOn(serviceProvider as any, "_stopTask").mockResolvedValue(
        undefined,
      );
      vi.spyOn(serviceProvider as any, "_stopReportSchedule").mockResolvedValue(
        undefined,
      );
      vi.spyOn(serviceProvider, "report").mockResolvedValue(undefined);

      await serviceProvider.stop();

      expect(mockProviderState.setState).toHaveBeenCalledWith(
        ExecutionState.Stopping,
      );
      expect(mockProviderState.setState).toHaveBeenCalledWith(
        ExecutionState.Stopped,
      );
    });

    it("should not stop if not in Running state", async () => {
      mockProviderState.getState.mockReturnValue(ExecutionState.Stopped);

      await serviceProvider.stop();
    });
  });

  describe("shutdown", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should shutdown successfully", async () => {
      mockProviderState.getState.mockReturnValue(ExecutionState.Running);

      const mockTcpServer = createMockTcpServer("test-task");
      (serviceProvider as any).tasks.set("test-task", mockTcpServer);

      vi.spyOn(serviceProvider, "stop").mockResolvedValue(undefined);
      vi.spyOn(serviceProvider as any, "_stopReportSchedule").mockResolvedValue(
        undefined,
      );
      vi.spyOn(serviceProvider as any, "_stopManagerTask").mockResolvedValue(
        undefined,
      );
      vi.spyOn(serviceProvider as any, "_releaseResources").mockResolvedValue(
        undefined,
      );

      await serviceProvider.shutdown();

      expect(serviceProvider.stop).toHaveBeenCalled();
      expect(serviceProvider["_stopReportSchedule"]).toHaveBeenCalled();
      expect(serviceProvider["_stopManagerTask"]).toHaveBeenCalled();
      expect(serviceProvider["_releaseResources"]).toHaveBeenCalled();
    });
  });

  describe("restart", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should restart the service", async () => {
      mockProviderState.getState.mockReturnValue(ExecutionState.Stopped);

      vi.spyOn(serviceProvider, "stop").mockResolvedValue(undefined);
      vi.spyOn(serviceProvider as any, "_releaseResources").mockResolvedValue(
        undefined,
      );
      vi.spyOn(serviceProvider, "reload").mockResolvedValue(undefined);
      vi.spyOn(serviceProvider, "start").mockResolvedValue(undefined);

      await serviceProvider.restart();

      expect(serviceProvider.stop).toHaveBeenCalled();
      expect(serviceProvider.reload).toHaveBeenCalled();
      expect(serviceProvider.start).toHaveBeenCalled();
    });
  });

  describe("reload", () => {
    it("should reload configuration", async () => {
      await serviceProvider.reload();
      expect(mockConfigManager.reload).toHaveBeenCalled();
    });
  });

  describe("halt", () => {
    it("should halt the service", async () => {
      await serviceProvider.halt();
    });
  });

  describe("activate", () => {
    it("should activate the service", async () => {
      await serviceProvider.activate();
    });
  });

  describe("response", () => {
    it("should do nothing when target is not TcpClient", async () => {
      const respArgs = {
        apiSpec: { ack: AckType.Single } as any,
        data: "test",
        errType: AckValue.None,
        request: { msgId: "msg-1" } as ApiCall,
        target: null,
      };

      await serviceProvider.response(respArgs);
    });

    it("should handle error response", async () => {
      const mockTcpClient = createMockTcpClient();
      mockTcpClient.write = vi.fn().mockResolvedValue(undefined);

      const respArgs = {
        apiSpec: { ack: AckType.Single } as any,
        data: null,
        errType: AckValue.Error,
        request: { msgId: "msg-1" } as ApiCall,
        target: mockTcpClient,
      };

      await serviceProvider.response(respArgs);
      expect(mockTcpClient.write).toHaveBeenCalled();
    });

    it("should handle invalid request data error", async () => {
      const mockTcpClient = createMockTcpClient();
      mockTcpClient.write = vi.fn().mockResolvedValue(undefined);

      const respArgs = {
        apiSpec: { ack: AckType.Single } as any,
        data: null,
        errType: AckValue.InvalidReqData,
        request: { msgId: "msg-1" } as ApiCall,
        target: mockTcpClient,
      };

      await serviceProvider.response(respArgs);
    });

    it("should send response when ack type is not None", async () => {
      const mockTcpClient = createMockTcpClient();
      mockTcpClient.write = vi.fn().mockResolvedValue(undefined);

      const respArgs = {
        apiSpec: { ack: AckType.Single } as any,
        data: Buffer.from("response data"),
        errType: AckValue.None,
        request: { msgId: "msg-1" } as ApiCall,
        target: mockTcpClient,
      };

      await serviceProvider.response(respArgs);
      expect(mockTcpClient.write).toHaveBeenCalled();
    });
  });

  describe("getResponseChannel", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should throw error when peer info is missing", async () => {
      const apiCall: ApiCall = {
        peer: { service: "", instance: "" },
        api: "test",
        args: {},
        msgId: "msg-1",
      };

      await expect(serviceProvider.getResponseChannel(apiCall)).rejects.toThrow(
        "Lack of response target information.",
      );
    });

    it("should return existing channel without reconnecting", async () => {
      const mockTcpClient = createMockTcpClient();
      const peer: PeerIdentity = { service: "TestService", instance: "inst-1" };

      (serviceProvider as any).chnResp = {
        TestService: { "inst-1": mockTcpClient },
      };

      const apiCall: ApiCall = {
        peer,
        api: "test",
        args: {},
        msgId: "msg-1",
      };

      const result = await serviceProvider.getResponseChannel(apiCall);
      expect(result).toBe(mockTcpClient);
    });
  });

  describe("ask", () => {
    it("should return msgId without promise when ackType is None", async () => {
      const mockTcpClient = createMockTcpClient();
      mockTcpClient.sendMessage = vi.fn().mockResolvedValue("msg-id-test");

      const message: ApiCall = {
        peer: { service: "Test", instance: "inst" },
        api: "test",
        args: {},
        msgId: "msg-1",
      };

      const result = await serviceProvider.ask(
        mockTcpClient,
        message,
        AckType.None,
      );
      expect(result.msgId).toBe("msg-id-test");
      expect(result.promise).toBeUndefined();
    });

    it("should return promise when ackType is not None", async () => {
      const mockTcpClient = createMockTcpClient();
      mockTcpClient.sendMessage = vi.fn().mockResolvedValue("msg-id-test");

      const message: ApiCall = {
        peer: { service: "Test", instance: "inst" },
        api: "test",
        args: {},
        msgId: "msg-1",
      };

      const result = await serviceProvider.ask(
        mockTcpClient,
        message,
        AckType.Single,
      );
      expect(result.msgId).toBe("msg-id-test");
      expect(result.promise).toBeDefined();
    });
  });

  describe("_stopTask", () => {
    it("should stop task and delete from tasks map", async () => {
      const mockTask = {
        stop: vi.fn().mockResolvedValue(undefined),
        name: "test-task",
      };
      (serviceProvider as any).tasks.set("test-task", mockTask);

      await (serviceProvider as any)._stopTask("test-task");

      expect(mockTask.stop).toHaveBeenCalled();
    });

    it("should handle task without stop method", async () => {
      const mockTask = { name: "no-stop" };
      (serviceProvider as any).tasks.set("no-stop", mockTask);

      const result = await (serviceProvider as any)._stopTask("no-stop");
      expect(result).toBeUndefined();
    });

    it("should handle task not found", async () => {
      const result = await (serviceProvider as any)._stopTask("non-existent");
      expect(result).toBeUndefined();
    });
  });

  describe("_stopManagerTask", () => {
    it("should stop manager task when exists", async () => {
      vi.spyOn(serviceProvider as any, "_stopTask").mockResolvedValue(
        undefined,
      );
      (serviceProvider as any).tasks.set("_svcManager", createMockTcpClient());

      await (serviceProvider as any)._stopManagerTask();

      expect(serviceProvider["_stopTask"]).toHaveBeenCalledWith("_svcManager");
    });
  });

  describe("_releaseResponseChannels", () => {
    it("should release all response channels", async () => {
      const mockChannel1 = createMockTcpClient();
      mockChannel1.off = vi.fn();
      mockChannel1.stop = vi.fn().mockResolvedValue(undefined);

      const mockChannel2 = createMockTcpClient();
      mockChannel2.off = vi.fn();
      mockChannel2.stop = vi.fn().mockResolvedValue(undefined);

      (serviceProvider as any).chnResp = {
        ServiceA: { "inst-1": mockChannel1 },
        ServiceB: { "inst-2": mockChannel2 },
      };

      await (serviceProvider as any)._releaseResponseChannels();

      expect(mockChannel1.off).toHaveBeenCalled();
      expect(mockChannel1.stop).toHaveBeenCalled();
      expect(mockChannel2.off).toHaveBeenCalled();
      expect(mockChannel2.stop).toHaveBeenCalled();
    });

    it("should not throw when all channels are released", async () => {
      const mockChannel = createMockTcpClient();
      mockChannel.off = vi.fn();
      mockChannel.stop = vi.fn().mockResolvedValue(undefined);

      (serviceProvider as any).chnResp = {
        ServiceA: { "inst-1": mockChannel },
      };

      await (serviceProvider as any)._releaseResponseChannels();
      expect(mockChannel.off).toHaveBeenCalled();
      expect(mockChannel.stop).toHaveBeenCalled();
    });

    it("should throw error when some channels cannot be released", async () => {
      const mockChannel = createMockTcpClient();
      mockChannel.off = vi.fn();
      mockChannel.stop = vi.fn().mockResolvedValue(undefined);

      (serviceProvider as any).chnResp = {
        ServiceA: { "inst-1": mockChannel },
      };

      vi.spyOn(Object, "entries").mockReturnValueOnce([
        ["ServiceA", { "inst-1": mockChannel }],
      ] as any);
      vi.spyOn(Object, "keys").mockReturnValueOnce(["inst-1"] as any);

      await expect(
        (serviceProvider as any)._releaseResponseChannels(),
      ).rejects.toThrow(
        "Unable to release some resources on the response channel pool.",
      );
    });
  });

  describe("buildAccessPointInfo", () => {
    it("should throw error when called on base ServiceProvider", () => {
      const BaseServiceProvider = class BaseServiceProvider extends ServiceProvider {
        constructor(idGenerator: any) {
          super(idGenerator);
          (this as any).logger = mockLogger;
          (this as any)._providerState = mockProviderState;
        }
      };
      const baseInstance = new BaseServiceProvider(mockIdGenerator);
      expect(() => baseInstance.buildAccessPointInfo({} as any)).toThrow(
        "Method buildAccessPointInfo(baseInfo: AccessPoint) is not implemented.",
      );
    });

    it("should return baseInfo when called on subclass", () => {
      const subclass = class extends ServiceProvider {
        constructor() {
          super(mockIdGenerator);
          (this as any).logger = mockLogger;
          (this as any)._providerState = mockProviderState;
        }
        protected buildAccessPointInfo(baseInfo: any): any {
          return { ...baseInfo, authorization: "test-auth" };
        }
        protected async initializingResources(): Promise<void> {}
        protected async releasingResources(): Promise<void> {}
        protected async reloading(): Promise<void> {}
        protected async starting(): Promise<void> {}
        protected async stopping(): Promise<void> {}
      };

      const instance = new subclass();
      const result = instance.buildAccessPointInfo({ api: ["test"] });
      expect(result.authorization).toBe("test-auth");
    });
  });

  describe("protected methods throwing errors on base class", () => {
    const createBaseServiceProviderInstance = () => {
      const BaseServiceProvider = class BaseServiceProvider extends ServiceProvider {
        constructor(idGenerator: any) {
          super(idGenerator);
          (this as any).logger = mockLogger;
          (this as any)._providerState = mockProviderState;
        }
      };
      return new BaseServiceProvider(mockIdGenerator);
    };

    it("initializingResources should throw error", async () => {
      const instance = createBaseServiceProviderInstance();
      await expect(instance["initializingResources"]()).rejects.toThrow(
        "Method initializing() is not implemented.",
      );
    });

    it("releasingResources should throw error", async () => {
      const instance = createBaseServiceProviderInstance();
      await expect(instance["releasingResources"]()).rejects.toThrow(
        "Method releasingResources() is not implemented.",
      );
    });

    it("reloading should throw error", async () => {
      const instance = createBaseServiceProviderInstance();
      await expect(instance["reloading"]()).rejects.toThrow(
        "Method reloading() is not implemented.",
      );
    });

    it("starting should throw error", async () => {
      const instance = createBaseServiceProviderInstance();
      await expect(instance["starting"]()).rejects.toThrow(
        "Method starting() is not implemented.",
      );
    });

    it("stopping should throw error", async () => {
      const instance = createBaseServiceProviderInstance();
      await expect(instance["stopping"]()).rejects.toThrow(
        "Method stopping() is not implemented.",
      );
    });
  });

  describe("_updateApiCounter", () => {
    it("should increment success counter", () => {
      const json: ApiCall = {
        peer: { service: "Test", instance: "inst" },
        api: "testApi",
        args: {},
        msgId: "msg-1",
      };

      (serviceProvider as any)._updateApiCouynter(AckValue.None, json);
      const counter = (serviceProvider as any)._apiCounter.get("testApi");
      expect(counter?.success).toBe(1);
    });

    it("should increment invalidRequest counter", () => {
      const json: ApiCall = {
        peer: { service: "Test", instance: "inst" },
        api: "testApi",
        args: {},
        msgId: "msg-1",
      };

      (serviceProvider as any)._updateApiCouynter(
        AckValue.InvalidReqData,
        json,
      );
      const counter = (serviceProvider as any)._apiCounter.get("testApi");
      expect(counter?.invalidRequest).toBe(1);
    });

    it("should increment failedOnProcess counter", () => {
      const json: ApiCall = {
        peer: { service: "Test", instance: "inst" },
        api: "testApi",
        args: {},
        msgId: "msg-1",
      };

      (serviceProvider as any)._updateApiCouynter(AckValue.Error, json);
      const counter = (serviceProvider as any)._apiCounter.get("testApi");
      expect(counter?.failedOnProcess).toBe(1);
    });
  });

  describe("_stopReportSchedule", () => {
    it("should clear interval when timer exists", async () => {
      vi.useFakeTimers();
      const mockTimer = setInterval(() => {}, 1000);
      (serviceProvider as any)._reportTimer = mockTimer;

      await (serviceProvider as any)._stopReportSchedule();

      expect((serviceProvider as any)._reportTimer).toBeNull();
      clearInterval(mockTimer);
      vi.useRealTimers();
    });

    it("should do nothing when timer is null", async () => {
      (serviceProvider as any)._reportTimer = null;

      await (serviceProvider as any)._stopReportSchedule();
    });
  });

  describe("_startReportSchedule", () => {
    it("should start report schedule when conditions are met", async () => {
      const mockTcpClient = createMockTcpClient();
      (serviceProvider as any).tasks.set("_svcManager", mockTcpClient);
      (serviceProvider as any)._reportTimer = null;

      const reportConfig = {
        enabled: true,
        interval: 1000,
      };

      const configWithReporting = {
        getCoreConfig: () => ({
          ...mockConfigManager.getCoreConfig(),
          report: reportConfig,
        }),
        getLogger: () => mockLogger,
      };

      (serviceProvider as any).configManager = configWithReporting;

      await (serviceProvider as any)._startReportSchedule();

      const timer = (serviceProvider as any)._reportTimer;
      expect(timer).not.toBeNull();

      clearInterval(timer);
    });

    it("should not start when reporting is disabled", async () => {
      const configWithReportingDisabled = {
        getCoreConfig: () => ({
          ...mockConfigManager.getCoreConfig(),
          report: { enabled: false },
        }),
        getLogger: () => mockLogger,
      };

      (serviceProvider as any).configManager = configWithReportingDisabled;

      await (serviceProvider as any)._startReportSchedule();

      expect((serviceProvider as any)._reportTimer).toBeNull();
    });

    it("should not start when no manager task exists", async () => {
      (serviceProvider as any).tasks.clear();

      const reportConfig = {
        enabled: true,
        interval: 1000,
      };

      const configWithReporting = {
        getCoreConfig: () => ({
          ...mockConfigManager.getCoreConfig(),
          report: reportConfig,
        }),
        getLogger: () => mockLogger,
      };

      (serviceProvider as any).configManager = configWithReporting;

      await (serviceProvider as any)._startReportSchedule();

      expect((serviceProvider as any)._reportTimer).toBeNull();
    });
  });

  describe("_stopTask error handling", () => {
    it("should log error when task.stop() fails", async () => {
      const mockTask = {
        stop: vi.fn().mockRejectedValue(new Error("Stop failed")),
        name: "failing-task",
      };
      (serviceProvider as any).tasks.set("failing-task", mockTask);

      await (serviceProvider as any)._stopTask("failing-task");

      expect(mockTask.stop).toHaveBeenCalled();
    });
  });

  describe("_setConfigManager with Unknown service", () => {
    it("should set service_name to class name when config service_name is Unknown", () => {
      const coreConfigState = {
        service_name: "Unknown",
        provider_id: "test-id",
      };

      const configWithUnknownServiceName = {
        getCoreConfig: () => coreConfigState,
        getConfig: () => ({ app: {}, core: {} }),
        getLogger: () => mockLogger,
        reload: vi.fn(),
        getProviderId: () => "test-id",
      };

      (serviceProvider as any).PROTOCOL.provider.name = "TestServiceProvider";
      (serviceProvider as any)._setConfigManager(configWithUnknownServiceName);

      expect(coreConfigState.service_name).toBe("TestServiceProvider");
    });
  });

  describe("integration with ServiceManager", () => {
    let serviceManager: ServiceManager;
    let mockServiceProviderLogger: any;
    let smLogger: any;

    beforeEach(() => {
      vi.clearAllMocks();

      smLogger = createMockLogger();

      const smConfigManager = {
        getCoreConfig: () => ({
          net: {
            tcp_address: "127.0.0.1",
            tcp_port: 0,
            udp_address: "127.0.0.1",
            udp_port: 9999,
            sm_discovery: "None" as any,
          },
          retry: {
            interval: 10,
            max_try: 2,
          },
          report: {
            enabled: false,
          },
          provider_id: "sm-instance-01",
          service_name: "ServiceManager",
        }),
        getAppConfig: () => ({ redis: {} }),
        getLogger: () => smLogger,
        getProviderId: () => "sm-instance-01",
      };

      serviceManager = new ServiceManager(mockIdGenerator);
      (serviceManager as any)._setConfigManager(smConfigManager);

      mockServiceProviderLogger = createMockLogger();
    });

    describe("ServiceManager lifecycle", () => {
      it("should have correct initial state", () => {
        expect(serviceManager.getState()).toBe(ExecutionState.Stopped);
      });

      it("should report state via getState", () => {
        expect(serviceManager.getState()).toBeDefined();
      });

      it("should get protocol", async () => {
        const protocol = await serviceManager.getProtocol();
        expect(typeof protocol).toBe("string");
      });

      it("should log protocol", () => {
        serviceManager.logProtocol();
        expect(smLogger.info).toHaveBeenCalled();
      });
    });

    describe("gotReport", () => {
      it("should store report data from service provider", async () => {
        const peer = { service: "TestProvider", instance: "inst-1" };
        const reportData: ReportData = {
          timestamp: Date.now(),
          state: ExecutionState.Running,
          ramUsed: 512,
          ramFree: 1024,
          cpuLoad: 45,
          netTx: "1.00 MB",
          netTxBytes: 1048576,
          netRx: "2.00 MB",
          netRxBytes: 2097152,
        };

        await serviceManager.gotReport({
          peer,
          api: "report",
          args: reportData,
          msgId: "msg-1",
        });

        const reports = serviceManager.getReports(peer);
        expect(reports).toHaveLength(1);
      });

      it("should warn on invalid report data", async () => {
        await serviceManager.gotReport({
          peer: { service: "Test", instance: "inst" },
          api: "report",
          args: undefined,
          msgId: "msg-1",
        });

        expect(smLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining("Invalid report data"),
        );
      });
    });

    describe("clearReports", () => {
      it("should clear reports for specific peer", () => {
        const peer = { service: "TestProvider", instance: "inst-1" };
        const reportData: ReportData = {
          timestamp: Date.now(),
          state: ExecutionState.Running,
          ramUsed: 512,
          ramFree: 1024,
          cpuLoad: 45,
          netTx: "1.00 MB",
          netTxBytes: 1048576,
          netRx: "2.00 MB",
          netRxBytes: 2097152,
        };

        serviceManager.gotReport({
          peer,
          api: "report",
          args: reportData,
          msgId: "msg-1",
        });

        expect(serviceManager.getReports(peer)).toHaveLength(1);
        serviceManager.clearReports(peer);
        expect(serviceManager.getReports(peer)).toHaveLength(0);
      });
    });

    describe("getLatestReport", () => {
      it("should return undefined when no reports exist", () => {
        const latest = serviceManager.getLatestReport({
          service: "none",
          instance: "none",
        });
        expect(latest).toBeUndefined();
      });
    });

    describe("getReportedInstances", () => {
      it("should return empty array when no instances reported", () => {
        const instances = serviceManager.getReportedInstances();
        expect(instances).toEqual([]);
      });
    });

    describe("getTcpServer", () => {
      it("should return undefined when no TCP server is registered", () => {
        const tcpServer = serviceManager.getTcpServer("non-existent");
        expect(tcpServer).toBeUndefined();
      });
    });

    describe("getUdpServer", () => {
      it("should return undefined when no UDP server is registered", () => {
        const udpServer = serviceManager.getUdpServer("non-existent");
        expect(udpServer).toBeUndefined();
      });
    });
  });
});
