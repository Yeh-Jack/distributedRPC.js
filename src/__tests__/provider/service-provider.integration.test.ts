import * as net from "net";
import * as dgram from "dgram";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ServiceManager } from "../../manager/service-manager";
import { ServiceProvider } from "../../provider/service-provider";
import {
  AccessPoint,
  ExecutionState,
  NetworkProtocol,
} from "../../types/basal-protocol";
import { DefaultIdGenerator } from "../../common/id-generator";

vi.mock("../../metrics/otel-tracing", () => ({
  OtelTracer: {
    getInstance: () => ({
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
    }),
  },
  generateCorrelationId: () => "test-correlation-id",
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

const mockIdGenerator = new DefaultIdGenerator();

interface TestServiceProviderConfig {
  smDiscovery?: string;
  udpPort?: number;
  tcpPort?: number;
  providerId?: string;
  serviceName?: string;
}

class TestServiceProvider extends ServiceProvider {
  constructor(config: TestServiceProviderConfig) {
    const idGenerator = mockIdGenerator;
    super(idGenerator);

    const configManager = {
      getCoreConfig: () => ({
        net: {
          tcp: {
            address: "127.0.0.1",
            port: config.tcpPort || 0,
            client: {
              timeout: 5000,
              keep_alive: false,
              keep_alive_initial_delay: 0,
            },
          },
          udp: {
            address: "127.0.0.1",
            port: config.udpPort || 0,
          },
          sm_discovery: config.smDiscovery || "UDP",
        },
        retry: {
          interval: 100,
          max_try: 3,
          backoff: { enable: true, max_delay: 1000, multiplier: 1.5 },
        },
        report: {
          enabled: false,
        },
        provider_id: config.providerId || "test-provider-01",
        service_name: config.serviceName || "TestServiceProvider",
      }),
      getAppConfig: () => ({ redis: {} }),
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        silly: vi.fn(),
      }),
      getProviderId: () => config.providerId || "test-provider-01",
      reload: vi.fn(),
    };

    (this as any)._setConfigManager(configManager);
  }

  protected override async starting(): Promise<void> {}

  protected override async stopping(): Promise<void> {}

  protected override buildAccessPointInfo(baseInfo: AccessPoint): AccessPoint {
    return {
      ...baseInfo,
      authorization: "test-auth",
      function: ["testFunction"],
    };
  }

  protected override async initializingResources(): Promise<void> {}
}

interface ServiceManagerConfigOptions {
  udpPort?: number;
  tcpPort?: number;
  providerId?: string;
  serviceName?: string;
  smDiscovery?: string;
}

function createServiceManagerConfig(options: ServiceManagerConfigOptions = {}) {
  return {
    getCoreConfig: () => ({
      net: {
        tcp: {
          address: "127.0.0.1",
          port: options.tcpPort || 0,
          client: {
            timeout: 5000,
            keep_alive: false,
            keep_alive_initial_delay: 0,
          },
        },
        udp: {
          address: "127.0.0.1",
          port: options.udpPort || 0,
        },
        sm_discovery: options.smDiscovery || "None",
      },
      retry: {
        interval: 100,
        max_try: 3,
        backoff: { enable: true, max_delay: 1000, multiplier: 1.5 },
      },
      report: {
        enabled: false,
      },
      provider_id: options.providerId || "sm-instance-01",
      service_name: options.serviceName || "ServiceManager",
    }),
    getAppConfig: () => ({ redis: {} }),
    getLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      silly: vi.fn(),
    }),
    getProviderId: () => options.providerId || "sm-instance-01",
    reload: vi.fn(),
  };
}

