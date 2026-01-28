import * as net from "net";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NetworkEvent } from "../../network/network-events";
import { ServerState } from "../../types/basal-protocol";
import { TcpServer } from "../../network/tcp-server";
import { ConfigManager } from "../../common/config";
import { LoggerManager } from "../../common/logger";
import { sleep } from "../../common/abort-aware";

vi.mock("net");

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

    const mockConfigManager = {
      getCoreConfig: () => ({
        tcp_address: "127.0.0.1",
        tcp_port: 0,
        retry_interval: retryInterval,
        retry_max: 2,
        service_name: "test-tcp",
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

    mockServer = {
      listen: vi.fn().mockReturnThis(),
      close: vi.fn((cb) => cb?.()),
      address: vi.fn().mockReturnValue({ port: 4567 }),
      once: vi.fn((e, cb) => (serverEvents[e] = cb)),
      on: vi.fn((e, cb) => (serverEvents[e] = cb)),
      off: vi.fn(),
    };

    vi.mocked(net.createServer).mockReturnValue(mockServer);
    tcpServer = new TcpServer(mockConfigManager, mockLoggerManager);
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

    await new Promise((r) => setTimeout(r, 0));

    (tcpServer as any).abortController.abort();
    serverEvents[NetworkEvent.Close]?.();

    await expect(startPromise).resolves.toBeUndefined();
    expect(tcpServer.getState()).toBe(ServerState.Stopped);
  });

  it("non-retryable error goes to Error state", async () => {
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
    const spyData = vi.fn();
    tcpServer.on(NetworkEvent.Data, spyData);

    (tcpServer as any).handleConnection(mockSocket);

    socketEvents[NetworkEvent.Data](Buffer.from("hi"));
    expect(spyData).toHaveBeenCalled();

    const spyError = vi.fn();
    tcpServer.on(NetworkEvent.Error, spyError);
    socketEvents[NetworkEvent.Error](new Error("boom"));
    expect(mockSocket.destroy).toHaveBeenCalled();
    expect(spyError).toHaveBeenCalled();

    socketEvents[NetworkEvent.Close](true);
  });

  it("start() should be idempotent when already running", async () => {
    const p = tcpServer.start();
    serverEvents[NetworkEvent.Listening]();
    await p;

    await tcpServer.start();

    expect(tcpServer.getState()).toBe(ServerState.Listening);
  });

  it("start() should be idempotent when not in Stopped state", async () => {
    const p = tcpServer.start();
    serverEvents[NetworkEvent.Listening]();
    await p;

    await tcpServer.start();

    expect(tcpServer.getState()).toBe(ServerState.Listening);
  });

  it("address() returning null should not crash", async () => {
    mockServer.address.mockReturnValue(null);

    const p = tcpServer.start();
    serverEvents[NetworkEvent.Listening]();
    await p;

    expect(tcpServer.getPort()).toBe(0);
  });

  it("address() returning null should skip ephemeral port update", async () => {
    mockServer.address.mockReturnValue(null);

    const p = tcpServer.start();
    serverEvents[NetworkEvent.Listening]();
    await p;

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

  it("should abort attemptListen immediately if server is stopped", async () => {
    expect(tcpServer.getState()).toBe(ServerState.Stopped);

    const promise = (tcpServer as any).attemptListen();

    await expect(promise).rejects.toThrow("Aborted");
  });

  it("should handle synchronous errors inside attemptListen", async () => {
    const syncError = new Error("Synchronous startup failure");

    mockServer.listen.mockImplementation(() => {
      throw syncError;
    });

    const startPromise = tcpServer.start();

    await expect(startPromise).rejects.toThrow("Synchronous startup failure");

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

  it("should forcefully destroy active connections on stop", async () => {
    const startPromise = tcpServer.start();
    serverEvents[NetworkEvent.Listening]();
    await startPromise;

    const socket1 = createMockSocket();
    const socket2 = createMockSocket();

    (tcpServer as any).handleConnection(socket1);
    (tcpServer as any).handleConnection(socket2);

    await tcpServer.stop();

    expect(socket1.destroy).toHaveBeenCalled();
    expect(socket2.destroy).toHaveBeenCalled();
    expect(mockServer.close).toHaveBeenCalled();
  });

  it("should stop tracking connections when they close naturally", async () => {
    const startPromise = tcpServer.start();
    serverEvents[NetworkEvent.Listening]();
    await startPromise;

    const socket = createMockSocket();
    (tcpServer as any).handleConnection(socket);

    const closeListener = socketEvents["close"];
    if (closeListener) {
      closeListener();
    } else {
      socket.emit("close");
    }

    await tcpServer.stop();

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

    expect(aliveSocket.destroy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ error: boom }),
    );
  });

  it("socket already destroyed branch", () => {
    const errorSpy = vi.fn();
    tcpServer.on(NetworkEvent.Error, errorSpy);

    const destroyedSocket = {
      ...mockSocket,
      destroyed: true,
    };

    (tcpServer as any).handleConnection(destroyedSocket);

    const boom = new Error("boom");
    socketEvents[NetworkEvent.Error](boom);

    expect(destroyedSocket.destroy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ error: boom }),
    );
  });

  it("should accept custom name parameter", () => {
    const localMockConfigManager = {
      getCoreConfig: () => ({
        tcp_address: "127.0.0.1",
        tcp_port: 0,
        retry_interval: retryInterval,
        retry_max: 2,
        service_name: "test-tcp",
      }),
    } as unknown as ConfigManager;

    const localMockLoggerManager = {
      getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    } as unknown as LoggerManager;

    const namedServer = new TcpServer(
      localMockConfigManager,
      localMockLoggerManager,
      "my-custom-server",
    );
    expect((namedServer as any).name).toBe("my-custom-server");
  });

  it("should use default name when not provided", () => {
    const localMockConfigManager = {
      getCoreConfig: () => ({
        tcp_address: "127.0.0.1",
        tcp_port: 0,
        retry_interval: retryInterval,
        retry_max: 2,
        service_name: "test-tcp",
      }),
    } as unknown as ConfigManager;

    const localMockLoggerManager = {
      getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    } as unknown as LoggerManager;

    const defaultServer = new TcpServer(
      localMockConfigManager,
      localMockLoggerManager,
    );
    expect((defaultServer as any).name).toBe("tcp-server");
  });
});
