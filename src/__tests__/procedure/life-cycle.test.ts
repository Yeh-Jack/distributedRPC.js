import { describe, it, expect, vi, beforeEach } from "vitest";
import { LifeCycleProcedure, LifeCycleContext, LifeCycleOperation } from "../../procedure/life-cycle";
import { ConfigManager } from "../../common/config";
import { ExecutionState, AckValue, ApiCall, ApiSpec } from "../../types/basal-protocol";
import { TcpServer } from "../../network/tcp-server";
import { TcpClient } from "../../network/tcp-client";
import { TypedEventEmitter } from "../../network/typed-event-emitter";
import { ServiceEvent, ServiceEventMap, ProviderTask } from "../../provider/service-provider";

vi.mock("../../aop/container", () => ({
  createNamedTcpServer: vi.fn(),
  createNamedUdpServer: vi.fn(),
  createServiceManagerDiscover: vi.fn().mockReturnValue({
    discover: vi.fn().mockResolvedValue({ responses: [] }),
  }),
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

describe("LifeCycleProcedure", () => {
  let mockConfigManager: ConfigManager;
  let mockLogger: any;
  let mockIdGenerator: any;
  let mockEventEmitter: TypedEventEmitter<ServiceEventMap>;
  let mockParent: any;
  let mockTasks: Map<string, any>;
  let lifeCycleProcedure: LifeCycleProcedure;

  const createMockContext = (overrides: Partial<LifeCycleContext> = {}): LifeCycleContext => {
    return {
      taskName: ProviderTask.ChannelSys,
      tasks: mockTasks,
      idGenerator: mockIdGenerator,
      eventEmitter: mockEventEmitter,
      operation: "start" as LifeCycleOperation,
      parent: mockParent,
      ask: vi.fn().mockResolvedValue({ msgId: "msg-id-1" }),
      buildMessage: vi.fn().mockReturnValue({ api: "test" } as ApiCall),
      getIdentity: vi.fn().mockReturnValue("TestProvider"),
      setState: vi.fn(),
      ...overrides,
    } as unknown as LifeCycleContext;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      silly: vi.fn(),
    };

    mockIdGenerator = {
      generate: vi.fn().mockReturnValue("mock-uuid-1234"),
      shortId: vi.fn().mockReturnValue("short-id-5678"),
    };

    mockEventEmitter = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      removeAllListeners: vi.fn(),
    } as unknown as TypedEventEmitter<ServiceEventMap>;

    mockTasks = new Map();

    mockConfigManager = {
      getCoreConfig: () => ({
        report: {
          enabled: false,
        },
      }),
      getLogger: () => mockLogger,
      reload: vi.fn(),
    } as unknown as ConfigManager;

    mockParent = {
      getState: vi.fn().mockReturnValue(ExecutionState.Stopped),
      "_initialized": false,
      "_apiCounter": { success: 0, invalidRequest: 0, failedOnProcess: 0 },
      "PROTOCOL": { protocol_ver: "1.0.0", apis: {}, provider: { id: "test", name: "TestProvider", desc: "", version: "1.0.0" } },
      "_procedure": {},
      getTcpTaskInfo: vi.fn().mockReturnValue({ address: "127.0.0.1", port: 8080 }),
      getTcpServer: vi.fn().mockResolvedValue(Object.create(TcpServer.prototype, { start: { value: vi.fn() }, stop: { value: vi.fn() } })),
      _setConfigManager: vi.fn(),
      _parseRequest: vi.fn().mockReturnValue({ apiSpec: {}, apiName: "test" }),
      _handleRequestError: vi.fn().mockReturnValue(AckValue.None),
      _updateApiCounter: vi.fn(),
      response: vi.fn().mockResolvedValue(undefined),
      _initializeResources: vi.fn().mockResolvedValue(undefined),
      starting: vi.fn().mockResolvedValue(undefined),
      stopping: vi.fn().mockResolvedValue(undefined),
      reloading: vi.fn().mockResolvedValue(undefined),
      releasingResources: vi.fn().mockResolvedValue(undefined),
      _releaseResponseChannels: vi.fn().mockResolvedValue(undefined),
      _releaseOtel: vi.fn().mockResolvedValue(undefined),
    };

    lifeCycleProcedure = new LifeCycleProcedure(mockConfigManager);
  });

  describe("constructor", () => {
    it("should create LifeCycleProcedure instance", () => {
      expect(lifeCycleProcedure).toBeInstanceOf(LifeCycleProcedure);
    });
  });

  describe("execute", () => {
    it("should return false when context is missing", async () => {
      const result = await lifeCycleProcedure.execute();
      expect(result).toBe(false);
    });

    it("should return false when operation is missing", async () => {
      const context = createMockContext({ operation: undefined as any });
      const result = await lifeCycleProcedure.execute(context);
      expect(result).toBe(false);
    });

    it("should return false when parent is missing", async () => {
      const context = createMockContext({ parent: undefined });
      const result = await lifeCycleProcedure.execute(context);
      expect(result).toBe(false);
    });
  });

  describe("getServiceManager", () => {
    it("should return empty manager info by default", () => {
      const result = lifeCycleProcedure.getServiceManager();
      expect(result).toEqual({});
    });

    it("should return set manager info", () => {
      (lifeCycleProcedure as any)._manager = { manager: { id: "mgr-1" }, managerInfo: [], instance: null };
      const result = lifeCycleProcedure.getServiceManager();
      expect(result.manager).toBeDefined();
    });
  });

  describe("_doSysInstruction", () => {
    it("should return false for invalid operation", async () => {
      const context = createMockContext({ operation: "start" });
      await lifeCycleProcedure.execute(context);

      const result = await (lifeCycleProcedure as any)._doSysInstruction("invalid" as LifeCycleOperation);
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith("Invalid system instruction: <invalid>.");
    });
  });

  describe("_start", () => {
    it("should return false when parent state is not acceptable", async () => {
      mockParent.getState.mockReturnValue(ExecutionState.Running);
      const context = createMockContext({ operation: "start" });
      await lifeCycleProcedure.execute(context);

      const result = await (lifeCycleProcedure as any)._start();
      expect(result).toBe(false);
    });

    it("should start service from Stopped state", async () => {
      mockParent.getState.mockReturnValue(ExecutionState.Stopped);
      mockParent["starting"] = vi.fn().mockResolvedValue(undefined);
      mockParent["reloading"] = vi.fn().mockResolvedValue(undefined);

      const context = createMockContext({ operation: "start" });
      await lifeCycleProcedure.execute(context);

      (lifeCycleProcedure as any)._parent = mockParent;
      (lifeCycleProcedure as any)._events = mockEventEmitter;

      const mockTcpServer = Object.create(TcpServer.prototype);
      Object.assign(mockTcpServer, { start: vi.fn(), stop: vi.fn(), on: vi.fn(), off: vi.fn() });
      mockTasks.set(ProviderTask.ChannelApi, mockTcpServer);

      vi.spyOn(lifeCycleProcedure as any, "_discoverServiceManager").mockResolvedValue(undefined);
      vi.spyOn(lifeCycleProcedure as any, "_startReportSchedule").mockResolvedValue(undefined);
      vi.spyOn(lifeCycleProcedure as any, "_setSystemChannel").mockResolvedValue(mockTcpServer);

      const result = await (lifeCycleProcedure as any)._start();
      expect(result).toBe(true);
      expect(mockParent["starting"]).toHaveBeenCalled();
    });
  });

  describe("_stop", () => {
    it("should return false when parent state is not Running", async () => {
      mockParent.getState.mockReturnValue(ExecutionState.Stopped);
      const context = createMockContext({ operation: "stop" });
      await lifeCycleProcedure.execute(context);

      const result = await (lifeCycleProcedure as any)._stop();
      expect(result).toBe(false);
    });

    it("should stop service from Running state", async () => {
      mockParent.getState.mockReturnValue(ExecutionState.Running);
      mockParent["stopping"] = vi.fn().mockResolvedValue(undefined);

      const mockTask = {
        stop: vi.fn().mockResolvedValue(undefined),
      };
      mockTasks.set(ProviderTask.ChannelApi, mockTask);

      (lifeCycleProcedure as any)._parent = mockParent;
      (lifeCycleProcedure as any)._events = mockEventEmitter;
      (lifeCycleProcedure as any).context = createMockContext({ operation: "stop" });

      vi.spyOn(lifeCycleProcedure as any, "_report").mockResolvedValue(true);

      const result = await (lifeCycleProcedure as any)._stop();
      expect(result).toBe(true);
      expect(mockParent["stopping"]).toHaveBeenCalled();
    });
  });

  describe("_activate", () => {
    it("should return false when parent state is not Halt", async () => {
      mockParent.getState.mockReturnValue(ExecutionState.Running);
      const context = createMockContext({ operation: "activate" });
      await lifeCycleProcedure.execute(context);

      const result = await (lifeCycleProcedure as any)._activate();
      expect(result).toBe(false);
    });

    it("should activate service from Halt state", async () => {
      mockParent.getState.mockReturnValue(ExecutionState.Halt);

      const mockTask = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      };
      mockTasks.set(ProviderTask.ChannelApi, mockTask);

      (lifeCycleProcedure as any)._parent = mockParent;
      (lifeCycleProcedure as any)._events = mockEventEmitter;
      (lifeCycleProcedure as any).context = createMockContext({ operation: "activate" });

      vi.spyOn(lifeCycleProcedure as any, "_report").mockResolvedValue(true);

      const result = await (lifeCycleProcedure as any)._activate();
      expect(result).toBe(true);
      expect(mockTask.start).toHaveBeenCalled();
    });
  });

  describe("_halt", () => {
    it("should return false when parent state is not Running", async () => {
      mockParent.getState.mockReturnValue(ExecutionState.Stopped);
      const context = createMockContext({ operation: "halt" });
      await lifeCycleProcedure.execute(context);

      const result = await (lifeCycleProcedure as any)._halt();
      expect(result).toBe(false);
    });

    it("should halt service from Running state", async () => {
      mockParent.getState.mockReturnValue(ExecutionState.Running);

      const mockTask = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      };
      mockTasks.set(ProviderTask.ChannelApi, mockTask);

      (lifeCycleProcedure as any)._parent = mockParent;
      (lifeCycleProcedure as any)._events = mockEventEmitter;
      (lifeCycleProcedure as any).context = createMockContext({ operation: "halt" });

      vi.spyOn(lifeCycleProcedure as any, "_report").mockResolvedValue(true);

      const result = await (lifeCycleProcedure as any)._halt();
      expect(result).toBe(true);
      expect(mockTask.stop).toHaveBeenCalled();
    });
  });

  describe("_reload", () => {
    it("should reload configuration and call parent reloading", async () => {
      mockParent["reloading"] = vi.fn().mockResolvedValue(undefined);

      (lifeCycleProcedure as any)._parent = mockParent;
      (lifeCycleProcedure as any).context = createMockContext({ operation: "reload" });

      const result = await (lifeCycleProcedure as any)._reload();
      expect(result).toBe(true);
      expect(mockConfigManager.reload).toHaveBeenCalled();
      expect(mockParent["_setConfigManager"]).toHaveBeenCalledWith(mockConfigManager);
      expect(mockParent["reloading"]).toHaveBeenCalled();
    });
  });

  describe("_shutdown", () => {
    it("should shutdown service completely", async () => {
      mockParent.getState.mockReturnValue(ExecutionState.Running);
      mockParent["stopping"] = vi.fn().mockResolvedValue(undefined);
      mockParent["releasingResources"] = vi.fn().mockResolvedValue(undefined);

      const mockTask = {
        stop: vi.fn().mockResolvedValue(undefined),
      };
      mockTasks.set(ProviderTask.ChannelApi, mockTask);

      (lifeCycleProcedure as any)._parent = mockParent;
      (lifeCycleProcedure as any)._events = mockEventEmitter;
      (lifeCycleProcedure as any).context = createMockContext({ operation: "shutdown" });

      vi.spyOn(lifeCycleProcedure as any, "_stop").mockResolvedValue(true);
      vi.spyOn(lifeCycleProcedure as any, "_stopReportSchedule").mockResolvedValue(undefined);
      vi.spyOn(lifeCycleProcedure as any, "_stopManagerTask").mockResolvedValue(undefined);
      vi.spyOn(lifeCycleProcedure as any, "_setSystemChannel").mockResolvedValue({} as TcpServer);

      const result = await (lifeCycleProcedure as any)._shutdown();
      expect(result).toBe(true);
    });
  });

  describe("_restart", () => {
    it("should restart service by stopping, reloading, and starting", async () => {
      mockParent.getState.mockReturnValue(ExecutionState.Running);
      mockParent["starting"] = vi.fn().mockResolvedValue(undefined);
      mockParent["stopping"] = vi.fn().mockResolvedValue(undefined);
      mockParent["releasingResources"] = vi.fn().mockResolvedValue(undefined);
      mockParent["reloading"] = vi.fn().mockResolvedValue(undefined);

      const mockTask = {
        stop: vi.fn().mockResolvedValue(undefined),
        start: vi.fn().mockResolvedValue(undefined),
      };
      mockTasks.set(ProviderTask.ChannelApi, mockTask);

      (lifeCycleProcedure as any)._parent = mockParent;
      (lifeCycleProcedure as any)._events = mockEventEmitter;
      (lifeCycleProcedure as any).context = createMockContext({ operation: "restart" });

      vi.spyOn(lifeCycleProcedure as any, "_stop").mockResolvedValue(true);
      vi.spyOn(lifeCycleProcedure as any, "_releaseResources").mockResolvedValue(undefined);
      vi.spyOn(lifeCycleProcedure as any, "_reload").mockResolvedValue(true);
      vi.spyOn(lifeCycleProcedure as any, "_start").mockResolvedValue(true);

      const result = await (lifeCycleProcedure as any)._restart();
      expect(result).toBe(true);
    });
  });

  describe("_report", () => {
    it("should report to service manager", async () => {
      (lifeCycleProcedure as any)._manager = {
        manager: { manager: { id: "mgr-1" } },
        managerInfo: [],
        instance: null,
      };

      (lifeCycleProcedure as any)._parent = mockParent;
      (lifeCycleProcedure as any).context = createMockContext({ operation: "report" });

      vi.spyOn(lifeCycleProcedure as any, "_discoverServiceManager").mockResolvedValue(undefined);

      vi.doMock("../../procedure", () => ({
        ReportProcedure: class {
          execute() {
            return Promise.resolve(true);
          }
        },
      }));

      const result = await (lifeCycleProcedure as any)._report();
      expect(result).toBe(true);

      vi.doUnmock("../../procedure");
    });
  });

  describe("_handleTcpSysRequest", () => {
    it("should return early when peer is missing", async () => {
      const context = createMockContext({ operation: "start" });
      await lifeCycleProcedure.execute(context);
      (lifeCycleProcedure as any)._parent = mockParent;

      await (lifeCycleProcedure as any)._handleTcpSysRequest({ peer: null as any, data: "{}" });
      expect(mockLogger.debug).toHaveBeenCalledWith("Incomplete message received.");
    });

    it("should return early when data is missing", async () => {
      const context = createMockContext({ operation: "start" });
      await lifeCycleProcedure.execute(context);
      (lifeCycleProcedure as any)._parent = mockParent;

      await (lifeCycleProcedure as any)._handleTcpSysRequest({ peer: {} as any, data: null as any });
      expect(mockLogger.debug).toHaveBeenCalledWith("Incomplete message received.");
    });

    it("should handle successful TCP request and send response", async () => {
      mockParent.getState.mockReturnValue(ExecutionState.Stopped);
      mockParent["_parseRequest"] = vi.fn().mockReturnValue({
        apiSpec: { request: "any", response: "any", ack: 0 },
        apiName: "start",
      });
      mockParent["_handleRequestError"] = vi.fn().mockReturnValue(AckValue.None);
      mockParent["_updateApiCounter"] = vi.fn();
      mockParent["response"] = vi.fn().mockResolvedValue(undefined);
      mockParent["starting"] = vi.fn().mockResolvedValue(undefined);
      mockParent["reloading"] = vi.fn().mockResolvedValue(undefined);

      vi.spyOn(lifeCycleProcedure as any, "_start").mockResolvedValue(true);
      vi.spyOn(lifeCycleProcedure as any, "_discoverServiceManager").mockResolvedValue(undefined);

      const mockSocket = {};
      const context = createMockContext({ operation: "start" });
      await lifeCycleProcedure.execute(context);
      (lifeCycleProcedure as any)._parent = mockParent;

      const requestData = JSON.stringify({ api: "start", args: {}, msgId: "msg-123" });
      await (lifeCycleProcedure as any)._handleTcpSysRequest({
        peer: { socket: mockSocket } as any,
        data: requestData,
      });

      expect(mockParent["response"]).toHaveBeenCalled();
    });
  });

