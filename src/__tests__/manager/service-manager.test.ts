import "reflect-metadata";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConfigManager, DEFAULT_DISCOVERY_PORT } from "../../common/config";
import { LoggerManager } from "../../common/logger";
import {
  ServerState,
  IdGenerator,
  ExecutionState,
  ReportData,
} from "../../types/basal-protocol";
import { TYPES } from "../../aop/di-types";
import { BroadcastUdpServer } from "../../network/broadcast-udp-server";
import { ServiceManager } from "../../manager/service-manager";
import { TcpServer } from "../../network/tcp-server";
import { UdpServer } from "../../network/udp-server";

vi.mock("../../aop/container", () => ({
  container: {
    get: vi.fn(),
  },
  TYPES,
  createNamedTcpServer: vi.fn(),
  createNamedUdpServer: vi.fn((name: string) => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockReturnValue(ServerState.Listening),
    getPort: vi.fn().mockReturnValue(DEFAULT_DISCOVERY_PORT),
    setManagerInfo: vi.fn(),
    name,
  })),
}));

const createMockIdGenerator = (): IdGenerator => ({
  generate: vi.fn().mockReturnValue("mock-uuid-1234"),
  shortId: vi.fn().mockReturnValue("mockinstance01"),
});

const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  silly: vi.fn(),
});

const createMockTcpServer = (name: string) =>
  ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockReturnValue("Listening" as any),
    getPort: vi.fn().mockReturnValue(0),
    getServer: vi.fn().mockReturnValue({
      address: () => ({ port: 8080, address: "127.0.0.1" }),
    }),
    name,
  }) as unknown as TcpServer;

const createMockUdpServer = (name: string) =>
  ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockReturnValue("Listening" as any),
    getPort: vi.fn().mockReturnValue(DEFAULT_DISCOVERY_PORT),
    setManagerInfo: vi.fn(),
    name,
  }) as unknown as BroadcastUdpServer;

