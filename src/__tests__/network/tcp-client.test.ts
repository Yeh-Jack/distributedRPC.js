import * as net from "net";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NetworkEvent } from "../../network/network-events";
import { ExecutionState } from "../../types/basal-protocol";
import { NetworkProtocol } from "../../types/basal-protocol";
import { TcpClient } from "../../network/tcp-client";
import { ConfigManager, DEFAULT_DISCOVERY_PORT } from "../../common/config";

vi.mock("net");

vi.mock("../../metrics/otel-tracing", () => ({
  OtelTracer: {
    getInstance: () => ({
      createNetworkSpan: () => ({
        setStatus: vi.fn(),
        setAttribute: vi.fn(),
        end: vi.fn(),
        recordException: vi.fn(),
      }),
    }),
  },
}));

vi.mock("../../metrics/otel-metrics", () => ({
  activeConnections: { add: vi.fn() },
  bytesCounter: { add: vi.fn() },
  tcpConnectionDuration: { record: vi.fn() },
  tcpConnectionsFailed: { add: vi.fn() },
  tcpDataTransferSize: { record: vi.fn() },
}));

describe("TcpClient", () => {
  let tcpClient: TcpClient;
  let mockSocket: any;
  let socketEvents: Record<string, Function>;
  const retryInterval = 10;

  const createMockSocket = () => {
    const localEvents: Record<string, Function> = {};
    return {
      remoteAddress: "127.0.0.1",
      remotePort: 54321,
      on: vi.fn((event, cb) => {
        localEvents[event] = cb;
        socketEvents[event] = cb;
        return this;
      }),
      once: vi.fn((event, cb) => {
        localEvents[event] = cb;
        return this;
      }),
      emit: vi.fn((event, ...args) => {
        if (localEvents[event]) {
          localEvents[event](...args);
        }
      }),
      write: vi.fn((data, cb) => {
        if (cb) cb(null);
        return true;
      }),
      off: vi.fn(),
      destroy: vi.fn(),
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    socketEvents = {};

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
        },
        retry: {
          interval: retryInterval,
          max_try: 2,
          backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
        },
        service_name: "test-tcp-client",
      }),
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        silly: vi.fn(),
      }),
    } as unknown as ConfigManager;

    const accessPoint = {
      address: "127.0.0.1",
      port: 8080,
      protocol: NetworkProtocol.TCP,
      authorization: "secret",
      api: ["rpc-service"],
    };

    tcpClient = new TcpClient(mockConfigManager, accessPoint, "test-client");
  });

  it("should create instance with correct properties", () => {
    expect(tcpClient).toBeDefined();
    expect(tcpClient.name).toBe("test-client");
  });

  it("should return access point", () => {
    const ap = tcpClient.getAccessPoint();
    expect(ap.address).toBe("127.0.0.1");
    expect(ap.port).toBe(8080);
  });

  it("should return initial state as Stopped", () => {
    expect(tcpClient.getState()).toBe(ExecutionState.Stopped);
  });

  it("should return zero initial tx bytes", () => {
    expect(tcpClient.getTxBytes()).toBe(0);
  });

  it("should return zero initial rx bytes", () => {
    expect(tcpClient.getRxBytes()).toBe(0);
  });

  it("should reset byte counters", () => {
    tcpClient.resetByteCounters();
    expect(tcpClient.getTxBytes()).toBe(0);
    expect(tcpClient.getRxBytes()).toBe(0);
  });

  it("should throw error when getSocket called before connect", () => {
    expect(() => tcpClient.getSocket()).toThrow("not connected");
  });

  it("should set access point", () => {
    const newAccessPoint = {
      address: "192.168.1.1",
      port: 9090,
      protocol: NetworkProtocol.TCP,
      authorization: "new-secret",
      api: ["new-service"],
    };
    tcpClient.setAccessPoint(newAccessPoint);
    expect(tcpClient.getAccessPoint().address).toBe("192.168.1.1");
    expect(tcpClient.getAccessPoint().port).toBe(9090);
  });

  it("should accept custom name parameter", () => {
    const localMockConfigManager = {
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
        },
        retry: {
          interval: retryInterval,
          max_try: 2,
          backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
        },
        service_name: "test",
      }),
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    } as unknown as ConfigManager;

    const accessPoint = {
      address: "127.0.0.1",
      port: 8080,
      protocol: NetworkProtocol.TCP,
      authorization: "secret",
      api: ["service"],
    };

    const namedClient = new TcpClient(
      localMockConfigManager,
      accessPoint,
      "my-client",
    );
    expect(namedClient.name).toBe("my-client");
  });

  it("should use default name when not provided", () => {
    const localMockConfigManager = {
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
        },
        retry: {
          interval: retryInterval,
          max_try: 2,
          backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
        },
        service_name: "test",
      }),
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    } as unknown as ConfigManager;

    const accessPoint = {
      address: "127.0.0.1",
      port: 8080,
      protocol: NetworkProtocol.TCP,
      authorization: "secret",
      api: ["service"],
    };

    const defaultClient = new TcpClient(localMockConfigManager, accessPoint);
    expect(defaultClient.name).toBe("tcp-client");
  });
});
