import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Container } from "inversify";
import { Logger } from "winston";
import { TcpServer } from "../../network/tcp-server";
import { UdpServer } from "../../network/udp-server";
import { ConfigManager } from "../../common/config";
import { LoggerManager } from "../../common/logger";
import { ExecutionMetrics } from "../../metrics/exec-metrics";
import { ServiceManager } from "../../manager/service-manager";
import { TYPES, container, createNamedTcpServer, createNamedUdpServer } from "../../aop/container";

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
      expect(TYPES.LoggerManager).toBeDefined();
      expect(TYPES.ServiceManager).toBeDefined();
      expect(TYPES.TcpServer).toBeDefined();
      expect(TYPES.UdpServer).toBeDefined();
    });

    it("should be an instance of Container", () => {
      expect(container).toBeInstanceOf(Container);
    });
  });

  describe("createNamedTcpServer", () => {
    it("should create a TcpServer instance with the given name", () => {
      const mockConfigManager = {
        getCoreConfig: () => ({
          tcp_address: "127.0.0.1",
          tcp_port: 0,
          retry_interval: 10,
          retry_max: 2,
          service_name: "test-service",
        }),
      } as unknown as ConfigManager;

      const mockLoggerManager = {
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        }),
      } as unknown as LoggerManager;

      vi.spyOn(container, "get")
        .mockImplementationOnce(() => mockConfigManager)
        .mockImplementationOnce(() => mockLoggerManager);

      const tcpServer = createNamedTcpServer("my-custom-tcp");

      expect(tcpServer).toBeInstanceOf(TcpServer);
      expect((tcpServer as any).name).toBe("my-custom-tcp");
    });

    it("should use default name when not provided", () => {
      const mockConfigManager = {
        getCoreConfig: () => ({
          tcp_address: "127.0.0.1",
          tcp_port: 0,
          retry_interval: 10,
          retry_max: 2,
          service_name: "test-service",
        }),
      } as unknown as ConfigManager;

      const mockLoggerManager = {
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        }),
      } as unknown as LoggerManager;

      vi.spyOn(container, "get")
        .mockImplementationOnce(() => mockConfigManager)
        .mockImplementationOnce(() => mockLoggerManager);

      const tcpServer = createNamedTcpServer("tcp-server");

      expect(tcpServer).toBeInstanceOf(TcpServer);
      expect((tcpServer as any).name).toBe("tcp-server");
    });
  });

  describe("createNamedUdpServer", () => {
    it("should create a UdpServer instance with the given name", () => {
      const mockConfigManager = {
        getCoreConfig: () => ({
          udp_address: "127.0.0.1",
          udp_port: 5707,
          retry_interval: 10,
          retry_max: 2,
          service_name: "test-service",
        }),
      } as unknown as ConfigManager;

      const mockLoggerManager = {
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        }),
      } as unknown as LoggerManager;

      vi.spyOn(container, "get")
        .mockImplementationOnce(() => mockConfigManager)
        .mockImplementationOnce(() => mockLoggerManager);

      const udpServer = createNamedUdpServer("my-custom-udp");

      expect(udpServer).toBeInstanceOf(UdpServer);
      expect((udpServer as any).name).toBe("my-custom-udp");
    });

    it("should use default name when not provided", () => {
      const mockConfigManager = {
        getCoreConfig: () => ({
          udp_address: "127.0.0.1",
          udp_port: 5707,
          retry_interval: 10,
          retry_max: 2,
          service_name: "test-service",
        }),
      } as unknown as ConfigManager;

      const mockLoggerManager = {
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        }),
      } as unknown as LoggerManager;

      vi.spyOn(container, "get")
        .mockImplementationOnce(() => mockConfigManager)
        .mockImplementationOnce(() => mockLoggerManager);

      const udpServer = createNamedUdpServer("udp-server");

      expect(udpServer).toBeInstanceOf(UdpServer);
      expect((udpServer as any).name).toBe("udp-server");
    });
  });

  describe("container bindings", () => {
    it("should have ConfigManager bound as singleton", () => {
      const configManager1 = container.get<ConfigManager>(TYPES.ConfigManager);
      const configManager2 = container.get<ConfigManager>(TYPES.ConfigManager);
      expect(configManager1).toBe(configManager2);
    });

    it("should have LoggerManager bound as singleton", () => {
      const loggerManager1 = container.get<LoggerManager>(TYPES.LoggerManager);
      const loggerManager2 = container.get<LoggerManager>(TYPES.LoggerManager);
      expect(loggerManager1).toBe(loggerManager2);
    });

    it("should have ExecutionMetrics bound as singleton", () => {
      const metrics1 = container.get<ExecutionMetrics>(ExecutionMetrics);
      const metrics2 = container.get<ExecutionMetrics>(ExecutionMetrics);
      expect(metrics1).toBe(metrics2);
    });

    it("should have TcpServer bound", () => {
      const tcpServer = container.get<TcpServer>(TYPES.TcpServer);
      expect(tcpServer).toBeInstanceOf(TcpServer);
    });

    it("should have UdpServer bound", () => {
      const udpServer = container.get<UdpServer>(TYPES.UdpServer);
      expect(udpServer).toBeInstanceOf(UdpServer);
    });

    it("should have Logger bound as dynamic value", () => {
      const logger1 = container.get<Logger>(TYPES.Logger);
      const logger2 = container.get<Logger>(TYPES.Logger);
      expect(logger1).toBeDefined();
      expect(logger2).toBeDefined();
    });

    it("should have ServiceManager bound", () => {
      const serviceManager = container.get<ServiceManager>(TYPES.ServiceManager);
      expect(serviceManager).toBeDefined();
      expect(serviceManager.PROTOCOL).toBeDefined();
    });
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
