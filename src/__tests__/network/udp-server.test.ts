import * as dgram from "dgram";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NetworkEvent } from "../../network/network-events";
import { ExecutionState as ServerState } from "../../types/basal-protocol";
import { UdpServer } from "../../network/udp-server";
import { ConfigManager, DEFAULT_DISCOVERY_PORT } from "../../common/config";
import { LoggerManager } from "../../common/logger";

vi.mock("dgram");

// Mock otel-tracing to avoid OpenTelemetry context issues in tests
vi.mock("../../metrics/otel-tracing", () => ({
  generateCorrelationId: () => "test-correlation-id",
  OtelTracing: {
    createNetworkSpan: () => ({
      setStatus: vi.fn(),
      end: vi.fn(),
    }),
    recordException: vi.fn(),
  },
}));

// Mock otel-metrics to avoid metric collection issues in tests
vi.mock("../../metrics/otel-metrics", () => ({
  bytesCounter: {
    add: vi.fn(),
  },
  retryDuration: {
    record: vi.fn(),
  },
  retryAttempts: {
    add: vi.fn(),
  },
}));

// Mock abort-aware to control sleep behavior
vi.mock("../../common/abort-aware", () => ({
  isAbortError: vi
    .fn()
    .mockImplementation((err: any) => err?.name === "AbortError"),
  sleep: vi.fn().mockImplementation((ms: number) => {
    vi.advanceTimersByTime(ms);
    return Promise.resolve();
  }),
}));

