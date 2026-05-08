import { describe, it, expect, vi, beforeEach } from "vitest";
import { Procedure, ProcedureContext } from "../../procedure/procedure";
import { ConfigManager } from "../../common/config";
import { TcpClient } from "../../network/tcp-client";
import { TcpServer } from "../../network/tcp-server";
import { AccessPoint, ExecutionState } from "../../types/basal-protocol";

vi.mock("../../aop/container", () => ({
  createNamedTcpServer: vi.fn(),
  TYPES: {
    ConfigManager: "ConfigManager",
  },
}));

vi.mock("../../network/tcp-client");
vi.mock("../../network/tcp-server");

describe("Procedure", () => {
  let mockConfigManager: ConfigManager;
  let ConcreteProcedure: any;

  beforeEach(() => {
    vi.clearAllMocks();

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

    ConcreteProcedure = class TestProcedure extends Procedure {
      public executeCallCount = 0;
      public constructor(configManager: ConfigManager) {
        super(configManager);
      }

      public override async execute(context?: ProcedureContext): Promise<any> {
        if (context) this.context = context;
        this.executeCallCount++;
        return "executed";
      }
    };
  });

  describe("constructor", () => {
    it("should create Procedure instance with configManager", () => {
      const procedure = new ConcreteProcedure(mockConfigManager);
      expect(procedure).toBeInstanceOf(Procedure);
    });

    it("should set configManager and logger", () => {
      const procedure = new ConcreteProcedure(mockConfigManager);
      expect((procedure as any).configManager).toBe(mockConfigManager);
      expect((procedure as any).logger).toBeDefined();
    });
  });

  describe("setConfigManager", () => {
    it("should set configManager and logger", () => {
      const procedure = new ConcreteProcedure(mockConfigManager);
      const newConfigManager = {
        getCoreConfig: () => ({}),
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          silly: vi.fn(),
        }),
      } as unknown as ConfigManager;

      procedure.setConfigManager(newConfigManager);

      expect((procedure as any).configManager).toBe(newConfigManager);
      expect((procedure as any).logger).toBeDefined();
    });
  });

  describe("getContext", () => {
    it("should return the context", () => {
      const procedure = new ConcreteProcedure(mockConfigManager);
      const context: ProcedureContext = {
        taskName: "test",
        tasks: new Map(),
        idGenerator: { generate: () => "id", shortId: () => "short" },
      };

      procedure.execute(context);

      expect(procedure.getContext()).toEqual(context);
    });
  });

  describe("execute", () => {
    it("should throw error when not implemented", async () => {
      class TestProcedure extends Procedure {
        constructor(configManager: ConfigManager) {
          super(configManager);
        }
      }

      const procedure = new TestProcedure(mockConfigManager);

      await expect(procedure.execute()).rejects.toThrow(
        "TestProcedure.execute() is not implemented.",
      );
    });

    it("should accept context parameter", async () => {
      const procedure = new ConcreteProcedure(mockConfigManager);
      const context: ProcedureContext = {
        taskName: "test",
        tasks: new Map(),
        idGenerator: { generate: () => "id", shortId: () => "short" },
      };

      const result = await procedure.execute(context);
      expect(result).toBe("executed");
      expect(procedure.executeCallCount).toBe(1);
    });
  });

  describe("delay", () => {
    it("should delay for specified milliseconds", async () => {
      const procedure = new ConcreteProcedure(mockConfigManager);
      const start = Date.now();
      await (procedure as any).delay(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(45);
    });
  });

  describe("getTcpClient", () => {
    it("should throw error when AccessPoint is missing", async () => {
      const procedure = new ConcreteProcedure(mockConfigManager);
      procedure.setConfigManager(mockConfigManager);
      (procedure as any).context = {
        taskName: "test",
        tasks: new Map(),
        idGenerator: { generate: () => "id", shortId: () => "short" },
      };

      await expect(
        (procedure as any).getTcpClient("test-task", undefined),
      ).rejects.toThrow("Missing AccessPoint argument.");
    });

    it("should throw error when IdGenerator is missing", async () => {
      const procedure = new ConcreteProcedure(mockConfigManager);
      procedure.setConfigManager(mockConfigManager);
      (procedure as any).context = {
        taskName: "test",
        tasks: new Map(),
        idGenerator: undefined,
      };

      const accessPoint: AccessPoint = {
        address: "127.0.0.1",
        port: 3000,
        protocol: "TCP" as any,
        authorization: "",
        api: [],
      };

      await expect(
        (procedure as any).getTcpClient("test-task", accessPoint),
      ).rejects.toThrow("Missing IdGenerator argument.");
    });

    it("should return existing tcpClient from tasks if already created", async () => {
      const mockTcpClient = { start: vi.fn().mockResolvedValue(undefined) };
      const procedure = new ConcreteProcedure(mockConfigManager);
      procedure.setConfigManager(mockConfigManager);
      (procedure as any).context = {
        taskName: "test",
        tasks: new Map([["test-task", mockTcpClient]]),
        idGenerator: { generate: () => "id", shortId: () => "short" },
      };

      const accessPoint: AccessPoint = {
        address: "127.0.0.1",
        port: 3000,
        protocol: "TCP" as any,
        authorization: "",
        api: [],
      };

      const result = await (procedure as any).getTcpClient(
        "test-task",
        accessPoint,
      );
      expect(result).toBe(mockTcpClient);
    });
  });

  describe("getTcpServer", () => {
    it("should return existing tcpServer from tasks if already created", async () => {
      const mockTcpServer = { start: vi.fn().mockResolvedValue(undefined) };
      const procedure = new ConcreteProcedure(mockConfigManager);
      procedure.setConfigManager(mockConfigManager);
      (procedure as any).context = {
        taskName: "test",
        tasks: new Map([["test-task", mockTcpServer]]),
        idGenerator: { generate: () => "id", shortId: () => "short" },
      };

      const result = await (procedure as any).getTcpServer("test-task");
      expect(result).toBe(mockTcpServer);
    });

    it("should create and start new tcpServer when not in tasks", async () => {
      const mockTcpServer = { start: vi.fn().mockResolvedValue(undefined) };
      const { createNamedTcpServer } = await import("../../aop/container");
      vi.mocked(createNamedTcpServer).mockReturnValue(mockTcpServer);

      const procedure = new ConcreteProcedure(mockConfigManager);
      procedure.setConfigManager(mockConfigManager);
      (procedure as any).context = {
        taskName: "test",
        tasks: new Map(),
        idGenerator: { generate: () => "id", shortId: () => "short" },
      };

      const result = await (procedure as any).getTcpServer("test-task");

      expect(createNamedTcpServer).toHaveBeenCalledWith(
        mockConfigManager,
        "test-task",
      );
      expect(mockTcpServer.start).toHaveBeenCalled();
      expect(result).toBe(mockTcpServer);
    });

    it("should log error and rethrow when tcpServer creation fails", async () => {
      const error = new Error("Server creation failed");
      const { createNamedTcpServer } = await import("../../aop/container");
      vi.mocked(createNamedTcpServer).mockImplementation(() => {
        throw error;
      });

      const procedure = new ConcreteProcedure(mockConfigManager);
      procedure.setConfigManager(mockConfigManager);
      (procedure as any).context = {
        taskName: "test",
        tasks: new Map(),
        idGenerator: { generate: () => "id", shortId: () => "short" },
      };

      await expect(
        (procedure as any).getTcpServer("test-task"),
      ).rejects.toThrow("Server creation failed");
    });
  });
});

describe("ProcedureContext interface", () => {
  it("should require taskName and tasks", () => {
    const context: ProcedureContext = {
      taskName: "my-task",
      tasks: new Map(),
      idGenerator: {
        generate: () => "uuid",
        shortId: () => "short-id",
      },
    };

    expect(context.taskName).toBe("my-task");
    expect(context.tasks).toBeInstanceOf(Map);
  });

  it("should allow optional parent", () => {
    const mockParent = {} as any;
    const context: ProcedureContext = {
      parent: mockParent,
      taskName: "my-task",
      tasks: new Map(),
      idGenerator: {
        generate: () => "uuid",
        shortId: () => "short-id",
      },
    };

    expect(context.parent).toBe(mockParent);
  });
});