describe("_setSystemChannel", () => {
    it("should subscribe to data events when subscribe is true", async () => {
      const mockTcpServer = Object.create(TcpServer.prototype);
      Object.assign(mockTcpServer, {
        start: vi.fn(),
        stop: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      });
      mockParent["getTcpServer"] = vi.fn().mockResolvedValue(mockTcpServer);

      (lifeCycleProcedure as any)._parent = mockParent;
      (lifeCycleProcedure as any).context = createMockContext({ operation: "start" });

      await (lifeCycleProcedure as any)._setSystemChannel(true);
      expect(mockTcpServer.on).toHaveBeenCalled();
    });

    it("should unsubscribe from data events when subscribe is false", async () => {
      const mockTcpServer = Object.create(TcpServer.prototype);
      Object.assign(mockTcpServer, {
        start: vi.fn(),
        stop: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      });
      mockParent["getTcpServer"] = vi.fn().mockResolvedValue(mockTcpServer);

      (lifeCycleProcedure as any)._parent = mockParent;
      (lifeCycleProcedure as any).context = createMockContext({ operation: "start" });

      await (lifeCycleProcedure as any)._setSystemChannel(false);
      expect(mockTcpServer.off).toHaveBeenCalled();
    });
  });

  describe("_setManagerChannel", () => {
    it("should subscribe to error events when subscribe is true", async () => {
      const mockManagerTask = Object.create(TcpClient.prototype, {
        stop: { value: vi.fn() },
        off: { value: vi.fn() },
        once: { value: vi.fn() },
        on: { value: vi.fn() },
      });
      mockTasks.set(ProviderTask.Manager, mockManagerTask);

      (lifeCycleProcedure as any).context = createMockContext();

      await (lifeCycleProcedure as any)._setManagerChannel(true);
      expect(mockManagerTask.once).toHaveBeenCalled();
    });

    it("should unsubscribe from error events when subscribe is false", async () => {
      const mockManagerTask = Object.create(TcpClient.prototype, {
        stop: { value: vi.fn() },
        off: { value: vi.fn() },
        once: { value: vi.fn() },
        on: { value: vi.fn() },
      });
      mockTasks.set(ProviderTask.Manager, mockManagerTask);

      (lifeCycleProcedure as any).context = createMockContext();

      await (lifeCycleProcedure as any)._setManagerChannel(false);
      expect(mockManagerTask.off).toHaveBeenCalled();
    });
  });

  describe("_stopManagerTask", () => {
    it("should stop manager task when exists", async () => {
      const mockManagerTask = Object.create(TcpClient.prototype, {
        stop: { value: vi.fn().mockResolvedValue(undefined) },
        off: { value: vi.fn() },
        once: { value: vi.fn() },
        on: { value: vi.fn() },
      });
      mockTasks.set(ProviderTask.Manager, mockManagerTask);

      (lifeCycleProcedure as any).context = createMockContext();

      await (lifeCycleProcedure as any)._stopManagerTask();

      expect(mockManagerTask.off).toHaveBeenCalled();
      expect(mockTasks.has(ProviderTask.Manager)).toBe(false);
    });

    it("should do nothing when manager task does not exist", async () => {
      mockTasks.delete(ProviderTask.Manager);

      (lifeCycleProcedure as any).context = createMockContext();

      await (lifeCycleProcedure as any)._stopManagerTask();

      expect(mockTasks.has(ProviderTask.Manager)).toBe(false);
    });
  });

  describe("_startReportSchedule", () => {
    it("should return early when reporting is disabled", async () => {
      const disabledConfigManager = {
        getCoreConfig: () => ({
          report: { enabled: false },
        }),
        getLogger: () => mockLogger,
        reload: vi.fn(),
      };

      (lifeCycleProcedure as any).configManager = disabledConfigManager;
      (lifeCycleProcedure as any)._reportTimer = null;
      (lifeCycleProcedure as any).context = createMockContext({ operation: "start" });

      await (lifeCycleProcedure as any)._startReportSchedule();
      expect(mockLogger.info).toHaveBeenCalledWith("Automatic reporting is disabled.");
    });

    it("should return early when no ServiceManager is found for report", async () => {
      const noSmConfigManager = {
        getCoreConfig: () => ({
          report: { enabled: true, interval: 60 * 1000 },
        }),
        getLogger: () => mockLogger,
        reload: vi.fn(),
      };

      const mockBadTask = {
        stop: vi.fn(),
      };
      mockTasks.set(ProviderTask.Manager, mockBadTask);

      (lifeCycleProcedure as any).configManager = noSmConfigManager;
      (lifeCycleProcedure as any)._reportTimer = null;
      (lifeCycleProcedure as any).context = createMockContext({ operation: "start" });

      await (lifeCycleProcedure as any)._startReportSchedule();
      expect(mockLogger.info).toHaveBeenCalledWith("No ServiceManager found for report.");
    });

    it("should start report schedule with valid manager", async () => {
      const enabledConfigManager = {
        getCoreConfig: () => ({
          report: { enabled: true, interval: 1000 },
        }),
        getLogger: () => mockLogger,
        reload: vi.fn(),
      };

      const mockManagerTask = Object.create(TcpClient.prototype, {
        stop: { value: vi.fn() },
        getSocket: { value: () => ({ address: () => ({ port: 8080 }) }) },
      });
      mockTasks.set(ProviderTask.Manager, mockManagerTask);

      (lifeCycleProcedure as any).configManager = enabledConfigManager;
      (lifeCycleProcedure as any)._reportTimer = null;
      (lifeCycleProcedure as any).context = createMockContext({ operation: "start" });

      vi.spyOn(lifeCycleProcedure as any, "_report").mockResolvedValue(true);

      await (lifeCycleProcedure as any)._startReportSchedule();

      expect(mockLogger.info).toHaveBeenCalledWith("Automatic reporting started for reporting every 1 second(s) ...");
      expect((lifeCycleProcedure as any)._reportTimer).not.toBeNull();
    });
  });

  describe("_stopReportSchedule", () => {
    it("should clear the report timer", async () => {
      const existingTimer = setInterval(() => {}, 1000);
      (lifeCycleProcedure as any)._reportTimer = existingTimer;

      await (lifeCycleProcedure as any)._stopReportSchedule();

      expect((lifeCycleProcedure as any)._reportTimer).toBeNull();
      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining("Automatic reporting stopped"));
    });

    it("should do nothing when timer is null", async () => {
      (lifeCycleProcedure as any)._reportTimer = null;

      await (lifeCycleProcedure as any)._stopReportSchedule();

      expect(mockLogger.debug).not.toHaveBeenCalled();
    });
  });

  describe("_releaseResources", () => {
    it("should release all resources", async () => {
      mockParent["releasingResources"] = vi.fn().mockResolvedValue(undefined);
      mockParent["_releaseResponseChannels"] = vi.fn().mockResolvedValue(undefined);
      mockParent["_releaseOtel"] = vi.fn().mockResolvedValue(undefined);

      (lifeCycleProcedure as any)._parent = mockParent;
      (lifeCycleProcedure as any).context = createMockContext();

      await (lifeCycleProcedure as any)._releaseResources();

      expect(mockParent["releasingResources"]).toHaveBeenCalled();
      expect(mockParent["_releaseResponseChannels"]).toHaveBeenCalled();
      expect(mockParent["_releaseOtel"]).toHaveBeenCalled();
      expect(mockParent["_initialized"]).toBe(false);
    });
  });

  describe("Service events", () => {
    it("should emit ServiceStopped event on successful stop", async () => {
      mockParent.getState.mockReturnValue(ExecutionState.Running);
      mockParent["stopping"] = vi.fn().mockResolvedValue(undefined);

      const mockTask = {
        stop: vi.fn().mockResolvedValue(undefined),
      };
      mockTasks.set(ProviderTask.ChannelApi, mockTask);

      (lifeCycleProcedure as any)._parent = mockParent;
      (lifeCycleProcedure as any)._events = mockEventEmitter;
      (lifeCycleProcedure as any).context = createMockContext({ operation: "stop" });

      vi.spyOn(lifeCycleProcedure as any, "_report").mockResolvedValue(true);

      await (lifeCycleProcedure as any)._stop();

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(ServiceEvent.ServiceStopped, mockParent);
    });
  });
});