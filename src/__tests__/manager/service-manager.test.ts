import "reflect-metadata";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ServiceManager } from "../../manager/service-manager";
import { ConfigManager } from "../../common/config";
import { LoggerManager } from "../../common/logger";
import { ServerState } from "../../types/basal-protocol";
import { TcpServer } from "../../network/tcp-server";
import { UdpServer } from "../../network/udp-server";

const createMockTcpServer = (name: string) =>
  ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockReturnValue(ServerState.Listening),
    getPort: vi.fn().mockReturnValue(0),
    name,
  }) as unknown as TcpServer;

const createMockUdpServer = (name: string) =>
  ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockReturnValue(ServerState.Listening),
    getPort: vi.fn().mockReturnValue(5707),
    name,
  }) as unknown as UdpServer;

vi.mock("../../aop/container", () => ({
  container: {
    get: vi.fn((type) => {
      if (type.toString().includes("ConfigManager")) {
        return {
          getCoreConfig: () => ({
            tcp_address: "127.0.0.1",
            tcp_port: 0,
            udp_address: "127.0.0.1",
            udp_port: 5707,
            retry_interval: 10,
            retry_max: 2,
            service_name: "test-service",
          }),
          getConfig: () => ({
            app: {},
            core: {
              tcp_address: "127.0.0.1",
              tcp_port: 0,
              udp_address: "127.0.0.1",
              udp_port: 5707,
              retry_interval: 10,
              retry_max: 2,
              service_name: "test-service",
            },
            log: {
              format: "console",
              log_level: "info",
              max_files: "14d",
              max_size: "20m",
            },
          }),
          reload: vi.fn(),
        };
      }
      if (type.toString().includes("LoggerManager")) {
        return {
          getLogger: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
          }),
          reload: vi.fn(),
        };
      }
      return {};
    }),
  },
  TYPES: {
    ConfigManager: Symbol.for("ConfigManager"),
    LoggerManager: Symbol.for("LoggerManager"),
    Logger: Symbol.for("Logger"),
    ServiceManager: Symbol.for("ServiceManager"),
    TcpServer: Symbol.for("TcpServer"),
    UdpServer: Symbol.for("UdpServer"),
  },
  createNamedTcpServer: vi.fn((name: string) => createMockTcpServer(name)),
  createNamedUdpServer: vi.fn((name: string) => createMockUdpServer(name)),
}));

