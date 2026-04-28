import * as dgram from "dgram";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NetworkEvent } from "../../network/network-events";
import { ExecutionState, NetworkProtocol } from "../../types/basal-protocol";
import { UdpClient, SendOptions } from "../../network/udp-client";
import { ConfigManager, DEFAULT_DISCOVERY_PORT } from "../../common/config";

vi.mock("dgram");

vi.mock("../../metrics/otel-metrics", () => ({
  bytesCounter: { add: vi.fn() },
  retryDuration: { record: vi.fn() },
  retryAttempts: { add: vi.fn() },
}));

describe("UdpClient", () => {
  let udpClient: UdpClient;
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
        service_name: "test-udp",
      }),
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    } as unknown as ConfigManager;

    vi.mocked(dgram.createSocket).mockImplementation(() => createMockSocket());
    udpClient = new UdpClient(mockConfigManager);
  });

  it("should create instance with correct properties", () => {
    expect(udpClient).toBeDefined();
    expect((udpClient as any).name).toBe("udp-client");
  });

  it("should return initial state as Stopped", () => {
    expect(udpClient.getState()).toBe(ExecutionState.Stopped);
  });

  it("should throw error when getReadySocket called before start", () => {
    expect(() => udpClient.getReadySocket()).toThrow("not running");
  });

  it("should start and initialize state correctly", async () => {
    const startPromise = udpClient.start();
    expect((udpClient as any)._abortController).toBeDefined();
    expect((udpClient as any)._retryScheduler).toBeDefined();
    expect(udpClient.getState()).toBe(ExecutionState.Starting);
    await udpClient.stop();
  });

  it("should transition to Running on successful bind", async () => {
    const p = udpClient.start();
    const sock = sockets[0];
    sock._listeners[NetworkEvent.Listening][0]();
    await p;
    expect(udpClient.getState()).toBe(ExecutionState.Running);
    await udpClient.stop();
  });

  it("should stop gracefully when already stopped", async () => {
    const result = await udpClient.stop();
    expect(result).toBeUndefined();
    expect(udpClient.getState()).toBe(ExecutionState.Stopped);
  });

  it("should close socket on stop", async () => {
    const p = udpClient.start();
    const sock = sockets[0];
    sock._listeners[NetworkEvent.Listening][0]();
    await p;

    await udpClient.stop();
    expect(sock.close).toHaveBeenCalled();
    expect(udpClient.getState()).toBe(ExecutionState.Stopped);
  });

  it("should be idempotent when stopping multiple times", async () => {
    await udpClient.stop();
    await udpClient.stop();
    expect(udpClient.getState()).toBe(ExecutionState.Stopped);
  });

  it("should return socket when running", async () => {
    const p = udpClient.start();
    const sock = sockets[0];
    sock._listeners[NetworkEvent.Listening][0]();
    await p;

    const socket = udpClient.getReadySocket();
    expect(socket).toBeDefined();
    await udpClient.stop();
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
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    } as unknown as ConfigManager;

    const namedClient = new UdpClient(localMockConfigManager, "my-udp-client");
    expect((namedClient as any).name).toBe("my-udp-client");
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
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    } as unknown as ConfigManager;

    const defaultClient = new UdpClient(localMockConfigManager);
    expect((defaultClient as any).name).toBe("udp-client");
  });

  it("should set broadcast mode", async () => {
    const p = udpClient.start();
    const sock = sockets[0];
    sock._listeners[NetworkEvent.Listening][0]();
    await p;

    await udpClient.setBroadcast(true);
    expect(sock.setBroadcast).toHaveBeenCalledWith(true);
    await udpClient.stop();
  });

  it("should emit listening event on successful bind", async () => {
    const spy = vi.fn();
    udpClient.on(NetworkEvent.Listening, spy);

    const p = udpClient.start();
    const sock = sockets[0];
    sock._listeners[NetworkEvent.Listening][0]();
    await p;

    expect(spy).toHaveBeenCalled();
    await udpClient.stop();
  });

  it("should handle sendAndWait with timeout returning empty response", async () => {
    const p = udpClient.start();
    const sock = sockets[0];
    sock._listeners[NetworkEvent.Listening][0]();
    await p;

    const responsePromise = udpClient.sendAndWait(Buffer.from("test"), {
      port: 1234,
      timeout: 50,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    const response = await responsePromise;
    expect(response).toEqual({});
    await udpClient.stop();
  });

  it("should return port after binding", async () => {
    const p = udpClient.start();
    const sock = sockets[0];
    sock.address.mockReturnValue({ port: 54321 });
    sock._listeners[NetworkEvent.Listening][0]();
    await p;

    expect(udpClient.getPort()).toBe(54321);
    await udpClient.stop();
  });
});
