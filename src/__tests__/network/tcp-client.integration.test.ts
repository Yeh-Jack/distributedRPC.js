import * as net from "net";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AccessPoint, NetworkProtocol, ExecutionState } from "../../types/basal-protocol";
import { TcpClient } from "../../network/tcp-client";

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
  retryAttempts: { add: vi.fn() },
  retryDuration: { record: vi.fn() },
  executionTime: { record: vi.fn() },
  serverState: { observe: vi.fn() },
  listenerState: { observe: vi.fn() },
  udpBroadcastLatency: { record: vi.fn() },
  udpBroadcastRequests: { add: vi.fn() },
  udpBroadcastResponses: { add: vi.fn() },
  OtelProviderState: class {},
  OtelMeterics: class {
    getMeter() { return {}; }
  },
}));

describe("TcpClient Integration with Real Sockets", () => {
  let server: net.Server;
  let serverPort: number;
  let serverHost: string;
  let connectedSocket: net.Socket | null;
  let client: TcpClient;

  const createTestConfig = () => ({
    getCoreConfig: () => ({
      net: {
        tcp: {
          address: "127.0.0.1",
          port: 0,
          client: {
            timeout: 5000,
            keep_alive: false,
            keep_alive_initial_delay: 0,
          },
        },
        udp: {
          address: "127.0.0.1",
          port: 9999,
        },
      },
      retry: {
        interval: 50,
        max_try: 3,
        backoff: { enable: true, max_delay: 1000, multiplier: 1.5 },
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
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    connectedSocket = null;
    serverPort = 0;
    serverHost = "127.0.0.1";

    server = net.createServer((socket) => {
      connectedSocket = socket;
    });

    await new Promise<void>((resolve) => {
      server.listen(0, serverHost, () => {
        const addr = server.address();
        if (addr && typeof addr !== "string") {
          serverPort = addr.port;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (client) {
      try {
        await client.stop();
      } catch {}
    }
    if (connectedSocket) {
      connectedSocket.destroy();
      connectedSocket = null;
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe("start() - connect to real TCP server", () => {
    it("should connect to a real TCP server and transition to Running state", async () => {
      const accessPoint: AccessPoint = {
        address: serverHost,
        port: serverPort,
        protocol: NetworkProtocol.TCP,
        authorization: "",
        function: [],
      };

      client = new TcpClient(createTestConfig() as any, accessPoint, "test-client");

      await client.start();

      expect(client.getState()).toBe(ExecutionState.Running);
      connectedSocket?.destroy();
    });

    it("should emit connection events", async () => {
      const accessPoint: AccessPoint = {
        address: serverHost,
        port: serverPort,
        protocol: NetworkProtocol.TCP,
        authorization: "",
        function: [],
      };

      client = new TcpClient(createTestConfig() as any, accessPoint, "test-client");

      await client.start();

      expect(client.getState()).toBe(ExecutionState.Running);
    });
  });

  describe("stop() - disconnect from real TCP server", () => {
    it("should disconnect from server and transition to Stopped state", async () => {
      const accessPoint: AccessPoint = {
        address: serverHost,
        port: serverPort,
        protocol: NetworkProtocol.TCP,
        authorization: "",
        function: [],
      };

      client = new TcpClient(createTestConfig() as any, accessPoint, "test-client");

      await client.start();
      await client.stop();

      expect(client.getState()).toBe(ExecutionState.Stopped);
    });

    it("should handle stop when not connected", async () => {
      const accessPoint: AccessPoint = {
        address: serverHost,
        port: serverPort,
        protocol: NetworkProtocol.TCP,
        authorization: "",
        function: [],
      };

      client = new TcpClient(createTestConfig() as any, accessPoint, "test-client");

      await client.stop();

      expect(client.getState()).toBe(ExecutionState.Stopped);
    });
  });

  describe("write() - send data to real server", () => {
    it("should write data to real server and receive it", async () => {
      const accessPoint: AccessPoint = {
        address: serverHost,
        port: serverPort,
        protocol: NetworkProtocol.TCP,
        authorization: "",
        function: [],
      };

      client = new TcpClient(createTestConfig() as any, accessPoint, "test-client");

      await client.start();

      const receivedData = await new Promise<Buffer>((resolve) => {
        connectedSocket?.on("data", (data) => {
          resolve(data);
        });

        client.write(Buffer.from("Hello Server"));
      });

      expect(receivedData.toString()).toBe("Hello Server");
    });

    it("should write string data to real server", async () => {
      const accessPoint: AccessPoint = {
        address: serverHost,
        port: serverPort,
        protocol: NetworkProtocol.TCP,
        authorization: "",
        function: [],
      };

      client = new TcpClient(createTestConfig() as any, accessPoint, "test-client");

      await client.start();

      const receivedData = await new Promise<Buffer>((resolve) => {
        connectedSocket?.on("data", (data) => {
          resolve(data);
        });

        client.write("Hello String Server");
      });

      expect(receivedData.toString()).toBe("Hello String Server");
    });
  });

  describe("sendMessage() - send JSON message to real server", () => {
    it("should send JSON message to real server", async () => {
      const accessPoint: AccessPoint = {
        address: serverHost,
        port: serverPort,
        protocol: NetworkProtocol.TCP,
        authorization: "",
        function: [],
      };

      client = new TcpClient(createTestConfig() as any, accessPoint, "test-client");

      await client.start();

      const receivedData = await new Promise<string>((resolve) => {
        connectedSocket?.on("data", (data) => {
          resolve(data.toString());
        });

        client.sendMessage({
          peer: { service: "test", instance: "123" },
          api: "testApi",
          args: { value: 42 },
        });
      });

      const message = JSON.parse(receivedData);
      expect(message.api).toBe("testApi");
      expect(message.args.value).toBe(42);
    });

    it("should set msgId on sent message", async () => {
      const accessPoint: AccessPoint = {
        address: serverHost,
        port: serverPort,
        protocol: NetworkProtocol.TCP,
        authorization: "",
        function: [],
      };

      client = new TcpClient(createTestConfig() as any, accessPoint, "test-client");

      await client.start();

      const receivedData = await new Promise<string>((resolve) => {
        connectedSocket?.on("data", (data) => {
          resolve(data.toString());
        });

        client.sendMessage({
          peer: { service: "test", instance: "123" },
          api: "testApi",
          args: {},
        });
      });

      const message = JSON.parse(receivedData);
      expect(message.msgId).toBeDefined();
      expect(typeof message.msgId).toBe("string");
    });
  });

  describe("writeWithId() - write data with specific msgId", () => {
    it("should write data with specific msgId", async () => {
      const accessPoint: AccessPoint = {
        address: serverHost,
        port: serverPort,
        protocol: NetworkProtocol.TCP,
        authorization: "",
        function: [],
      };

      client = new TcpClient(createTestConfig() as any, accessPoint, "test-client");

      await client.start();

      const receivedData = await new Promise<string>((resolve) => {
        connectedSocket?.on("data", (data) => {
          resolve(data.toString());
        });

        client.writeWithId("test data", "custom-msg-id-123");
      });

      expect(receivedData).toBe("test data");
    });
  });

  describe("getAccessPoint()", () => {
    it("should return the configured access point", async () => {
      const accessPoint: AccessPoint = {
        address: serverHost,
        port: serverPort,
        protocol: NetworkProtocol.TCP,
        authorization: "secret",
        function: ["func1", "func2"],
      };

      client = new TcpClient(createTestConfig() as any, accessPoint, "test-client");

      const result = client.getAccessPoint();
      expect(result.address).toBe(serverHost);
      expect(result.port).toBe(serverPort);
      expect(result.authorization).toBe("secret");
      expect(result.function).toEqual(["func1", "func2"]);
    });
  });

  describe("setAccessPoint()", () => {
    it("should update the access point", async () => {
      const accessPoint: AccessPoint = {
        address: serverHost,
        port: serverPort,
        protocol: NetworkProtocol.TCP,
        authorization: "",
        function: [],
      };

      client = new TcpClient(createTestConfig() as any, accessPoint, "test-client");

      const newAccessPoint: AccessPoint = {
        address: "192.168.1.1",
        port: 9999,
        protocol: NetworkProtocol.TCP,
        authorization: "",
        function: [],
      };

      client.setAccessPoint(newAccessPoint);

      const result = client.getAccessPoint();
      expect(result.address).toBe("192.168.1.1");
      expect(result.port).toBe(9999);
    });
  });

  describe("getSocket()", () => {
    it("should return the socket when connected", async () => {
      const accessPoint: AccessPoint = {
        address: serverHost,
        port: serverPort,
        protocol: NetworkProtocol.TCP,
        authorization: "",
        function: [],
      };

      client = new TcpClient(createTestConfig() as any, accessPoint, "test-client");

      await client.start();

      const socket = client.getSocket();
      expect(socket).toBeDefined();
      expect(socket.remoteAddress).toBe(serverHost);
      expect(socket.remotePort).toBe(serverPort);
    });

    it("should throw error when not connected", () => {
      const accessPoint: AccessPoint = {
        address: serverHost,
        port: serverPort,
        protocol: NetworkProtocol.TCP,
        authorization: "",
        function: [],
      };

      client = new TcpClient(createTestConfig() as any, accessPoint, "test-client");

      expect(() => client.getSocket()).toThrow("not connected");
    });
  });

  describe("getRxBytes() and getTxBytes()", () => {
    it("should track transmitted bytes", async () => {
      const accessPoint: AccessPoint = {
        address: serverHost,
        port: serverPort,
        protocol: NetworkProtocol.TCP,
        authorization: "",
        function: [],
      };

      client = new TcpClient(createTestConfig() as any, accessPoint, "test-client");

      await client.start();

      await new Promise<void>((resolve) => {
        connectedSocket?.on("data", () => resolve());
        client.write(Buffer.from("Hello"));
      });

      expect(client.getTxBytes()).toBeGreaterThan(0);
    });
  });

  describe("resetByteCounters()", () => {
    it("should reset byte counters", async () => {
      const accessPoint: AccessPoint = {
        address: serverHost,
        port: serverPort,
        protocol: NetworkProtocol.TCP,
        authorization: "",
        function: [],
      };

      client = new TcpClient(createTestConfig() as any, accessPoint, "test-client");

      await client.start();

      await new Promise<void>((resolve) => {
        connectedSocket?.on("data", () => resolve());
        client.write(Buffer.from("Hello"));
      });

      client.resetByteCounters();

      expect(client.getTxBytes()).toBe(0);
      expect(client.getRxBytes()).toBe(0);
    });
  });

  describe("error handling with real connection", () => {
    it("should handle server that closes connection", async () => {
      const accessPoint: AccessPoint = {
        address: serverHost,
        port: serverPort,
        protocol: NetworkProtocol.TCP,
        authorization: "",
        function: [],
      };

      client = new TcpClient(createTestConfig() as any, accessPoint, "test-client");

      await client.start();

      const closePromise = new Promise<void>((resolve) => {
        client.on("close" as any, () => resolve());
      });

      connectedSocket?.destroy();

      await closePromise;
    });
  });
});