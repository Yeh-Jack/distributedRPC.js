import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  RegisterProcedure,
  EVENT_PVD_REGISTERED,
} from "../../procedure/register";
import { ConfigManager } from "../../common/config";
import { TcpClient } from "../../network/tcp-client";
import {
  AckType,
  ApiCall,
  ApiSpec,
  BasalProtocol,
  AccessPoint,
} from "../../types/basal-protocol";

vi.mock("../../aop/container", () => ({
  TYPES: {
    ConfigManager: "ConfigManager",
  },
}));

// Define mockApiSpec at module level so it's accessible to all test suites
const mockApiSpec: ApiSpec = {
  request: "RegisterRequest",
  response: "RegisterResponse",
  ack: AckType.Single,
};

describe("RegisterProcedure", () => {
  let mockConfigManager: ConfigManager;
  let registerProcedure: RegisterProcedure;
  let mockTcpClient: any;
  let mockContext: any;

  const mockAccessPoint: AccessPoint = {
    address: "127.0.0.1",
    port: 3000,
    protocol: "TCP" as any,
    authorization: "auth-key",
    api: ["register", "report"],
  };

  const mockProtocol: BasalProtocol = {
    protocol_ver: "1.0.0",
    provider: {
      id: "provider-1",
      name: "TestProvider",
      desc: "Test provider description",
      version: "1.0.0",
    },
    apis: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a mock that passes instanceof TcpClient check
    mockTcpClient = Object.create(TcpClient.prototype);
    Object.assign(mockTcpClient, {
      on: vi.fn(),
      emit: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue("msg-id-1"),
    });

    mockConfigManager = {
      getCoreConfig: () => ({}),
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        silly: vi.fn(),
      }),
    } as unknown as ConfigManager;

    mockContext = {
      taskName: "_chnResponse",
      tasks: new Map([["_svcManager", mockTcpClient]]),
      idGenerator: { generate: () => "uuid", shortId: () => "short-id" },
      manager: {
        manager: {
          apis: {
            register: mockApiSpec,
          },
        },
      },
      protocol: mockProtocol,
      smTaskName: "_svcManager",
      ask: vi.fn(),
      buildMessage: vi.fn().mockReturnValue({
        peer: { service: "TestProvider", instance: "provider-1" },
        api: "register",
        args: {},
        msgId: "msg-1",
      } as ApiCall),
      getTcpTaskInfo: vi.fn().mockReturnValue(mockAccessPoint),
    };

    registerProcedure = new RegisterProcedure(mockConfigManager);
  });

  describe("constructor", () => {
    it("should create RegisterProcedure with configManager", () => {
      expect(registerProcedure).toBeInstanceOf(RegisterProcedure);
    });
  });

  describe("execute", () => {
    it("should return false when context is not provided", async () => {
      const result = await registerProcedure.execute();
      expect(result).toBe(false);
    });

    it("should return false when smTask is not a TcpClient", async () => {
      const invalidContext = {
        ...mockContext,
        tasks: new Map([["_svcManager", "not-a-tcp-client"]]),
      };

      const result = await registerProcedure.execute(invalidContext);
      expect(result).toBe(false);
    });

    it("should return false when smTask does not exist", async () => {
      const invalidContext = {
        ...mockContext,
        tasks: new Map(),
      };

      const result = await registerProcedure.execute(invalidContext);
      expect(result).toBe(false);
    });

    it("should send registration request to ServiceManager", async () => {
      const mockPromise = Promise.resolve({
        response: Buffer.from("success"),
        request: {} as ApiCall,
      });

      mockContext.ask = vi.fn().mockResolvedValue({
        msgId: "msg-1",
        promise: mockPromise,
      });

      const result = await registerProcedure.execute(mockContext);
      await result;

      expect(mockContext.buildMessage).toHaveBeenCalledWith(
        "register",
        expect.objectContaining({
          protocol_ver: mockProtocol.protocol_ver,
          provider: expect.objectContaining({
            id: expect.any(String),
          }),
        }),
      );
      expect(mockContext.ask).toHaveBeenCalled();
    });

    it("should handle successful registration", async () => {
      const mockPromise = Promise.resolve({
        response: Buffer.from("registered"),
        request: {} as ApiCall,
      });

      mockContext.ask = vi.fn().mockResolvedValue({
        msgId: "msg-1",
        promise: mockPromise,
      });

      const result = await registerProcedure.execute(mockContext);
      const resolvedResult = await result;

      expect(resolvedResult).toBe(true);
      expect(mockTcpClient.emit).toHaveBeenCalledWith(
        EVENT_PVD_REGISTERED,
        expect.objectContaining({
          msgId: "msg-1",
          ack: "registered",
        }),
      );
    });

    it("should handle registration failure", async () => {
      const mockPromise = Promise.reject({
        err: Buffer.from("registration failed"),
        request: {} as ApiCall,
      });

      mockContext.ask = vi.fn().mockResolvedValue({
        msgId: "msg-1",
        promise: mockPromise,
      });

      const result = await registerProcedure.execute(mockContext);
      const resolvedResult = await result;

      expect(resolvedResult).toBe(false);
    });

    it("should return false when promise is not returned from ask", async () => {
      mockContext.ask = vi.fn().mockResolvedValue({
        msgId: "msg-1",
      });

      const result = await registerProcedure.execute(mockContext);
      const resolvedResult = await result;

      expect(resolvedResult).toBe(false);
    });

    it("should handle exceptions during registration", async () => {
      mockContext.ask = vi.fn().mockImplementation(() => {
        throw new Error("Network error");
      });

      const result = await registerProcedure.execute(mockContext);
      const resolvedResult = await result;

      expect(resolvedResult).toBe(false);
    });

    it("should emit pvd_registered event on success", async () => {
      const mockPromise = Promise.resolve({
        response: Buffer.from("Ack"),
        request: {} as ApiCall,
      });

      mockContext.ask = vi.fn().mockResolvedValue({
        msgId: "test-msg-id",
        promise: mockPromise,
      });

      const result = await registerProcedure.execute(mockContext);
      await result;

      expect(mockTcpClient.emit).toHaveBeenCalledWith(
        EVENT_PVD_REGISTERED,
        expect.objectContaining({
          msgId: "test-msg-id",
        }),
      );
    });
  });
});

describe("EVENT_PVD_REGISTERED", () => {
  it("should be defined", () => {
    expect(EVENT_PVD_REGISTERED).toBe("pvd_registered");
  });
});

describe("RegisterManagerInfo interface", () => {
  it("should have correct structure", () => {
    const managerInfo: RegisterProcedure.RegisterManagerInfo = {
      apis: {
        register: mockApiSpec,
      },
    };

    expect(managerInfo.apis.register).toBeDefined();
  });
});