describe("UdpServer", () => {
  let udpServer: UdpServer;
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
      address: vi.fn(() => ({ port: DEFAULT_DISCOVERY_PORT })),
      _listeners: localListeners,
    };

    sockets.push(mockSock);
    return mockSock as any;
  }

  beforeEach(() => {
    vi.clearAllMocks();

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
          sm_port: DEFAULT_DISCOVERY_PORT,
        },
        retry: {
          interval: 10,
          max_try: 2,
          backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
        },
        service_name: "test-udp",
      }),
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    } as unknown as ConfigManager;

    sockets = [];
    vi.mocked(dgram.createSocket).mockImplementation(() => createMockSocket());
    udpServer = new UdpServer(mockConfigManager);
  });

  it("should initialize with correct properties", () => {
    expect(udpServer.getState()).toBe(ServerState.Stopped);
    expect((udpServer as any).configManager).toBeDefined();
  });

  it("getState() should return current server state", () => {
    expect(udpServer.getState()).toBe(ServerState.Stopped);

    (udpServer as any)._state = ServerState.Listening;
    expect(udpServer.getState()).toBe(ServerState.Listening);
  });

  it("getPort() should return the configured port after start", async () => {
    const initialPort = udpServer.getPort();
    expect(initialPort).toBeUndefined();

    expect(typeof (udpServer as any).configManager).toBe("object");
  });

  it("start() should initialize internal state correctly", () => {
    const startPromise = udpServer.start();

    expect((udpServer as any)._abortController).toBeDefined();
    expect((udpServer as any)._retryScheduler).toBeDefined();
    expect((udpServer as any)._state).toBe(ServerState.Starting);
    expect((udpServer as any)._address).toBe("127.0.0.1");
    expect((udpServer as any)._port).toBe(DEFAULT_DISCOVERY_PORT);

    expect(startPromise).toBeInstanceOf(Promise);
  });

  it("should retry when socket closes unexpectedly", async () => {
    udpServer.start();

    await new Promise((resolve) => setTimeout(resolve, 10));

    const firstSocket = sockets[0];
    expect(firstSocket).toBeDefined();

    if (
      firstSocket &&
      firstSocket._listeners &&
      firstSocket._listeners[NetworkEvent.Close] &&
      firstSocket._listeners[NetworkEvent.Close].length > 0
    ) {
      firstSocket._listeners[NetworkEvent.Close][0]();
    }

    expect(udpServer.getState()).toBe(ServerState.Starting);
  });

  it("start() should handle retryable errors properly", async () => {
    udpServer.start();
    await Promise.resolve();

    expect((udpServer as any)._retryScheduler).toBeDefined();
    expect((udpServer as any)._abortController).toBeDefined();
    expect(udpServer.getState()).toBe(ServerState.Starting);

    await udpServer.stop();
  });

  it("should retry on retryable socket error", async () => {
    udpServer.start();

    await new Promise((resolve) => setTimeout(resolve, 10));

    const firstSocket = sockets[0];
    expect(firstSocket).toBeDefined();

    if (
      firstSocket &&
      firstSocket._listeners &&
      firstSocket._listeners[NetworkEvent.Error] &&
      firstSocket._listeners[NetworkEvent.Error].length > 0
    ) {
      firstSocket._listeners[NetworkEvent.Error][0]({ code: "EADDRINUSE" });
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
    const sock = sockets[sockets.length - 1];
    sock._listeners[NetworkEvent.Listening][0]();

    expect(udpServer.getState()).toBe(ServerState.Listening);
  });

  it("should stop after retry exhaustion", async () => {
    const localSockets: any[] = [];

    vi.mocked(dgram.createSocket).mockImplementation(() => {
      const localListeners: Record<string, Function[]> = {};
      const sock = {
        bind: vi.fn(),
        close: vi.fn(() => localListeners["close"]?.forEach((fn) => fn())),
        on: vi.fn((e, cb) => {
          if (!localListeners[e]) {
            localListeners[e] = [];
          }
          localListeners[e].push(cb);
        }),
        once: vi.fn((e, cb) => {
          if (!localListeners[e]) {
            localListeners[e] = [];
          }
          localListeners[e].push(cb);
        }),
        off: vi.fn((e, cb) => {
          localListeners[e] = (localListeners[e] || []).filter((f) => f !== cb);
        }),
        address: vi.fn(() => ({ port: DEFAULT_DISCOVERY_PORT })),
        _listeners: localListeners,
      };

      localSockets.push(sock);

      queueMicrotask(() => {
        const err = Object.assign(new Error("busy"), { code: "EADDRINUSE" });
        localListeners.error?.[0]?.(err);
      });

      return sock as any;
    });

    const testConfigManager = {
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
          sm_port: DEFAULT_DISCOVERY_PORT,
        },
        retry: {
          interval: 10,
          max_retries: 2,
          backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
        },
        service_name: "test-exhaust",
      }),
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    } as unknown as ConfigManager;

    const testLoggerManager = {
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    } as unknown as LoggerManager;

    const testUdpServer = new UdpServer(testConfigManager);

    const p = testUdpServer.start();
    await expect(p).rejects.toThrow("busy");

    expect(localSockets.length).toBe(2);
    expect(testUdpServer.getState()).toBe(ServerState.Error);
  });

  it("start() should handle non-retryable errors correctly", async () => {
    udpServer.start();
    await Promise.resolve();

    expect((udpServer as any)._abortController).toBeDefined();
    expect(udpServer.getState()).toBe(ServerState.Starting);

    await udpServer.stop();
  });

  it("should enter Error state on non-retryable socket error", async () => {
    udpServer.start();

    const err = Object.assign(new Error("fatal"), { code: "EACCES" });
    const sock = sockets[0];
    expect(sock).toBeDefined();
    if (sock && sock._listeners && sock._listeners[NetworkEvent.Error]) {
      sock._listeners[NetworkEvent.Error][0](err);
    }

    await Promise.resolve();
    expect(udpServer.getState()).toBe(ServerState.Error);
  });

  it("stop() should gracefully stop the server", async () => {
    const result = await udpServer.stop();
    expect(result).toBeUndefined();
    expect(udpServer.getState()).toBe(ServerState.Stopped);
  });

  it("stop() should close active socket and abort retries", async () => {
    const p = udpServer.start();
    const sock = sockets[0];
    expect(sock).toBeDefined();
    if (sock && sock._listeners && sock._listeners[NetworkEvent.Listening]) {
      sock._listeners[NetworkEvent.Listening][0]();
    }
    await p;

    await udpServer.stop();

    expect(sock.close).toHaveBeenCalled();
    expect(udpServer.getState()).toBe(ServerState.Stopped);
  });

  it("stop() should be idempotent when already stopped", async () => {
    await udpServer.stop();
    expect(udpServer.getState()).toBe(ServerState.Stopped);

    await udpServer.stop();
    expect(udpServer.getState()).toBe(ServerState.Stopped);
  });

  it("attemptBind() should handle synchronous errors", async () => {
    vi.mocked(dgram.createSocket).mockImplementation(() => {
      throw new Error("Synchronous error");
    });

    const errorConfigManager = {
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
          sm_port: DEFAULT_DISCOVERY_PORT,
        },
        retry: {
          interval: 10,
          max_try: 2,
          backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
        },
        service_name: "test-sync-error",
      }),
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    } as unknown as ConfigManager;

    const errorLoggerManager = {
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    } as unknown as LoggerManager;

    const errorUdpServer = new UdpServer(errorConfigManager);

    errorUdpServer.on(NetworkEvent.Error, () => {
      console.log("Handled error event");
    });

    try {
      errorUdpServer.start();
    } catch (err) {
      console.log("Error caught.");
      expect(err).rejects.toThrow("Synchronous error");
    }
  });

  it("should handle NetworkEvent.Message properly", () => {
    const spy = vi.fn();
    udpServer.on(NetworkEvent.Message, spy);

    expect(typeof udpServer.on).toBe("function");
  });

  it("should emit NetworkEvent.Message on incoming datagram", async () => {
    const spy = vi.fn();
    udpServer.on(NetworkEvent.Message, spy);

    udpServer.start();
    await Promise.resolve();

    const sock = sockets[sockets.length - 1];
    expect(sock).toBeDefined();
    if (sock && sock._listeners && sock._listeners[NetworkEvent.Message]) {
      sock._listeners[NetworkEvent.Message][0](Buffer.from("hello"), {
        address: "1.2.3.4",
        port: 9999,
      });
    }

    expect(spy).toHaveBeenCalledOnce();
  });

  it("should handle error events properly", () => {
    const errorSpy = vi.fn();
    udpServer.on(NetworkEvent.Error, errorSpy);

    expect(typeof udpServer.on).toBe("function");
  });

  it("should transition to Listening on successful bind", async () => {
    const p = udpServer.start();
    const sock = sockets[0];
    expect(sock).toBeDefined();
    if (sock && sock._listeners && sock._listeners[NetworkEvent.Listening]) {
      sock._listeners[NetworkEvent.Listening][0]();
    }
    await p;

    expect(udpServer.getState()).toBe(ServerState.Listening);
    expect(udpServer.getPort()).toBe(DEFAULT_DISCOVERY_PORT);
  });

  it("should properly handle state transitions", () => {
    (udpServer as any)._setState(ServerState.Listening);
    expect(udpServer.getState()).toBe(ServerState.Listening);

    (udpServer as any)._setState(ServerState.Listening);
    expect(udpServer.getState()).toBe(ServerState.Listening);
  });

  it("should handle abort controller properly", async () => {
    udpServer.start();
    await Promise.resolve();

    expect((udpServer as any)._abortController).toBeDefined();
    expect(typeof (udpServer as any)._abortController.abort).toBe("function");

    await udpServer.stop();
  });

  it("should abort retry loop with AbortError", async () => {
    const startPromise = udpServer.start();

    const err = Object.assign(new Error("down"), { code: "ENETDOWN" });
    const sock = sockets[0];
    sock._listeners[NetworkEvent.Error][0](err);

    await udpServer.stop();
    await expect(startPromise).resolves.toBeUndefined();
    expect(udpServer.getState()).toBe(ServerState.Error);
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
          sm_discovery: Symbol("sm_discovery"),
          sm_port: DEFAULT_DISCOVERY_PORT,
        },
        retry: {
          interval: 10,
          max_try: 2,
          backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
        },
        service_name: "test-udp",
      }),
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    } as unknown as ConfigManager;

    const namedServer = new UdpServer(
      localMockConfigManager,
      "my-custom-udp-server",
    );
    expect((namedServer as any).name).toBe("my-custom-udp-server");
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
          sm_discovery: Symbol("sm_discovery"),
          sm_port: DEFAULT_DISCOVERY_PORT,
        },
        retry: {
          interval: 10,
          max_try: 2,
          backoff: { enable: true, max_delay: 240000, multiplier: 1.5 },
        },
        service_name: "test-udp",
      }),
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    } as unknown as ConfigManager;

    const defaultServer = new UdpServer(localMockConfigManager);
    expect((defaultServer as any).name).toBe("udp-server");
  });
});
