import * as net from "net";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NetworkEvent } from "../../network/network-events";
import { ServerState } from "../../types/basal-protocol";
import { TcpServer } from "../../network/tcp-server";
import { ConfigManager } from "../../common/config";
import { LoggerManager } from "../../common/logger";
import { sleep, isAbortError } from "../../common/abort-aware";

vi.mock("net");
vi.mock("../../common/config");
vi.mock("../../common/logger");

describe("TcpServer full coverage", () => {
  let tcpServer: TcpServer;
  let mockServer: any;
  let serverEvents: Record<string, Function>;
  let socketEvents: Record<string, Function>;
  const retryInterval = 10;

  const mockSocket = {
    remoteAddress: "127.0.0.1",
    remotePort: 1111,
    on: vi.fn((e, cb) => (socketEvents[e] = cb)),
    write: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
  };

  // Helper to create a fully mocked Net Socket
  const createMockSocket = () => {
    // We create a local event map for this specific socket instance
    // to allow multiple sockets to exist independently in the same test.
    const localEvents: Record<string, Function> = {};

    return {
      remoteAddress: "127.0.0.1",
      remotePort: 54321,
      // Store event listeners so we can trigger them manually
      on: vi.fn((event, cb) => {
        localEvents[event] = cb;
        // Also update the global/shared socketEvents for backward compatibility
        // with tests that rely on the single 'socketEvents' variable
        socketEvents[event] = cb;
        return this;
      }),
      once: vi.fn((event, cb) => {
        localEvents[event] = cb;
        return this;
      }),
      // Trigger an event manually on this socket
      emit: vi.fn((event, ...args) => {
        if (localEvents[event]) {
          localEvents[event](...args);
        }
      }),
      write: vi.fn().mockReturnValue(true),
      off: vi.fn(),
      destroy: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      end: vi.fn(),
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    serverEvents = {};
    socketEvents = {};

    vi.mocked(ConfigManager.getInstance).mockReturnValue({
      getCoreConfig: () => ({
        tcp_address: "127.0.0.1",
        tcp_port: 0,
        retry_interval: retryInterval,
        retry_max: 2,
      }),
    } as any);

    vi.mocked(LoggerManager.getInstance).mockReturnValue({
      getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    } as any);

    mockServer = {
      listen: vi.fn().mockReturnThis(),
      close: vi.fn((cb) => cb?.()),
      address: vi.fn().mockReturnValue({ port: 4567 }),
      once: vi.fn((e, cb) => (serverEvents[e] = cb)),
      on: vi.fn((e, cb) => (serverEvents[e] = cb)),
      off: vi.fn(),
    };

    vi.mocked(net.createServer).mockReturnValue(mockServer);
    tcpServer = new TcpServer("test");
  });

  it("start → listen → stop (normal path)", async () => {
    const p = tcpServer.start();
    serverEvents[NetworkEvent.Listening]();
    await p;

    expect(tcpServer.getState()).toBe(ServerState.Listening);
    expect(tcpServer.getPort()).toBe(4567);

    await tcpServer.stop();
    expect(tcpServer.getState()).toBe(ServerState.Stopped);
  });

  it("unexpected close triggers retry path", async () => {
    const p = tcpServer.start();
    serverEvents[NetworkEvent.Listening]();
    await p;

    serverEvents[NetworkEvent.Close]();
    expect(tcpServer.getState()).not.toBe(ServerState.Stopped);
  });

  it("abort during start", async () => {
    const startPromise = tcpServer.start();

    // Ensure listeners are attached
    await new Promise((r) => setTimeout(r, 0));

    // Simulate abort path inside attemptListen()
    (tcpServer as any).abortController.abort();

    // Force attemptListen to exit by closing server
    serverEvents[NetworkEvent.Close]?.();

    await expect(startPromise).resolves.toBeUndefined();
    expect(tcpServer.getState()).toBe(ServerState.Stopped);
  });

  it("non-retryable error goes to Error state", async () => {
    // Make every listen immediately emit a fatal error
    mockServer.listen.mockImplementation(() => {
      setTimeout(() => {
        serverEvents[NetworkEvent.Error]?.({
          code: "EACCES",
          message: "permission denied",
        });
      }, 0);
      return mockServer;
    });

    const errorSpy = vi.fn();
    tcpServer.on(NetworkEvent.Error, errorSpy);

    const startPromise = tcpServer.start();

    await expect(startPromise).rejects.toBeDefined();
    expect(tcpServer.getState()).toBe(ServerState.Error);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("retryable error then success", async () => {
    const p = tcpServer.start();
    serverEvents[NetworkEvent.Error]({ code: "EADDRINUSE" });

    await sleep(retryInterval * 2);
    serverEvents[NetworkEvent.Listening]();

    await p;
    expect(tcpServer.getState()).toBe(ServerState.Listening);
  });

  it("retry exhausted path", async () => {
    mockServer.listen.mockImplementation(() => {
      setTimeout(() => {
        serverEvents[NetworkEvent.Error]?.({ code: "EADDRINUSE" });
      }, 1);
      return mockServer;
    });

    tcpServer.on(NetworkEvent.Error, () => {});
    await expect(tcpServer.start()).rejects.toBeDefined();
    expect(tcpServer.getState()).toBe(ServerState.Error);
  });

  it("handleConnection full branch coverage", () => {
    const spy = vi.fn();
    tcpServer.on(NetworkEvent.Error, spy);

    (tcpServer as any).handleConnection(mockSocket);

    socketEvents[NetworkEvent.Data](Buffer.from("hi"));
    expect(mockSocket.write).toHaveBeenCalledWith("Echo: hi");

    socketEvents[NetworkEvent.Error](new Error("boom"));
    expect(mockSocket.destroy).toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();

    socketEvents[NetworkEvent.Close](true);
  });

  it("start() should be idempotent when already running", async () => {
    const p = tcpServer.start();
    serverEvents[NetworkEvent.Listening]();
    await p;

    // Second call must hit: if (this.state !== Stopped) return;
    await tcpServer.start();

    expect(tcpServer.getState()).toBe(ServerState.Listening);
  });

  it("start() should be idempotent when not in Stopped state", async () => {
    const p = tcpServer.start();
    serverEvents[NetworkEvent.Listening]();
    await p;

    // Hits: if (this.state !== ServerState.Stopped) return;
    await tcpServer.start();

    expect(tcpServer.getState()).toBe(ServerState.Listening);
  });

  it("address() returning null should not crash", async () => {
    mockServer.address.mockReturnValue(null);

    const p = tcpServer.start();
    serverEvents[NetworkEvent.Listening]();
    await p;

    // Port should remain configured when address() is null
    expect(tcpServer.getPort()).toBe(0);
  });

  it("address() returning null should skip ephemeral port update", async () => {
    mockServer.address.mockReturnValue(null);

    const p = tcpServer.start();
    serverEvents[NetworkEvent.Listening]();
    await p;

    // Port remains from config (0)
    expect(tcpServer.getPort()).toBe(0);
  });

  it("address() returning pipe string should skip object branch", async () => {
    mockServer.address.mockReturnValue("pipe:/tmp/test.sock");

    const p = tcpServer.start();
    serverEvents[NetworkEvent.Listening]();
    await p;

    expect(tcpServer.getPort()).toBe(0);
  });

  it("default internal error handler should be exercised", () => {
    const err = new Error("internal");
    tcpServer.emit(ServerState.Error, { error: err });
  });

  it("should abort attemptListen immediately if server is stopped (Guard Clause)", async () => {
    // 1. Ensure the server is in the 'Stopped' state (default state)
    expect(tcpServer.getState()).toBe(ServerState.Stopped);

    // 2. Access the private method directly
    // This simulates a scenario where a retry might trigger after the server was stopped
    const promise = (tcpServer as any).attemptListen();

    // 3. Verify it rejects with the specific "Aborted" error from the if-block
    await expect(promise).rejects.toThrow("Aborted");
  });

  it("should handle synchronous errors inside attemptListen (catch block)", async () => {
    const syncError = new Error("Synchronous startup failure");

    // 1. Force the server.listen call to throw synchronously
    // This triggers the 'catch (err)' block inside the Promise executor
    mockServer.listen.mockImplementation(() => {
      throw syncError;
    });

    // 2. call start()
    const startPromise = tcpServer.start();

    // 3. Verify it rejects with the specific error
    await expect(startPromise).rejects.toThrow("Synchronous startup failure");

    // 4. Verify the state transition in the catch block
    expect(tcpServer.getState()).toBe(ServerState.Error);
  });

  it("NetworkEvent.Listening is emitted and observable", async () => {
    const spy = vi.fn();
    tcpServer.on(NetworkEvent.Listening, spy);

    const p = tcpServer.start();
    serverEvents[NetworkEvent.Listening]();
    await p;

    expect(spy).toHaveBeenCalled();
  });

  // --- Graceful Shutdown Tests ---

  it("should forcefully destroy active connections on stop", async () => {
    // 1. Start Server
    const startPromise = tcpServer.start();
    serverEvents[NetworkEvent.Listening]();
    await startPromise;

    // 2. Simulate multiple client connections
    const socket1 = createMockSocket();
    const socket2 = createMockSocket();

    // Trigger connection handling manually since we are mocking net.createServer
    (tcpServer as any).handleConnection(socket1);
    (tcpServer as any).handleConnection(socket2);

    // 3. Stop Server
    // This should close the server AND destroy tracked sockets
    await tcpServer.stop();

    // 4. Verify sockets were destroyed
    expect(socket1.destroy).toHaveBeenCalled();
    expect(socket2.destroy).toHaveBeenCalled();

    // 5. Verify server close was called
    expect(mockServer.close).toHaveBeenCalled();
  });

  it("should stop tracking connections when they close naturally (Memory Leak Prevention)", async () => {
    // 1. Start Server
    const startPromise = tcpServer.start();
    serverEvents[NetworkEvent.Listening]();
    await startPromise;

    const socket = createMockSocket();
    (tcpServer as any).handleConnection(socket);

    // 2. Simulate the socket closing naturally (client disconnects)
    // We assume your handleConnection logic adds a 'close' listener to the socket
    // We trigger that specific listener here.
    const closeListener = socketEvents["close"];
    if (closeListener) {
      closeListener();
    } else {
      // Fallback if your mock setup works differently,
      // essentially we need to fire the event that removes it from the Set
      socket.emit("close");
    }

    // 3. Stop Server
    await tcpServer.stop();

    // 4. Verify destroy() was NOT called
    // Since the socket closed naturally, it should have been removed from the Set.
    // Therefore, stop() should not try to destroy it again.
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  it("socket destroy branch when socket is not yet destroyed", () => {
    const errorSpy = vi.fn();
    tcpServer.on(NetworkEvent.Error, errorSpy);

    const aliveSocket = {
      ...mockSocket,
      destroyed: false,
    };

    (tcpServer as any).handleConnection(aliveSocket);

    const boom = new Error("boom");
    socketEvents[NetworkEvent.Error](boom);

    // Covers: if (!socket.destroyed) socket.destroy();
    expect(aliveSocket.destroy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ error: boom })
    );
  });

  it("socket already destroyed branch", () => {
    // Prevent unhandled 'error' event
    const errorSpy = vi.fn();
    tcpServer.on(NetworkEvent.Error, errorSpy);

    const destroyedSocket = {
      ...mockSocket,
      destroyed: true,
    };

    (tcpServer as any).handleConnection(destroyedSocket);

    const boom = new Error("boom");
    socketEvents[NetworkEvent.Error](boom);

    // destroy() must NOT be called again when already destroyed
    expect(destroyedSocket.destroy).not.toHaveBeenCalled();

    // Error event still emitted
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ error: boom })
    );
  });
});

describe("abort-aware full coverage", () => {
  it("sleep resolves normally", async () => {
    await sleep(1);
  });

  it("sleep aborts", async () => {
    const ac = new AbortController();
    const p = sleep(50, ac.signal);
    ac.abort();
    await expect(p).rejects.toThrow(DOMException);
  });

  it("isAbortError branches", () => {
    expect(isAbortError(new DOMException("x", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("x"))).toBe(false);
  });
});
