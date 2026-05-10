import * as dgram from "dgram";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NetworkEvent } from "../../network/network-events";
import { ExecutionState } from "../../types/basal-protocol";
import { UdpDiscovery } from "../../network/udp-discovery";
import { ConfigManager, DEFAULT_DISCOVERY_PORT } from "../../common/config";

vi.mock("dgram");

vi.mock("../../metrics/otel-tracing", () => ({
  OtelTracer: {
    getInstance: () => ({
      createBroadcastSpan: () => ({
        setStatus: vi.fn(),
        setAttribute: vi.fn(),
        end: vi.fn(),
        recordException: vi.fn(),
      }),
    }),
  },
  generateCorrelationId: () => "test-correlation-id",
}));

vi.mock("../../metrics/otel-metrics", () => ({
  udpBroadcastRequests: { add: vi.fn() },
  udpBroadcastResponses: { add: vi.fn() },
  udpBroadcastLatency: { record: vi.fn() },
  bytesCounter: { add: vi.fn() },
  retryDuration: { record: vi.fn() },
  retryAttempts: { add: vi.fn() },
}));

describe("UdpDiscovery", () => {
  let udpDiscovery: UdpDiscovery;
  let sockets: any[];

  function createMockSocket() {
    const localListeners: Record<string, Function[]> = {};
    const mockSock = {
      bind: vi.fn(),
      close: vi.fn(() => localListeners["close"]?.forEach((fn) => fn())),
      on: vi.fn((evt, cb) => {
        if (!localListeners[evt]) {
          localListeners[evt] = [];
        }
        localListeners[evt].push(cb);
      }),
      once: vi.fn((evt, cb) => {
        if (!localListeners[evt]) {
          localListeners[evt] = [];
        }
        localListeners[evt].push(cb);
      }),
      off: vi.fn((evt, cb) => {
        localListeners[evt] = (localListeners[evt] || []).filter(
          (f) => f !== cb,
        );
      }),
      send: vi.fn((data, port, address, cb) => {
        if (cb) cb(null);
      }),
      address: vi.fn(() => ({ port: 0 })),
      setBroadcast: vi.fn(),
      _listeners: localListeners,
    };

    sockets.push(mockSock);
    return mockSock as any;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    sockets = [];

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
          interval: 10,
          max_try: 2,
          backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
        },
        service_name: "test-discovery",
      }),
      getProviderId: () => "provider-123",
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        silly: vi.fn(),
      }),
    } as unknown as ConfigManager;

    vi.mocked(dgram.createSocket).mockImplementation(() => createMockSocket());
    udpDiscovery = new UdpDiscovery(mockConfigManager);
  });

  it("should create instance with correct properties", () => {
    expect(udpDiscovery).toBeDefined();
    expect((udpDiscovery as any).name).toBe("udp-discovery");
  });

  it("should have default options with correct values", () => {
    expect(UdpDiscovery.DEFAULT_OPTIONS.port).toBe(DEFAULT_DISCOVERY_PORT);
    expect(UdpDiscovery.DEFAULT_OPTIONS.maxResponses).toBe(0);
    expect(UdpDiscovery.DEFAULT_OPTIONS.timeout).toBe(5000);
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
          interval: 10,
          max_try: 2,
          backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
        },
        service_name: "test",
      }),
      getProviderId: () => "provider-123",
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    } as unknown as ConfigManager;

    const namedDiscovery = new UdpDiscovery(
      localMockConfigManager,
      "my-discovery",
    );
    expect((namedDiscovery as any).name).toBe("my-discovery");
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
          interval: 10,
          max_try: 2,
          backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
        },
        service_name: "test",
      }),
      getProviderId: () => "provider-123",
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    } as unknown as ConfigManager;

    const defaultDiscovery = new UdpDiscovery(localMockConfigManager);
    expect((defaultDiscovery as any).name).toBe("udp-discovery");
  });

  it("should start and enable broadcast mode", async () => {
    const p = udpDiscovery.start();
    const sock = sockets[0];
    sock._listeners[NetworkEvent.Listening][0]();
    await p;

    expect(sock.setBroadcast).toHaveBeenCalledWith(true);
    await udpDiscovery.stop();
  });
});
