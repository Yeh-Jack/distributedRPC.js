import "reflect-metadata";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BroadcastUdpServer } from "../../network/broadcast-udp-server";
import { ConfigManager } from "../../common/config";
import { LoggerManager } from "../../common/logger";
import { ServerState } from "../../types/basal-protocol";

describe("BroadcastUdpServer", () => {
  let server: BroadcastUdpServer;
  let mockConfigManager: ConfigManager;
  let mockLoggerManager: LoggerManager;
  let mockLogger: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfigManager = {
      getCoreConfig: () => ({
        tcp_address: "127.0.0.1",
        tcp_port: 0,
        udp_address: "127.0.0.1",
        udp_port: 0,
        retry_interval: 10,
        retry_max: 2,
        service_name: "test-broadcast",
      }),
    } as unknown as ConfigManager;

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    mockLoggerManager = {
      getLogger: () => mockLogger,
    } as unknown as LoggerManager;

    server = new BroadcastUdpServer(
      mockConfigManager,
      mockLoggerManager,
      "test-broadcast",
    );
  });

  describe("constructor", () => {
    it("should create instance with default name", () => {
      const defaultServer = new BroadcastUdpServer(
        mockConfigManager,
        mockLoggerManager,
      );
      expect(defaultServer.name).toBe("broadcast-udp-server");
    });

    it("should create instance with custom name", () => {
      expect(server.name).toBe("test-broadcast");
    });

    it("should initialize with Stopped state", () => {
      expect(server.getState()).toBe(ServerState.Stopped);
    });
  });

  describe("getPort", () => {
    it("should return undefined before start", () => {
      expect(server.getPort()).toBeUndefined();
    });
  });

  describe("setManagerInfo", () => {
    it("should set manager info correctly", () => {
      const mockInfo = {
        manager: {} as any,
      };

      server.setManagerInfo(mockInfo);
      expect((server as any).managerInfo).toBe(mockInfo);
    });
  });

  describe("start", () => {
    it("should throw error when manager info is not set before start", async () => {
      await expect(server.start()).rejects.toThrow(
        `Information missing for the <test-broadcast> broadcast server.`,
      );
    });
  });

  describe("stop", () => {
    it("should properly stop the server and reset manager info", async () => {
      const mockInfo = {
        manager: {} as any,
      };

      server.setManagerInfo(mockInfo);
      await server.stop();

      expect((server as any).managerInfo).toBeUndefined();
    });
  });

  describe("handleMessage", () => {
    it("should ignore messages that are not the PROBE_MESSAGE", () => {
      const mockSocket = {
        send: vi.fn(),
      };

      // Mock socket and state
      (server as any).socket = mockSocket;
      (server as any).state = ServerState.Listening;

      const mockInfo = {
        manager: {} as any,
      };

      server.setManagerInfo(mockInfo);

      // Call with non-probe message
      expect(() => {
        server["handleMessage"](Buffer.from("not-a-probe-message"), {
          address: "127.0.0.1",
          port: 54321,
          family: "IPv4",
          size: 20,
        });
      }).not.toThrow();
    });

    it("should handle valid probe messages correctly", () => {
      const mockSocket = {
        send: vi.fn(),
      };

      // Mock socket and state
      (server as any).socket = mockSocket;
      (server as any).state = ServerState.Listening;

      const mockInfo = {
        manager: {} as any,
      };

      server.setManagerInfo(mockInfo);

      // Call with probe message - should not throw error
      expect(() => {
        server["handleMessage"](Buffer.from("Bonjour and EnjoIT."), {
          address: "127.0.0.1",
          port: 54321,
          family: "IPv4",
          size: 20,
        });
      }).not.toThrow();
    });

    it("should log error when trying to respond without a socket", () => {
      // Mock state but no socket
      (server as any).state = ServerState.Listening;

      const mockInfo = {
        manager: {} as any,
      };

      server.setManagerInfo(mockInfo);

      expect(() => {
        server["handleMessage"](Buffer.from("Bonjour and EnjoIT."), {
          address: "127.0.0.1",
          port: 54321,
          family: "IPv4",
          size: 20,
        });
      }).toThrow(/The <test-broadcast> broadcast server not running/);
    });

    it("should log error when trying to respond with non-listening state", () => {
      // Mock socket but wrong state
      const mockSocket = {
        send: vi.fn(),
      };

      (server as any).socket = mockSocket;
      (server as any).state = ServerState.Stopped; // Not listening

      const mockInfo = {
        manager: {} as any,
      };

      server.setManagerInfo(mockInfo);

      expect(() => {
        server["handleMessage"](Buffer.from("Bonjour and EnjoIT."), {
          address: "127.0.0.1",
          port: 54321,
          family: "IPv4",
          size: 20,
        });
      }).toThrow(/The <test-broadcast> broadcast server not running/);
    });
  });
});