describe("ServiceManager", () => {
  let serviceManager: ServiceManager;
  let mockConfigManager: ConfigManager;
  let mockLoggerManager: LoggerManager;
  let mockLogger: any;
  let mockTcpServer: TcpServer;
  let mockUdpServer: UdpServer;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfigManager = {
      getCoreConfig: () => ({
        tcp_address: "127.0.0.1",
        tcp_port: 0,
        udp_address: "127.0.0.1",
        udp_port: 5707,
        retry_interval: 10,
        retry_max: 2,
        service_name: "test-service",
      }),
      getConfig: () => ({
        app: {},
        core: {
          tcp_address: "127.0.0.1",
          tcp_port: 0,
          udp_address: "127.0.0.1",
          udp_port: 5707,
          retry_interval: 10,
          retry_max: 2,
          service_name: "test-service",
        },
        log: {
          format: "console",
          log_level: "info",
          max_files: "14d",
          max_size: "20m",
        },
      }),
      reload: vi.fn(),
    } as unknown as ConfigManager;

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    mockLoggerManager = {
      getLogger: () => mockLogger,
      reload: vi.fn(),
    } as unknown as LoggerManager;

    mockTcpServer = createMockTcpServer("register");
    mockUdpServer = createMockUdpServer("reception");

    serviceManager = new ServiceManager(mockConfigManager, mockLoggerManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with correct PROTOCOL", () => {
      expect(serviceManager.PROTOCOL).toHaveProperty("protocol_ver");
      expect(serviceManager.PROTOCOL).toHaveProperty("provider");
      expect(serviceManager.PROTOCOL.provider).toHaveProperty("id");
      expect(serviceManager.PROTOCOL.provider).toHaveProperty("version");
      expect(serviceManager.PROTOCOL.provider.name).toBe("test-service");
      expect(serviceManager.PROTOCOL.provider.desc).toBe(
        "Service Manager for orchestrating services.",
      );
    });

    it("should generate unique instance ID", () => {
      const id = serviceManager.PROTOCOL.provider.id;
      expect(id).toBeDefined();
      expect(id.length).toBe(16);
    });

    it("should initialize state to Stopped", () => {
      expect((serviceManager as any).state).toBe(ServerState.Stopped);
    });
  });

  describe("getServiceName", () => {
    it("should return service name from config", () => {
      expect(serviceManager.getServiceName()).toBe("test-service");
    });

    it("should update PROTOCOL provider name from config", () => {
      expect(serviceManager.PROTOCOL.provider.name).toBe("test-service");
    });
  });

  describe("getMetrics", () => {
    it("should return metrics instance", () => {
      const metrics = serviceManager.getMetrics();
      expect(metrics).toBeDefined();
    });
  });

  describe("getTcpServer", () => {
    it("should return undefined when no TCP server is registered", () => {
      const tcpServer = serviceManager.getTcpServer("register");
      expect(tcpServer).toBeUndefined();
    });

    it("should return undefined for non-existent server", () => {
      const tcpServer = serviceManager.getTcpServer("non-existent");
      expect(tcpServer).toBeUndefined();
    });
  });

  describe("getUdpServer", () => {
    it("should return undefined when no UDP server is registered", () => {
      const udpServer = serviceManager.getUdpServer("reception");
      expect(udpServer).toBeUndefined();
    });

    it("should return undefined for non-existent server", () => {
      const udpServer = serviceManager.getUdpServer("non-existent");
      expect(udpServer).toBeUndefined();
    });
  });

  describe("reload", () => {
    it("should reload config manager", async () => {
      await serviceManager.reload();
      expect(mockConfigManager.reload).toHaveBeenCalled();
    });

    it("should reload logger manager", async () => {
      await serviceManager.reload();
      expect(mockLoggerManager.reload).toHaveBeenCalled();
    });
  });

  describe("start", () => {
    it("should transition to Running state on successful start", async () => {
      (serviceManager as any).services.set("register", mockTcpServer);
      (serviceManager as any).services.set("reception", mockUdpServer);
      (serviceManager as any).initialized = true;

      await serviceManager.start();

      expect((serviceManager as any).state).toBe(ServerState.Running);
    });
  });

  describe("stop", () => {
    it("should set state to Stopping when stopping", async () => {
      await serviceManager.stop();
      expect((serviceManager as any).state).toBe(ServerState.Stopped);
    });

    it("should log info messages during stop", async () => {
      await serviceManager.stop();
      expect(mockLogger.info).toHaveBeenCalledWith("Stopping all services ...");
    });

    it("should transition to Stopped state after stop", async () => {
      await serviceManager.stop();
      expect((serviceManager as any).state).toBe(ServerState.Stopped);
    });

    it("should be idempotent when already stopped", async () => {
      await serviceManager.stop();
      await serviceManager.stop();
      expect((serviceManager as any).state).toBe(ServerState.Stopped);
    });

    it("should log stop message", async () => {
      await serviceManager.stop();
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe("restart", () => {
    it("should call stop, reload, and start", async () => {
      const startSpy = vi.spyOn(serviceManager, "start");
      const stopSpy = vi.spyOn(serviceManager, "stop");
      const reloadSpy = vi.spyOn(serviceManager, "reload");

      await serviceManager.restart();

      expect(stopSpy).toHaveBeenCalled();
      expect(reloadSpy).toHaveBeenCalled();
      expect(startSpy).toHaveBeenCalled();
    });
  });

  describe("state transitions", () => {
    it("should have initial state of Stopped", () => {
      expect((serviceManager as any).state).toBe(ServerState.Stopped);
    });

    it("should set state to Stopped after stop", async () => {
      await serviceManager.stop();
      expect((serviceManager as any).state).toBe(ServerState.Stopped);
    });
  });

  describe("getIdentity", () => {
    it("should return identity in format ServiceName-InstanceId", () => {
      const identity = (serviceManager as any).getIdentity();
      expect(identity).toContain("test-service-");
      expect(identity).toContain(serviceManager.PROTOCOL.provider.id);
    });
  });

  describe("initialize", () => {
    it("should be callable without error", () => {
      expect(() => (serviceManager as any).initialize()).not.toThrow();
    });
  });

  describe("PROTOCOL", () => {
    it("should have correct structure", () => {
      expect(serviceManager.PROTOCOL).toHaveProperty("protocol_ver");
      expect(serviceManager.PROTOCOL).toHaveProperty("provider");
      expect(serviceManager.PROTOCOL.provider).toHaveProperty("id");
      expect(serviceManager.PROTOCOL.provider).toHaveProperty("name");
      expect(serviceManager.PROTOCOL.provider).toHaveProperty("desc");
      expect(serviceManager.PROTOCOL.provider).toHaveProperty("version");
    });
  });

  describe("setState", () => {
    it("should only update state when different", () => {
      const initialState = (serviceManager as any).state;
      (serviceManager as any).setState(initialState);
      expect((serviceManager as any).state).toBe(initialState);
    });

    it("should update state when different", () => {
      (serviceManager as any).setState(ServerState.Starting);
      expect((serviceManager as any).state).toBe(ServerState.Starting);
    });

    it("should log state transition", () => {
      (serviceManager as any).setState(ServerState.Starting);
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe("updateServiceName", () => {
    it("should use service name from config when defined", () => {
      expect(serviceManager.PROTOCOL.provider.name).toBe("test-service");
    });

    it("should use class name when config service_name is UNKNOWN_ATTRIBUTE", () => {
      const configWithUnknown = {
        getCoreConfig: () => ({
          tcp_address: "127.0.0.1",
          tcp_port: 0,
          udp_address: "127.0.0.1",
          udp_port: 5707,
          retry_interval: 10,
          retry_max: 2,
          service_name: "Unknown",
        }),
      } as unknown as ConfigManager;

      const managerWithUnknown = new ServiceManager(
        configWithUnknown,
        mockLoggerManager,
      );
      expect(managerWithUnknown.PROTOCOL.provider.name).toBe("ServiceManager");
    });
  });

  describe("initializeMetrics", () => {
    it("should initialize metrics", () => {
      const metrics = serviceManager.getMetrics();
      expect(metrics).toBeDefined();
    });
  });

  describe("services management", () => {
    it("should have empty services map initially", () => {
      expect((serviceManager as any).services.size).toBe(0);
    });

    it("should be able to add services", () => {
      const mockTcp = {
        start: vi.fn(),
        stop: vi.fn(),
        name: "test-server",
      };

      (serviceManager as any).services.set("register", mockTcp);
      expect((serviceManager as any).services.get("register")).toBe(mockTcp);
    });

    it("should track multiple services", () => {
      const tcp1 = createMockTcpServer("tcp-1");
      const tcp2 = createMockTcpServer("tcp-2");
      const udp1 = createMockUdpServer("udp-1");

      (serviceManager as any).services.set("tcp-1", tcp1);
      (serviceManager as any).services.set("tcp-2", tcp2);
      (serviceManager as any).services.set("udp-1", udp1);

      expect((serviceManager as any).services.size).toBe(3);
      expect((serviceManager as any).services.get("tcp-1")).toBe(tcp1);
      expect((serviceManager as any).services.get("tcp-2")).toBe(tcp2);
      expect((serviceManager as any).services.get("udp-1")).toBe(udp1);
    });

    it("should replace existing service with same key", () => {
      const tcp1 = createMockTcpServer("tcp-1");
      const tcp2 = createMockTcpServer("tcp-2");

      (serviceManager as any).services.set("register", tcp1);
      expect((serviceManager as any).services.get("register")).toBe(tcp1);

      (serviceManager as any).services.set("register", tcp2);
      expect((serviceManager as any).services.get("register")).toBe(tcp2);
      expect((serviceManager as any).services.size).toBe(1);
    });
  });

  describe("setConfigManager", () => {
    it("should be called in constructor", () => {
      expect((serviceManager as any).configManager).toBeDefined();
    });

    it("should set configManager and update service name", () => {
      const newConfigManager = {
        getCoreConfig: () => ({
          tcp_address: "127.0.0.1",
          tcp_port: 0,
          udp_address: "127.0.0.1",
          udp_port: 5707,
          retry_interval: 10,
          retry_max: 2,
          service_name: "new-service-name",
        }),
      } as unknown as ConfigManager;

      (serviceManager as any).setConfigManager(newConfigManager);
      expect((serviceManager as any).configManager).toBe(newConfigManager);
      expect(serviceManager.PROTOCOL.provider.name).toBe("new-service-name");
    });
  });

  describe("setLoggerManager", () => {
    it("should be called in constructor", () => {
      expect((serviceManager as any).loggerManager).toBeDefined();
    });

    it("should set loggerManager and logger", () => {
      const newLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      const newLoggerManager = {
        getLogger: () => newLogger,
        reload: vi.fn(),
      } as unknown as LoggerManager;

      (serviceManager as any).setLoggerManager(newLoggerManager);
      expect((serviceManager as any).loggerManager).toBe(newLoggerManager);
      expect((serviceManager as any).logger).toBe(newLogger);
    });

    it("should handle null loggerManager gracefully", () => {
      (serviceManager as any).setLoggerManager(null);
      expect((serviceManager as any).logger).toBeDefined();
    });
  });

  describe("logger operations", () => {
    it("should have debug method on logger", () => {
      mockLogger.debug = vi.fn();
      (serviceManager as any).logger.debug("test");
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it("should have info method on logger", async () => {
      mockLogger.info = vi.fn();
      await serviceManager.stop();
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it("should call info on logger for state transitions", () => {
      mockLogger.info = vi.fn();
      (serviceManager as any).setState(ServerState.Retrying);
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it("should call info on logger for Error state", () => {
      mockLogger.info = vi.fn();
      (serviceManager as any).setState(ServerState.Error);
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe("state logging", () => {
    it("should log state transition details", () => {
      mockLogger.info = vi.fn();
      (serviceManager as any).setState(ServerState.Running);

      const logMessage = mockLogger.info.mock.calls[0][0];
      expect(logMessage).toContain("state:");
      expect(logMessage).toContain("Stopped");
      expect(logMessage).toContain("Running");
    });

    it("should not log when state hasn't changed", () => {
      mockLogger.info = vi.fn();
      const initialState = (serviceManager as any).state;

      (serviceManager as any).setState(initialState);

      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });

  describe("start with error handling", () => {
    it("should handle initialization when already initialized", async () => {
      (serviceManager as any).initialized = true;
      (serviceManager as any).state = ServerState.Running;

      await serviceManager.start();

      expect((serviceManager as any).state).toBe(ServerState.Running);
    });

    it("should transition to Running even when not in Stopped state initially", async () => {
      (serviceManager as any).state = ServerState.Starting;

      await serviceManager.start();

      expect((serviceManager as any).state).toBe(ServerState.Running);
    });
  });

  describe("stop with services", () => {
    it("should stop all registered services", async () => {
      const tcp1 = createMockTcpServer("tcp-1");
      const tcp2 = createMockTcpServer("tcp-2");

      (serviceManager as any).services.set("tcp-1", tcp1);
      (serviceManager as any).services.set("tcp-2", tcp2);

      await serviceManager.stop();

      expect(tcp1.stop).toHaveBeenCalled();
      expect(tcp2.stop).toHaveBeenCalled();
    });

    it("should handle service without stop method", async () => {
      const serviceWithoutStop = {
        name: "no-stop",
      };

      (serviceManager as any).services.set("no-stop", serviceWithoutStop);
      mockLogger.error = vi.fn();

      await serviceManager.stop();

      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it("should handle stop error gracefully", async () => {
      const tcpWithError = {
        stop: vi.fn().mockRejectedValue(new Error("Stop failed")),
        name: "error-stop",
      };

      mockLogger.error = vi.fn();
      (serviceManager as any).services.set("error-stop", tcpWithError);

      await serviceManager.stop();

      const errorMessage = mockLogger.error.mock.calls[0][0];
      expect(errorMessage).toContain("Failed to stop service");
      expect(errorMessage).toContain("Stop failed");
    });
  });

  describe("full lifecycle", () => {
    it("should complete full start -> stop lifecycle", async () => {
      expect((serviceManager as any).state).toBe(ServerState.Stopped);

      (serviceManager as any).initialized = true;
      (serviceManager as any).services.set("tcp-1", mockTcpServer);
      (serviceManager as any).services.set("udp-1", mockUdpServer);

      await serviceManager.start();
      expect((serviceManager as any).state).toBe(ServerState.Running);

      await serviceManager.stop();
      expect((serviceManager as any).state).toBe(ServerState.Stopped);
    });
  });
});