describe("ServiceProvider Integration with Real ServiceManager", () => {
  let serviceManager: ServiceManager;
  let serviceProvider: TestServiceProvider;
  let mockUdpServer: dgram.Socket | null = null;
  let mockTcpServer: net.Server | null = null;
  let assignedUdpPort: number = 0;
  let assignedTcpPort: number = 0;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockUdpServer = dgram.createSocket("udp4");
    mockTcpServer = net.createServer();

    await new Promise<void>((resolve) => {
      mockUdpServer!.bind(0, "127.0.0.1", () => {
        const addr = mockUdpServer!.address();
        if (typeof addr !== "string") {
          assignedUdpPort = addr.port;
        }
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      mockTcpServer!.listen(0, "127.0.0.1", () => {
        const addr = mockTcpServer!.address();
        if (addr && typeof addr !== "string") {
          assignedTcpPort = addr.port;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (serviceManager) {
      try {
        await serviceManager.shutdown();
      } catch {}
    }

    if (serviceProvider) {
      try {
        await serviceProvider.shutdown();
      } catch {}
    }

    if (mockUdpServer) {
      await new Promise<void>((resolve) => {
        mockUdpServer!.close(() => resolve());
      });
      mockUdpServer = null;
    }

    if (mockTcpServer) {
      await new Promise<void>((resolve) => {
        mockTcpServer!.close(() => resolve());
      });
      mockTcpServer = null;
    }
  });

  describe("ServiceProvider and ServiceManager creation", () => {
    it("should create ServiceProvider and ServiceManager instances", () => {
      const smConfig = createServiceManagerConfig({
        udpPort: assignedUdpPort,
        tcpPort: assignedTcpPort,
      });
      serviceManager = new ServiceManager(mockIdGenerator);
      (serviceManager as any)._setConfigManager(smConfig);

      expect(serviceManager).toBeDefined();
      expect(serviceManager.getState()).toBe(ExecutionState.Stopped);

      serviceProvider = new TestServiceProvider({
        udpPort: assignedUdpPort,
        tcpPort: assignedTcpPort,
        smDiscovery: "None",
      });
      expect(serviceProvider).toBeDefined();
    });

    it("should have correct initial states", () => {
      const smConfig = createServiceManagerConfig({
        udpPort: assignedUdpPort,
        tcpPort: assignedTcpPort,
      });
      serviceManager = new ServiceManager(mockIdGenerator);
      (serviceManager as any)._setConfigManager(smConfig);

      expect(serviceManager.getState()).toBe(ExecutionState.Stopped);
    });

    it("should get protocol information from ServiceManager", async () => {
      const smConfig = createServiceManagerConfig({
        udpPort: assignedUdpPort,
        tcpPort: assignedTcpPort,
      });
      serviceManager = new ServiceManager(mockIdGenerator);
      (serviceManager as any)._setConfigManager(smConfig);

      const protocol = await serviceManager.getProtocol();
      expect(typeof protocol).toBe("string");
    });

    it("should get identity", () => {
      serviceProvider = new TestServiceProvider({
        udpPort: assignedUdpPort,
        tcpPort: assignedTcpPort,
        smDiscovery: "None",
        serviceName: "MyTestProvider",
      });

      const identity = (serviceProvider as any).getIdentity();
      expect(identity).toContain("MyTestProvider");
    });

    it("should get protocol from ServiceProvider", async () => {
      serviceProvider = new TestServiceProvider({
        udpPort: assignedUdpPort,
        tcpPort: assignedTcpPort,
        smDiscovery: "None",
      });

      const protocol = await serviceProvider.getProtocol();
      expect(typeof protocol).toBe("string");
    });
  });

  describe("ServiceProvider report handling via ServiceManager", () => {
    it("should store report data via gotReport", async () => {
      const smConfig = createServiceManagerConfig({
        udpPort: assignedUdpPort,
        tcpPort: assignedTcpPort,
        smDiscovery: "None",
      });
      serviceManager = new ServiceManager(mockIdGenerator);
      (serviceManager as any)._setConfigManager(smConfig);

      const peer = { service: "TestProvider", instance: "inst-1" };
      const reportData = {
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

    it("should clear reports for specific peer", () => {
      const smConfig = createServiceManagerConfig({
        udpPort: assignedUdpPort,
        tcpPort: assignedTcpPort,
        smDiscovery: "None",
      });
      serviceManager = new ServiceManager(mockIdGenerator);
      (serviceManager as any)._setConfigManager(smConfig);

      const peer = { service: "TestProvider", instance: "inst-1" };
      const reportData = {
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

    it("should return undefined when no reports exist", () => {
      const smConfig = createServiceManagerConfig({
        udpPort: assignedUdpPort,
        tcpPort: assignedTcpPort,
        smDiscovery: "None",
      });
      serviceManager = new ServiceManager(mockIdGenerator);
      (serviceManager as any)._setConfigManager(smConfig);

      const latest = serviceManager.getLatestReport({
        service: "none",
        instance: "none",
      });
      expect(latest).toBeUndefined();
    });

    it("should return empty array when no instances reported", () => {
      const smConfig = createServiceManagerConfig({
        udpPort: assignedUdpPort,
        tcpPort: assignedTcpPort,
        smDiscovery: "None",
      });
      serviceManager = new ServiceManager(mockIdGenerator);
      (serviceManager as any)._setConfigManager(smConfig);

      const instances = serviceManager.getReportedInstances();
      expect(instances).toEqual([]);
    });

    it("should warn on invalid report data", async () => {
      const smConfig = createServiceManagerConfig({
        udpPort: assignedUdpPort,
        tcpPort: assignedTcpPort,
        smDiscovery: "None",
      });
      serviceManager = new ServiceManager(mockIdGenerator);
      (serviceManager as any)._setConfigManager(smConfig);

      const logger = (serviceManager as any).logger;
      await serviceManager.gotReport({
        peer: { service: "Test", instance: "inst" },
        api: "report",
        args: undefined,
        msgId: "msg-1",
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Invalid report data"),
      );
    });
  });

  describe("ServiceProvider buildAccessPointInfo", () => {
    it("should build access point info with authorization and function", () => {
      serviceProvider = new TestServiceProvider({
        udpPort: assignedUdpPort,
        tcpPort: assignedTcpPort,
        smDiscovery: "None",
      });

      const baseInfo: AccessPoint = {
        address: "127.0.0.1",
        port: 8080,
        protocol: NetworkProtocol.TCP,
        authorization: "",
        function: [],
      };

      const result = (serviceProvider as any).buildAccessPointInfo(baseInfo);
      expect(result.authorization).toBe("test-auth");
      expect(result.function).toContain("testFunction");
    });
  });
});