describe("ServiceManager", () => {
  let serviceManager: ServiceManager;
  let mockIdGenerator: IdGenerator;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockConfigManager: ConfigManager;
  let mockLoggerManager: LoggerManager;
  let mockNetConfig: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockIdGenerator = createMockIdGenerator();
    mockLogger = createMockLogger();

    mockNetConfig = {
      tcp_address: "127.0.0.1",
      tcp_port: 0,
      udp_address: "127.0.0.1",
      udp_port: DEFAULT_DISCOVERY_PORT,
      sm_discovery: Symbol.for("UdpDiscovery"),
    };

    mockConfigManager = {
      getCoreConfig: () => ({
        net: mockNetConfig,
        retry: {
          interval: 10,
          max_try: 2,
          backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
        },
        service_name: "test-service",
      }),
      getConfig: () => ({
        app: {},
        core: {
          net: {
            tcp_address: "127.0.0.1",
            tcp_port: 0,
            udp_address: "127.0.0.1",
            udp_port: DEFAULT_DISCOVERY_PORT,
          },
          retry: {
            interval: 10,
            max_try: 2,
            backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
          },
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
      getLogger: () => mockLogger,
    } as unknown as ConfigManager;

    mockLoggerManager = {
      getLogger: () => mockLogger,
      reload: vi.fn(),
    } as unknown as LoggerManager;

    serviceManager = new ServiceManager(mockIdGenerator);
    (serviceManager as any)._setConfigManager(mockConfigManager);
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

    it("should generate instance ID from idGenerator", () => {
      const id = serviceManager.PROTOCOL.provider.id;
      expect(id).toBeDefined();
      expect(mockIdGenerator.shortId).toHaveBeenCalled();
    });

    it("should initialize with protocol_ver 260321", () => {
      expect(serviceManager.PROTOCOL.protocol_ver).toBe("260321");
    });

    it("should have register and report APIs", () => {
      expect(serviceManager.PROTOCOL.apis).toHaveProperty("register");
      expect(serviceManager.PROTOCOL.apis).toHaveProperty("report");
      expect(serviceManager.PROTOCOL.apis).toHaveProperty("reception");
    });
  });

  describe("getServiceName", () => {
    it("should return service name from PROTOCOL", () => {
      expect(serviceManager.getServiceName()).toBe("test-service");
    });
  });

  

  describe("clearReports", () => {
    it("should do nothing when service has no reports", () => {
      expect(() =>
        serviceManager.clearReports({ service: "svc", instance: "inst" }),
      ).not.toThrow();
    });

    it("should clear reports for specific peer", () => {
      const peer = { service: "TestService", instance: "inst-1" };
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

    it("should handle clearing reports for non-existent service", () => {
      expect(() =>
        serviceManager.clearReports({ service: "none", instance: "none" }),
      ).not.toThrow();
    });
  });

  describe("getReports", () => {
    it("should return empty array when no reports exist", () => {
      const reports = serviceManager.getReports({
        service: "none",
        instance: "none",
      });
      expect(reports).toEqual([]);
    });

    it("should return reports for specific peer", () => {
      const peer = { service: "TestService", instance: "inst-1" };
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

      const reports = serviceManager.getReports(peer);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toBe(reportData);
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

    it("should return latest report", () => {
      const peer = { service: "TestService", instance: "inst-1" };
      const report1: ReportData = {
        timestamp: Date.now() - 1000,
        state: ExecutionState.Running,
        ramUsed: 256,
        ramFree: 1024,
        cpuLoad: 30,
        netTx: "512 KB",
        netTxBytes: 524288,
        netRx: "1.00 MB",
        netRxBytes: 1048576,
      };
      const report2: ReportData = {
        timestamp: Date.now(),
        state: ExecutionState.Running,
        ramUsed: 512,
        ramFree: 2048,
        cpuLoad: 45,
        netTx: "1.00 MB",
        netTxBytes: 1048576,
        netRx: "2.00 MB",
        netRxBytes: 2097152,
      };

      serviceManager.gotReport({
        peer,
        api: "report",
        args: report1,
        msgId: "msg-1",
      });
      serviceManager.gotReport({
        peer,
        api: "report",
        args: report2,
        msgId: "msg-2",
      });

      const latest = serviceManager.getLatestReport(peer);
      expect(latest).toBe(report2);
    });
  });

  describe("getReportedInstances", () => {
    it("should return empty array when no instances reported", () => {
      const instances = serviceManager.getReportedInstances();
      expect(instances).toEqual([]);
    });

    it("should return all reported instances", () => {
      const peer1 = { service: "ServiceA", instance: "inst-1" };
      const peer2 = { service: "ServiceB", instance: "inst-2" };
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
        peer: peer1,
        api: "report",
        args: reportData,
        msgId: "msg-1",
      });
      serviceManager.gotReport({
        peer: peer2,
        api: "report",
        args: reportData,
        msgId: "msg-2",
      });

      const instances = serviceManager.getReportedInstances();
      expect(instances).toHaveLength(2);
      expect(instances).toContainEqual(peer1);
      expect(instances).toContainEqual(peer2);
    });
  });

  describe("gotReport", () => {
    it("should warn on invalid report data", async () => {
      await serviceManager.gotReport({
        peer: { service: "Test", instance: "inst" },
        api: "report",
        args: undefined,
        msgId: "msg-1",
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Invalid report data"),
      );
    });

    it("should store valid report data", async () => {
      const peer = { service: "TestService", instance: "inst-1" };
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

    it("should limit stored reports to 60", async () => {
      const peer = { service: "TestService", instance: "inst-1" };
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

      for (let i = 0; i < 65; i++) {
        await serviceManager.gotReport({
          peer,
          api: "report",
          args: { ...reportData, timestamp: Date.now() + i },
          msgId: `msg-${i}`,
        });
      }

      const reports = serviceManager.getReports(peer);
      expect(reports.length).toBe(60);
    });
  });

  

  describe("state management", () => {
    it("should report state via getState", () => {
      expect(serviceManager.getState()).toBeDefined();
    });
  });

  

  describe("registrar", () => {
    it("should register a provider and log", async () => {
      const data = {
        peer: { service: "TestService", instance: "inst-1" },
        api: "register",
        args: {
          provider: { name: "TestService", id: "inst-1" },
        },
        msgId: "msg-1",
      };

      await serviceManager.registrar(data);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("registered"),
      );
    });
  });

  describe("buildAccessPointInfo", () => {
    it("should add api routes to baseInfo", () => {
      const baseInfo = { address: "127.0.0.1", port: 8080 };
      const result = serviceManager.buildAccessPointInfo(baseInfo as any);
      expect(result.api).toContain("register");
      expect(result.api).toContain("report");
    });
  });

  describe("reloading", () => {
    it("should disable service manager discovery", async () => {
      await serviceManager.reloading();
      expect(mockNetConfig.sm_discovery).toBe(Symbol.for("None"));
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("disabled"),
      );
    });
  });

  describe("starting", () => {
    it("should call setApiChannel and _initializeBroadcastListener", async () => {
      vi.spyOn(serviceManager as any, "setApiChannel").mockResolvedValue({
        start: vi.fn(),
      } as any);
      vi.spyOn(
        serviceManager as any,
        "_initializeBroadcastListener",
      ).mockResolvedValue(undefined);

      await serviceManager.starting();

      expect(serviceManager["setApiChannel"]).toHaveBeenCalledWith(true);
      expect(
        serviceManager["_initializeBroadcastListener"],
      ).toHaveBeenCalledWith("reception");
    });
  });

  describe("stopping", () => {
    it("should call setApiChannel with false", async () => {
      vi.spyOn(serviceManager as any, "setApiChannel").mockResolvedValue({
        stop: vi.fn(),
      } as any);

      await serviceManager.stopping();

      expect(serviceManager["setApiChannel"]).toHaveBeenCalledWith(false);
    });
  });
});
