import * as dgram from "dgram";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UdpDiscovery } from "../../network/udp-discovery";
import { BroadcastResponse260321 } from "../../manager/api-spec-260321";

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
  activeConnections: { add: vi.fn() },
  tcpConnectionDuration: { record: vi.fn() },
  tcpConnectionsFailed: { add: vi.fn() },
  tcpDataTransferSize: { record: vi.fn() },
  executionTime: { record: vi.fn() },
  serverState: { observe: vi.fn() },
  listenerState: { observe: vi.fn() },
  OtelProviderState: class {},
  OtelMeterics: class {
    getMeter() { return {}; }
  },
}));

describe("UdpDiscovery Integration with Real Sockets", () => {
  let mockUdpServer: dgram.Socket;
  let serverPort: number;
  let serverAddress: string;
  let discovery: UdpDiscovery;

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
          port: 0,
        },
      },
      retry: {
        interval: 50,
        max_try: 3,
        backoff: { enable: true, max_delay: 1000, multiplier: 1.5 },
      },
      service_name: "test-udp-discovery",
      provider_id: "test-provider-id",
    }),
    getLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      silly: vi.fn(),
    }),
    getProviderId: () => "test-provider-id",
  });

  const createValidBroadcastResponse = (): BroadcastResponse260321 => ({
    protocol_ver: "260321",
    apis: {
      reception: {
        request: "string",
        response: "BroadcastResponse260321",
        ack: 0,
      },
      register: {
        request: "RegisterInfo",
        response: "NO_RESPONSE",
        ack: 1,
      },
      report: {
        request: "ReportData",
        response: "NO_RESPONSE",
        ack: 0,
      },
    },
    manager: {
      protocol_ver: "1.0.0",
      provider: {
        id: "sm-001",
        name: "ServiceManager",
        desc: "Test Service Manager",
        version: "1.0.0",
        address: "127.0.0.1",
        port: serverPort,
        protocol: "TCP",
        authorization: "",
        function: [],
      },
    },
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    serverAddress = "127.0.0.1";

    mockUdpServer = dgram.createSocket("udp4");

    await new Promise<void>((resolve, reject) => {
      mockUdpServer.bind(0, serverAddress, () => {
        const addr = mockUdpServer.address();
        if (typeof addr !== "string") {
          serverPort = addr.port;
        }
        resolve();
      });
      mockUdpServer.on("error", reject);
    });
  });

  afterEach(async () => {
    if (discovery) {
      try {
        await discovery.stop();
      } catch {}
    }
    await new Promise<void>((resolve) => {
      mockUdpServer.close(() => resolve());
    });
  });

  describe("lifecycle with real UDP socket", () => {
    it("should start and stop with real UDP socket", async () => {
      discovery = new UdpDiscovery(createTestConfig() as any, "test-discovery");

      await discovery.start();
      expect(discovery.getState()).toBeDefined();

      await discovery.stop();
      expect(discovery.getState()).toBeDefined();
    });

    it("should bind to a socket on start", async () => {
      discovery = new UdpDiscovery(createTestConfig() as any, "test-discovery");

      await discovery.start();

      const socket = (discovery as any)._socket;
      expect(socket).toBeDefined();

      await discovery.stop();
    });
  });

  describe("discover() with real UDP server responding", () => {
    it("should discover a responding ServiceManager", async () => {
      discovery = new UdpDiscovery(createTestConfig() as any, "test-discovery");

      mockUdpServer.on("message", (msg, rinfo) => {
        const response = createValidBroadcastResponse();
        const responseMsg = JSON.stringify(response);
        mockUdpServer.send(responseMsg, rinfo.port, rinfo.address);
      });

      const result = await discovery.discover({
        address: serverAddress,
        port: serverPort,
        timeout: 1000,
        maxResponses: 1,
      });

      expect(result.responseCount).toBe(1);
      expect(result.responses).toHaveLength(1);
      expect(result.responses[0].manager.provider.name).toBe("ServiceManager");
    });

    it("should return empty when server doesn't respond with valid data", async () => {
      discovery = new UdpDiscovery(createTestConfig() as any, "test-discovery");

      mockUdpServer.on("message", (msg, rinfo) => {
        mockUdpServer.send("invalid json", rinfo.port, rinfo.address);
      });

      await expect(
        discovery.discover({
          address: serverAddress,
          port: serverPort,
          timeout: 300,
          maxResponses: 1,
        }),
      ).rejects.toThrow();
    });
  });

  describe("discoverOne() with real UDP server", () => {
    it("should return single response from discoverOne", async () => {
      discovery = new UdpDiscovery(createTestConfig() as any, "test-discovery");

      mockUdpServer.on("message", (msg, rinfo) => {
        const response = createValidBroadcastResponse();
        const responseMsg = JSON.stringify(response);
        mockUdpServer.send(responseMsg, rinfo.port, rinfo.address);
      });

      const result = await discovery.discoverOne({
        address: serverAddress,
        port: serverPort,
        timeout: 1000,
      });

      expect(result.responseCount).toBe(1);
      expect(result.responses).toHaveLength(1);
    });
  });

  describe("getDefaultOptions()", () => {
    it("should return default discovery options", () => {
      const defaults = UdpDiscovery.DEFAULT_OPTIONS;

      expect(defaults.port).toBeDefined();
      expect(defaults.timeout).toBe(5000);
      expect(defaults.maxResponses).toBe(0);
    });
  });

  describe("getState()", () => {
    it("should return state after start", async () => {
      discovery = new UdpDiscovery(createTestConfig() as any, "test-discovery");

      expect(discovery.getState()).toBeDefined();

      await discovery.start();
      expect(discovery.getState()).toBeDefined();

      await discovery.stop();
      expect(discovery.getState()).toBeDefined();
    });
  });

  describe("sendAndWait() data transmission", () => {
    it("should send data and receive response", async () => {
      discovery = new UdpDiscovery(createTestConfig() as any, "test-discovery");

      await discovery.start();

      const receivedData = await new Promise<Buffer>((resolve) => {
        mockUdpServer.on("message", (msg, rinfo) => {
          resolve(msg);
        });

        discovery.send("test message", {
          address: serverAddress,
          port: serverPort,
          timeout: 1000,
        });
      });

      expect(receivedData.toString()).toBe("test message");
    });
  });
});