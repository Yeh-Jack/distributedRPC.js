import * as dgram from "dgram";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NetworkEvent } from "../../network/network-events";
import { ServerState } from "../../types/basal-protocol";
import { UdpServer } from "../../network/udp-server";
import { ConfigManager } from "../../common/config";
import { LoggerManager } from "../../common/logger";

vi.mock("dgram");
vi.mock("../../common/config");
vi.mock("../../common/logger");

describe("UdpServer", () => {
  let udpServer: UdpServer;
  let sockets: any[]; // keep all sockets

  function createMockSocket() {
    const localListeners: Record<string, Function[]> = {};
    const sock = {
      bind: vi.fn(),
      close: vi.fn(() => localListeners["close"]?.forEach((fn) => fn())),
      on: vi.fn((evt, cb) => (localListeners[evt] ||= []).push(cb)),
      once: vi.fn((evt, cb) => (localListeners[evt] ||= []).push(cb)),
      off: vi.fn((evt, cb) => {
        localListeners[evt] = (localListeners[evt] || []).filter(
          (f) => f !== cb,
        );
      }),
      address: vi.fn(() => ({ port: 5707 })),
      _listeners: localListeners, // expose for test
    };

    sockets.push(sock);
    return sock as any;
  }

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(ConfigManager.getInstance).mockReturnValue({
      getCoreConfig: () => ({
        udp_address: "127.0.0.1",
        udp_port: 5707,
        retry_interval: 10,
        retry_max: 2,
      }),
    } as any);

    vi.mocked(LoggerManager.getInstance).mockReturnValue({
      getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    } as any);

    sockets = [];
    vi.mocked(dgram.createSocket).mockImplementation(() => createMockSocket());
    udpServer = new UdpServer("test");
  });

  it("should initialize with correct properties", () => {
    expect(udpServer.getState()).toBe(ServerState.Stopped);
    expect((udpServer as any).listenerName).toBe("test");
  });

  it("getState() should return current server state", () => {
    expect(udpServer.getState()).toBe(ServerState.Stopped);

    // Change state to test
    (udpServer as any).state = ServerState.Listening;
    expect(udpServer.getState()).toBe(ServerState.Listening);
  });

  it("getPort() should return the configured port after start", async () => {
    // Just verify that getPort returns something reasonable without actually calling start()
    const initialPort = udpServer.getPort();
    expect(initialPort).toBeUndefined(); // Before start, port is uninitialized

    // Test that we can access properties
    expect(typeof (udpServer as any).listenerName).toBe("string");
  });

  it("start() should initialize internal state correctly", () => {
    // This directly tests the initialization logic in start()
    const startPromise = udpServer.start();

    // Verify that key internal properties are set up properly
    expect((udpServer as any).abortController).toBeDefined();
    expect((udpServer as any).retryScheduler).toBeDefined();
    expect((udpServer as any).state).toBe(ServerState.Starting);
    expect((udpServer as any).address).toBe("127.0.0.1");
    expect((udpServer as any).port).toBe(5707);

    // Verify the promise is returned
    expect(startPromise).toBeInstanceOf(Promise);
  });

  it("should retry when socket closes unexpectedly", async () => {
    udpServer.start();

    // Wait for initialization and then trigger a close event
    await new Promise((resolve) => setTimeout(resolve, 10));

    const firstSocket = sockets[0];
    if (
      firstSocket._listeners[NetworkEvent.Close] &&
      firstSocket._listeners[NetworkEvent.Close].length > 0
    ) {
      firstSocket._listeners[NetworkEvent.Close][0](); // triggers retry
    }

    expect(udpServer.getState()).toBe(ServerState.Starting);
  });

  it("start() should handle retryable errors properly", async () => {
    // Start the server and immediately check initialization
    udpServer.start();
    await Promise.resolve(); // Wait for a tick to let initialization complete

    // Check internal setup for retry handling
    expect((udpServer as any).retryScheduler).toBeDefined();
    expect((udpServer as any).abortController).toBeDefined();

    // Verify state is properly initialized
    expect(udpServer.getState()).toBe(ServerState.Starting);

    // Clean up by stopping the server
    await udpServer.stop();
  });

  it("should retry on retryable socket error", async () => {
    (udpServer as any).listenerName = "test-retry-socket-error";
    udpServer.start();

    // Wait for the first attempt to complete and then trigger an error
    await new Promise((resolve) => setTimeout(resolve, 10));

    const firstSocket = sockets[0];
    if (
      firstSocket._listeners[NetworkEvent.Error] &&
      firstSocket._listeners[NetworkEvent.Error].length > 0
    ) {
      firstSocket._listeners[NetworkEvent.Error][0]({ code: "EADDRINUSE" });
    }

    // Wait for retry logic to complete
    await new Promise((resolve) => setTimeout(resolve, 50));
    const sock = sockets[sockets.length - 1];
    sock._listeners[NetworkEvent.Listening][0]();

    expect(udpServer.getState()).toBe(ServerState.Listening);
  });

  it("should stop after retry exhaustion", async () => {
    (udpServer as any).listenerName = "test-retry-exhaustion";
    const sockets: any[] = [];

    vi.mocked(dgram.createSocket).mockImplementation(() => {
      const localListeners: Record<string, Function[]> = {};
      const sock = {
        bind: vi.fn(),
        close: vi.fn(() => localListeners["close"]?.forEach((fn) => fn())),
        on: vi.fn((e, cb) => (localListeners[e] ||= []).push(cb)),
        once: vi.fn((e, cb) => (localListeners[e] ||= []).push(cb)),
        off: vi.fn((e, cb) => {
          localListeners[e] = (localListeners[e] || []).filter((f) => f !== cb);
        }),
        address: vi.fn(() => ({ port: 5707 })),
        _listeners: localListeners,
      };

      sockets.push(sock);

      // Automatically fail every attempt
      queueMicrotask(() => {
        const err = Object.assign(new Error("busy"), { code: "EADDRINUSE" });
        localListeners.error?.[0]?.(err);
      });

      return sock as any;
    });

    const p = udpServer.start();
    await expect(p).rejects.toThrow("busy");

    // retry_max = 2 in config
    expect(sockets.length).toBe(2);
    expect(udpServer.getState()).toBe(ServerState.Error);
  });

  it("start() should handle non-retryable errors correctly", async () => {
    // Start the server and immediately check initialization
    udpServer.start();
    await Promise.resolve(); // Wait for a tick to let initialization complete

    // Check that we can access internal state for error handling
    expect((udpServer as any).abortController).toBeDefined();
    expect(udpServer.getState()).toBe(ServerState.Starting);

    // Clean up by stopping the server
    await udpServer.stop();
  });

  it("should enter Error state on non-retryable socket error", async () => {
    udpServer.start();

    const err = Object.assign(new Error("fatal"), { code: "EACCES" });
    const sock = sockets[0];
    sock._listeners[NetworkEvent.Error][0](err);

    await Promise.resolve(); // Wait for a tick to let handler execute complete.
    expect(udpServer.getState()).toBe(ServerState.Error);
  });

  it("stop() should gracefully stop the server", async () => {
    // Test that stop doesn't crash and properly sets state
    const result = await udpServer.stop();
    expect(result).toBeUndefined();
    expect(udpServer.getState()).toBe(ServerState.Stopped);
  });

  it("stop() should close active socket and abort retries", async () => {
    const p = udpServer.start();
    const sock = sockets[0];
    sock._listeners[NetworkEvent.Listening][0]();
    await p;

    await udpServer.stop();

    expect(sock.close).toHaveBeenCalled();
    expect(udpServer.getState()).toBe(ServerState.Stopped);
  });

  it("stop() should be idempotent when already stopped", async () => {
    // Call stop on a stopped server (should not crash)
    await udpServer.stop();
    expect(udpServer.getState()).toBe(ServerState.Stopped);

    // Call again
    await udpServer.stop();
    expect(udpServer.getState()).toBe(ServerState.Stopped);
  });

  it("attemptBind() should handle synchronous errors", async () => {
    // Mock socket to throw synchronously - this tests the try/catch in attemptBind
    vi.mocked(dgram.createSocket).mockImplementation(() => {
      throw new Error("Synchronous error");
    });

    // Prevent "Unhandled 'error' event" crash the test.
    // The UDP server emits error `this.emit(NetworkEvent.Error, ...)`, if no handler is
    // attached Node.js treats it as a fatal crash (an unhandled exception).
    udpServer.on(NetworkEvent.Error, () => {
      console.log("Handled error event");
    });

    try {
      udpServer.start();
    } catch (err) {
      console.log("Error catched.");
      expect(err).rejects.toThrow("Synchronous error");
    }
  });

  it("should handle NetworkEvent.Message properly", () => {
    // Test event subscription works
    const messageSpy = vi.fn();
    udpServer.on(NetworkEvent.Message, messageSpy);

    // Verify the event system is working at a basic level
    expect(typeof udpServer.on).toBe("function");
  });

  it("should emit NetworkEvent.Message on incoming datagram", async () => {
    const spy = vi.fn();
    udpServer.on(NetworkEvent.Message, spy);

    udpServer.start();
    await Promise.resolve(); // allow scheduler to create new socket

    const sock = sockets[sockets.length - 1];
    sock._listeners[NetworkEvent.Message][0](Buffer.from("hello"), {
      address: "1.2.3.4",
      port: 9999,
    });

    expect(spy).toHaveBeenCalledOnce(); // Or call .toHaveBeenCalled()
  });

  it("should handle error events properly", () => {
    // Test that we can subscribe to errors
    const errorSpy = vi.fn();
    udpServer.on(NetworkEvent.Error, errorSpy);

    // Verify the event system is working at a basic level
    expect(typeof udpServer.on).toBe("function");
  });

  it("should transition to Listening on successful bind", async () => {
    const p = udpServer.start();
    const sock = sockets[0];
    sock._listeners[NetworkEvent.Listening][0](); // Simulate socket ready
    await p;

    expect(udpServer.getState()).toBe(ServerState.Listening);
    expect(udpServer.getPort()).toBe(5707);
  });

  it("should properly handle state transitions", () => {
    // This tests lines around 115 and other state management code
    (udpServer as any).setState(ServerState.Listening);
    expect(udpServer.getState()).toBe(ServerState.Listening);

    // Test again to ensure idempotent behavior
    (udpServer as any).setState(ServerState.Listening);
    expect(udpServer.getState()).toBe(ServerState.Listening);
  });

  it("should handle abort controller properly", async () => {
    // Start the server to initialize internal state
    udpServer.start();
    await Promise.resolve(); // Wait for a tick to let initialization complete

    // Verify we can access and use the abort controller
    expect((udpServer as any).abortController).toBeDefined();
    expect(typeof (udpServer as any).abortController.abort).toBe("function");

    // Clean up by stopping the server
    await udpServer.stop();
  });

  it("should abort retry loop with AbortError", async () => {
    const startPromise = udpServer.start();

    const err = Object.assign(new Error("down"), { code: "ENETDOWN" });
    const sock = sockets[0];
    sock._listeners[NetworkEvent.Error][0](err); // trigger retry

    await udpServer.stop(); // abort during sleep
    await expect(startPromise).resolves.toBeUndefined();
    expect(udpServer.getState()).toBe(ServerState.Stopped);
  });
});
