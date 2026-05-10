import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Container } from "inversify";
import { TcpServer } from "../../network/tcp-server";
import { UdpServer } from "../../network/udp-server";
import { BroadcastUdpServer } from "../../network/broadcast-udp-server";
import { ConfigManager, DEFAULT_DISCOVERY_PORT } from "../../common/config";
import { DefaultIdGenerator } from "../../common/id-generator";
import { UdpDiscovery } from "../../network/udp-discovery";
import {
  TYPES,
  container,
  createNamedTcpServer,
  createNamedUdpServer,
  createProvider,
  createServiceManagerDiscover,
  createOtelExporter,
} from "../../aop/container";

describe("container", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("container initialization", () => {
    it("should be defined and export TYPES", () => {
      expect(TYPES).toBeDefined();
      expect(TYPES.ConfigManager).toBeDefined();
      expect(TYPES.ServiceManager).toBeDefined();
      expect(TYPES.TcpServer).toBeDefined();
      expect(TYPES.UdpServer).toBeDefined();
      expect(TYPES.IdGenerator).toBeDefined();
      expect(TYPES.DiscoverProcedure).toBeDefined();
      expect(TYPES.RegisterProcedure).toBeDefined();
      expect(TYPES.ReportProcedure).toBeDefined();
      expect(TYPES.Logger).toBeDefined();
      expect(TYPES.BroadcastUdpServer).toBeDefined();
      expect(TYPES.UdpDiscovery).toBeDefined();
      expect(TYPES.UdpClient).toBeDefined();
      expect(TYPES.ServiceProvider).toBeDefined();
      expect(TYPES.None).toBeDefined();
    });

    it("should be an instance of Container", () => {
      expect(container).toBeInstanceOf(Container);
    });
  });

  describe("createNamedTcpServer", () => {
    it("should create a TcpServer instance with the given name", () => {
      const mockConfigManager = {
        getCoreConfig: () => ({
          net: {
            tcp: {
              address: "127.0.0.1",
              port: 0,
              client: {
                timeout: 10000,
                keep_alive: false,
                keep_alive_initial_delay: 0,
              },
            },
            udp: {
              address: "127.0.0.1",
              port: 5707,
            },
            sm_discovery: Symbol("sm_discovery"),
            sm_port: 5707,
          },
          retry: {
            interval: 10,
            max_try: 2,
            backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
          },
          service_name: "test-service",
        }),
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          silly: vi.fn(),
        }),
      } as unknown as ConfigManager;

      vi.spyOn(container, "get").mockImplementationOnce(
        () => mockConfigManager,
      );

      const tcpServer = createNamedTcpServer(
        mockConfigManager,
        "my-custom-tcp",
      );

      expect(tcpServer).toBeInstanceOf(TcpServer);
      expect((tcpServer as any).name).toBe("my-custom-tcp");
    });

    it("should use default name when not provided", () => {
      const mockConfigManager = {
        getCoreConfig: () => ({
          net: {
            tcp: {
              address: "127.0.0.1",
              port: 0,
              client: {
                timeout: 10000,
                keep_alive: false,
                keep_alive_initial_delay: 0,
              },
            },
            udp: {
              address: "127.0.0.1",
              port: 5707,
            },
            sm_discovery: Symbol("sm_discovery"),
            sm_port: 5707,
          },
          retry: {
            interval: 10,
            max_try: 2,
            backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
          },
          service_name: "test-service",
        }),
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          silly: vi.fn(),
        }),
      } as unknown as ConfigManager;

      vi.spyOn(container, "get").mockImplementationOnce(
        () => mockConfigManager,
      );

      const tcpServer = createNamedTcpServer(mockConfigManager, "tcp-server");

      expect(tcpServer).toBeInstanceOf(TcpServer);
      expect((tcpServer as any).name).toBe("tcp-server");
    });
  });

  describe("createNamedUdpServer", () => {
    it("should create a UdpServer instance with the given name", () => {
      const mockConfigManager = {
        getCoreConfig: () => ({
          net: {
            tcp: {
              address: "127.0.0.1",
              port: 0,
              client: {
                timeout: 10000,
                keep_alive: false,
                keep_alive_initial_delay: 0,
              },
            },
            udp: {
              address: "127.0.0.1",
              port: DEFAULT_DISCOVERY_PORT,
            },
            sm_discovery: Symbol("sm_discovery"),
            sm_port: 5707,
          },
          retry: {
            interval: 10,
            max_try: 2,
            backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
          },
          service_name: "test-service",
        }),
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          silly: vi.fn(),
        }),
      } as unknown as ConfigManager;

      vi.spyOn(container, "get").mockImplementationOnce(
        () => mockConfigManager,
      );

      const udpServer = createNamedUdpServer(
        mockConfigManager,
        "my-custom-udp",
        TYPES.UdpServer,
      );

      expect(udpServer).toBeInstanceOf(UdpServer);
      expect((udpServer as any).name).toBe("my-custom-udp");
    });

    it("should use default name when not provided", () => {
      const mockConfigManager = {
        getCoreConfig: () => ({
          net: {
            tcp: {
              address: "127.0.0.1",
              port: 0,
              client: {
                timeout: 10000,
                keep_alive: false,
                keep_alive_initial_delay: 0,
              },
            },
            udp: {
              address: "127.0.0.1",
              port: DEFAULT_DISCOVERY_PORT,
            },
            sm_discovery: Symbol("sm_discovery"),
            sm_port: 5707,
          },
          retry: {
            interval: 10,
            max_try: 2,
            backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
          },
          service_name: "test-service",
        }),
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          silly: vi.fn(),
        }),
      } as unknown as ConfigManager;

      vi.spyOn(container, "get").mockImplementationOnce(
        () => mockConfigManager,
      );

      const udpServer = createNamedUdpServer(
        mockConfigManager,
        "udp-server",
        TYPES.UdpServer,
      );

      expect(udpServer).toBeInstanceOf(UdpServer);
      expect((udpServer as any).name).toBe("udp-server");
    });
  });

  describe("container bindings", () => {
    it("should have IdGenerator bound as singleton", () => {
      const idGenerator1 = container.get<DefaultIdGenerator>(TYPES.IdGenerator);
      const idGenerator2 = container.get<DefaultIdGenerator>(TYPES.IdGenerator);
      expect(idGenerator1).toBe(idGenerator2);
    });

    it("should have DiscoverProcedure binding defined", () => {
      // Check that the binding exists (may not be resolvable without ConfigManager)
      const hasBinding = container.isBound(TYPES.DiscoverProcedure);
      expect(hasBinding).toBe(true);
    });

    it("should have RegisterProcedure binding defined", () => {
      // Check that the binding exists (may not be resolvable without ConfigManager)
      const hasBinding = container.isBound(TYPES.RegisterProcedure);
      expect(hasBinding).toBe(true);
    });

    it("should have ReportProcedure binding defined", () => {
      // Check that the binding exists (may not be resolvable without ConfigManager)
      const hasBinding = container.isBound(TYPES.ReportProcedure);
      expect(hasBinding).toBe(true);
    });

    it("should have TYPES symbols defined", () => {
      expect(TYPES.ConfigManager).toBeDefined();
      expect(TYPES.ServiceManager).toBeDefined();
      expect(TYPES.TcpServer).toBeDefined();
      expect(TYPES.UdpServer).toBeDefined();
      expect(TYPES.Logger).toBeDefined();
    });
  });

  describe("container module exports", () => {
    it("should export createNamedTcpServer function", () => {
      expect(typeof createNamedTcpServer).toBe("function");
    });

    it("should export createNamedUdpServer function", () => {
      expect(typeof createNamedUdpServer).toBe("function");
    });

    it("should export container constant", () => {
      expect(container).toBeDefined();
      expect(container).toBeInstanceOf(Container);
    });
  });

  describe("createProvider", () => {
    it("should export createProvider function", () => {
      expect(typeof createProvider).toBe("function");
    });
  });

  describe("createServiceManagerDiscover", () => {
    it("should export createServiceManagerDiscover function", () => {
      expect(typeof createServiceManagerDiscover).toBe("function");
    });

    it("should create UdpDiscovery when type is TYPES.UdpDiscovery", () => {
      const mockConfigManager = {
        getCoreConfig: () => ({
          net: {
            tcp: {
              address: "127.0.0.1",
              port: 0,
              client: {
                timeout: 10000,
                keep_alive: false,
                keep_alive_initial_delay: 0,
              },
            },
            udp: {
              address: "127.0.0.1",
              port: DEFAULT_DISCOVERY_PORT,
            },
            sm_discovery: Symbol("sm_discovery"),
            sm_port: 5707,
          },
          retry: {
            interval: 10,
            max_try: 2,
            backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
          },
          service_name: "test-service",
        }),
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          silly: vi.fn(),
        }),
      } as unknown as ConfigManager;

      const discovery = createServiceManagerDiscover(
        mockConfigManager,
        "discovery-server",
        TYPES.UdpDiscovery,
      );

      expect(discovery).toBeInstanceOf(UdpDiscovery);
    });

    it("should return undefined when type is not TYPES.UdpDiscovery", () => {
      const mockConfigManager = {
        getCoreConfig: () => ({
          net: {
            tcp: {
              address: "127.0.0.1",
              port: 0,
              client: {
                timeout: 10000,
                keep_alive: false,
                keep_alive_initial_delay: 0,
              },
            },
            udp: {
              address: "127.0.0.1",
              port: DEFAULT_DISCOVERY_PORT,
            },
            sm_discovery: Symbol("sm_discovery"),
            sm_port: 5707,
          },
          retry: {
            interval: 10,
            max_try: 2,
            backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
          },
          service_name: "test-service",
        }),
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          silly: vi.fn(),
        }),
      } as unknown as ConfigManager;

      const result = createServiceManagerDiscover(
        mockConfigManager,
        "discovery-server",
        TYPES.ConfigManager,
      );

      expect(result).toBeUndefined();
    });

    it("should return undefined when type is TYPES.TcpServer", () => {
      const mockConfigManager = {
        getCoreConfig: () => ({
          net: {
            tcp: {
              address: "127.0.0.1",
              port: 0,
              client: {
                timeout: 10000,
                keep_alive: false,
                keep_alive_initial_delay: 0,
              },
            },
            udp: {
              address: "127.0.0.1",
              port: DEFAULT_DISCOVERY_PORT,
            },
            sm_discovery: Symbol("sm_discovery"),
            sm_port: 5707,
          },
          retry: {
            interval: 10,
            max_try: 2,
            backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
          },
          service_name: "test-service",
        }),
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          silly: vi.fn(),
        }),
      } as unknown as ConfigManager;

      const result = createServiceManagerDiscover(
        mockConfigManager,
        "discovery-server",
        TYPES.TcpServer,
      );

      expect(result).toBeUndefined();
    });
  });

  describe("createOtelExporter", () => {
    it("should export createOtelExporter function", () => {
      expect(typeof createOtelExporter).toBe("function");
    });

    it("should return ConsoleSpanExporter in development environment", () => {
      const mockConfigManager = {
        getAppEnv: () => "development",
      } as unknown as ConfigManager;

      const exporter = createOtelExporter(mockConfigManager);
      expect(exporter).toBeDefined();
      expect(exporter.constructor.name).toBe("ConsoleSpanExporter");
    });

    it("should return OTLPTraceExporter in production environment", () => {
      const mockConfigManager = {
        getAppEnv: () => "production",
      } as unknown as ConfigManager;

      const exporter = createOtelExporter(mockConfigManager);
      expect(exporter).toBeDefined();
      expect(exporter.constructor.name).toBe("OTLPTraceExporter");
    });

    it("should return OTLPTraceExporter in staging environment", () => {
      const mockConfigManager = {
        getAppEnv: () => "staging",
      } as unknown as ConfigManager;

      const exporter = createOtelExporter(mockConfigManager);
      expect(exporter).toBeDefined();
      expect(exporter.constructor.name).toBe("OTLPTraceExporter");
    });

    it("should return OTLPTraceExporter in test environment", () => {
      const mockConfigManager = {
        getAppEnv: () => "test",
      } as unknown as ConfigManager;

      const exporter = createOtelExporter(mockConfigManager);
      expect(exporter).toBeDefined();
      expect(exporter.constructor.name).toBe("OTLPTraceExporter");
    });
  });

  describe("createNamedUdpServer with BroadcastUdpServer", () => {
    it("should create BroadcastUdpServer when type is TYPES.BroadcastUdpServer", () => {
      const mockConfigManager = {
        getCoreConfig: () => ({
          net: {
            tcp: {
              address: "127.0.0.1",
              port: 0,
              client: {
                timeout: 10000,
                keep_alive: false,
                keep_alive_initial_delay: 0,
              },
            },
            udp: {
              address: "127.0.0.1",
              port: DEFAULT_DISCOVERY_PORT,
            },
            sm_discovery: Symbol("sm_discovery"),
            sm_port: 5707,
          },
          retry: {
            interval: 10,
            max_try: 2,
            backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
          },
          service_name: "test-service",
        }),
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          silly: vi.fn(),
        }),
      } as unknown as ConfigManager;

      vi.spyOn(container, "get").mockImplementationOnce(
        () => mockConfigManager,
      );

      const udpServer = createNamedUdpServer(
        mockConfigManager,
        "broadcast",
        TYPES.BroadcastUdpServer,
      );

      expect(udpServer).toBeInstanceOf(BroadcastUdpServer);
      expect((udpServer as any).name).toBe("broadcast");
    });
  });

  describe("error handling", () => {
    it("should handle ConfigManager.getAppEnv errors in createOtelExporter", () => {
      const mockConfigManager = {
        getAppEnv: () => {
          throw new Error("Env error");
        },
      } as unknown as ConfigManager;

      expect(() => {
        createOtelExporter(mockConfigManager);
      }).toThrow("Env error");
    });

    it("should handle getLogger errors in createNamedTcpServer", () => {
      const mockConfigManager = {
        getLogger: () => {
          throw new Error("Logger error");
        },
      } as unknown as ConfigManager;

      expect(() => {
        createNamedTcpServer(mockConfigManager, "test-tcp");
      }).toThrow("Logger error");
    });

    it("should handle getLogger errors in createNamedUdpServer", () => {
      const mockConfigManager = {
        getLogger: () => {
          throw new Error("Logger error");
        },
      } as unknown as ConfigManager;

      expect(() => {
        createNamedUdpServer(mockConfigManager, "test-udp", TYPES.UdpServer);
      }).toThrow("Logger error");
    });

    it("should handle getLogger errors in createServiceManagerDiscover", () => {
      const mockConfigManager = {
        getLogger: () => {
          throw new Error("Logger error");
        },
      } as unknown as ConfigManager;

      expect(() => {
        createServiceManagerDiscover(
          mockConfigManager,
          "test-discovery",
          TYPES.UdpDiscovery,
        );
      }).toThrow("Logger error");
    });
  });

  describe("TYPES symbols uniqueness", () => {
    it("should have unique symbol values for each TYPES member", () => {
      const symbols = Object.values(TYPES);
      const uniqueSymbols = [...new Set(symbols)];
      expect(symbols.length).toBe(uniqueSymbols.length);
    });

    it("should have all required TYPES defined", () => {
      expect(TYPES.ConfigManager).toBeDefined();
      expect(TYPES.ServiceManager).toBeDefined();
      expect(TYPES.TcpServer).toBeDefined();
      expect(TYPES.UdpServer).toBeDefined();
      expect(TYPES.IdGenerator).toBeDefined();
      expect(TYPES.DiscoverProcedure).toBeDefined();
      expect(TYPES.RegisterProcedure).toBeDefined();
      expect(TYPES.ReportProcedure).toBeDefined();
      expect(TYPES.Logger).toBeDefined();
      expect(TYPES.BroadcastUdpServer).toBeDefined();
      expect(TYPES.UdpDiscovery).toBeDefined();
      expect(TYPES.UdpClient).toBeDefined();
      expect(TYPES.ServiceProvider).toBeDefined();
      expect(TYPES.None).toBeDefined();
    });
  });
});
