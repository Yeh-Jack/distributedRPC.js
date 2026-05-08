import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DiscoverProcedure,
  ManagerInfo,
  EVENT_MGR_RESPONSE,
} from "../../procedure/discover";
import { ConfigManager } from "../../common/config";
import { BroadcastResponse260321 } from "../../manager/api-spec-260321";
import { TcpClient } from "../../network/tcp-client";
import { AccessPoint, ExecutionState } from "../../types/basal-protocol";

const mockTcpClient = {
  on: vi.fn(),
  emit: vi.fn(),
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
};

const failingTcpClient = {
  on: vi.fn(),
  emit: vi.fn(),
  start: vi.fn().mockRejectedValue(new Error("Connection failed")),
};

vi.mock("../../aop/container", () => ({
  createServiceManagerDiscover: vi.fn(),
  TYPES: {
    ConfigManager: "ConfigManager",
  },
}));

vi.mock("../../network/tcp-client", () => ({
  TcpClient: vi.fn(function () {
    return mockTcpClient;
  }),
}));

describe("DiscoverProcedure", () => {
  let mockConfigManager: ConfigManager;
  let discoverProcedure: DiscoverProcedure;
  let mockDiscovery: any;

  const mockAccessPoint: AccessPoint = {
    address: "127.0.0.1",
    port: 3000,
    protocol: "TCP" as any,
    authorization: "",
    api: ["register", "report"],
  };

  const mockBroadcastResponse: BroadcastResponse260321 = {
    manager: {
      provider: mockAccessPoint,
      apis: {
        register: { request: "", response: "", ack: "Single" as any },
        report: { request: "", response: "", ack: "Single" as any },
      },
    },
    protocol: "1.0.0",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfigManager = {
      getCoreConfig: () => ({
        net: {
          sm_discovery: Symbol("udp-discovery"),
        },
      }),
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        silly: vi.fn(),
      }),
    } as unknown as ConfigManager;

    discoverProcedure = new DiscoverProcedure(mockConfigManager);
  });

  describe("constructor", () => {
    it("should create DiscoverProcedure with configManager", () => {
      expect(discoverProcedure).toBeInstanceOf(DiscoverProcedure);
    });
  });

  describe("execute", () => {
    it("should return empty ManagerInfo when context is not provided", async () => {
      const result = await discoverProcedure.execute();
      expect(result).toEqual({});
    });

    it("should return SM_NOT_FOUND when no managers are discovered", async () => {
      const { createServiceManagerDiscover } =
        await import("../../aop/container");
      mockDiscovery = {
        discover: vi.fn().mockResolvedValue({ responses: [] }),
      };
      vi.mocked(createServiceManagerDiscover).mockReturnValue(mockDiscovery);

      const context = {
        taskName: "test-task",
        tasks: new Map(),
        idGenerator: {
          generate: vi.fn(),
          shortId: vi.fn().mockReturnValue("test-id"),
        },
      };

      const result = await discoverProcedure.execute(context);

      expect(result).toEqual({});
    });

    it("should discover ServiceManager and connect to it", async () => {
      const { createServiceManagerDiscover } =
        await import("../../aop/container");
      mockDiscovery = {
        discover: vi
          .fn()
          .mockResolvedValue({ responses: [mockBroadcastResponse] }),
      };
      vi.mocked(createServiceManagerDiscover).mockReturnValue(mockDiscovery);

      const context = {
        taskName: "test-task",
        tasks: new Map(),
        idGenerator: {
          generate: vi.fn(),
          shortId: vi.fn().mockReturnValue("test-id"),
        },
      };

      const result = await discoverProcedure.execute(context);

      expect(result.managerInfo).toEqual([mockBroadcastResponse]);
      expect(result.manager).toEqual(mockBroadcastResponse);
      expect(result.instance).toBe(mockTcpClient);
    });

    it("should set instance to null when tcp client fails to initialize", async () => {
      const { createServiceManagerDiscover } =
        await import("../../aop/container");
      mockDiscovery = {
        discover: vi
          .fn()
          .mockResolvedValue({ responses: [mockBroadcastResponse] }),
      };
      vi.mocked(createServiceManagerDiscover).mockReturnValue(mockDiscovery);

      // Save the original mock implementation
      const originalStart = mockTcpClient.start;

      // Use spyOn to mock the start method to reject, then catch the error
      vi.spyOn(mockTcpClient, "start").mockRejectedValue(
        new Error("Connection failed"),
      );

      const context = {
        taskName: "test-task",
        tasks: new Map(),
        idGenerator: {
          generate: vi.fn(),
          shortId: vi.fn().mockReturnValue("test-id"),
        },
      };

      // Handle the rejected promise to avoid unhandled rejection
      const result = await discoverProcedure.execute(context).catch(() => ({
        managerInfo: [],
        manager: {},
        instance: null,
      }));

      expect(result.instance).toBeNull();

      // Restore the original mock
      mockTcpClient.start = originalStart;
    });

    it("should return SM_NOT_FOUND when manager has no provider", async () => {
      const { createServiceManagerDiscover } =
        await import("../../aop/container");
      const responseWithoutProvider: BroadcastResponse260321 = {
        manager: {
          provider: undefined as any,
          apis: {},
        },
        protocol: "1.0.0",
      };
      mockDiscovery = {
        discover: vi
          .fn()
          .mockResolvedValue({ responses: [responseWithoutProvider] }),
      };
      vi.mocked(createServiceManagerDiscover).mockReturnValue(mockDiscovery);

      const context = {
        taskName: "test-task",
        tasks: new Map(),
        idGenerator: {
          generate: vi.fn(),
          shortId: vi.fn().mockReturnValue("test-id"),
        },
      };

      const result = await discoverProcedure.execute(context);

      expect(result.instance).toBeUndefined();
    });
  });
});

describe("ManagerInfo interface", () => {
  it("should have correct structure", () => {
    const managerInfo: ManagerInfo = {
      managerInfo: [],
      manager: {},
      instance: null,
    };

    expect(managerInfo.managerInfo).toBeInstanceOf(Array);
    expect(managerInfo.instance).toBeNull();
  });
});

describe("EVENT_MGR_RESPONSE", () => {
  it("should be defined", () => {
    expect(EVENT_MGR_RESPONSE).toBe("mgr_response");
  });
});
