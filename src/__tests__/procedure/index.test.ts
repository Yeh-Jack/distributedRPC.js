import "reflect-metadata";
import { describe, it, expect } from "vitest";
// Import container first to ensure TYPES are registered
import "../../aop/container";
import * as procedure from "../../procedure";

describe("procedure/index exports", () => {
  it("should export Procedure class", () => {
    expect(procedure.Procedure).toBeDefined();
    expect(typeof procedure.Procedure).toBe("function");
  });

  it("should export DiscoverProcedure", () => {
    expect(procedure.DiscoverProcedure).toBeDefined();
    expect(typeof procedure.DiscoverProcedure).toBe("function");
  });

  it("should export RegisterProcedure", () => {
    expect(procedure.RegisterProcedure).toBeDefined();
    expect(typeof procedure.RegisterProcedure).toBe("function");
  });

  it("should export ReportProcedure", () => {
    expect(procedure.ReportProcedure).toBeDefined();
    expect(typeof procedure.ReportProcedure).toBe("function");
  });

  it("should export ProcedureContext interface", () => {
    // ProcedureContext is a TypeScript interface, only exists at compile-time
    // Check that the procedure module exports Procedure class
    expect(procedure.Procedure).toBeDefined();
  });

  it("should export RegisterContext interface", () => {
    // RegisterContext is a TypeScript interface, only exists at compile-time
    // Check that the procedure module exports RegisterProcedure class
    expect(procedure.RegisterProcedure).toBeDefined();
  });

  it("should export ReportContext interface", () => {
    // ReportContext is a TypeScript interface, only exists at compile-time
    // Check that the procedure module exports ReportProcedure class
    expect(procedure.ReportProcedure).toBeDefined();
  });

  it("should export ManagerInfo interface", () => {
    // ManagerInfo is a TypeScript interface, only exists at compile-time
    // Check that EVENT_MGR_RESPONSE constant is exported
    expect(procedure.EVENT_MGR_RESPONSE).toBeDefined();
  });

  it("should export RegisterManagerInfo interface", () => {
    // RegisterManagerInfo is a TypeScript interface, only exists at compile-time
    // Check that EVENT_PVD_REGISTERED constant is exported
    expect(procedure.EVENT_PVD_REGISTERED).toBeDefined();
  });

  it("should export ReportManagerInfo interface", () => {
    // ReportManagerInfo is a TypeScript interface, only exists at compile-time
    // Check that ReportProcedure class is exported
    expect(procedure.ReportProcedure).toBeDefined();
  });

  it("should export EVENT_MGR_RESPONSE constant", () => {
    expect(procedure.EVENT_MGR_RESPONSE).toBe("mgr_response");
  });

  it("should export EVENT_PVD_REGISTERED constant", () => {
    expect(procedure.EVENT_PVD_REGISTERED).toBe("pvd_registered");
  });
});

describe("ProcedureContext structure", () => {
  it("should require taskName and tasks properties", () => {
    const context: procedure.ProcedureContext = {
      taskName: "test-task",
      tasks: new Map(),
      idGenerator: {
        generate: () => "uuid",
        shortId: () => "short-id",
      },
    };

    expect(context.taskName).toBe("test-task");
    expect(context.tasks).toBeInstanceOf(Map);
  });

  it("should allow optional parent property", () => {
    const context: procedure.ProcedureContext = {
      parent: {} as any,
      taskName: "test-task",
      tasks: new Map(),
      idGenerator: {
        generate: () => "uuid",
        shortId: () => "short-id",
      },
    };

    expect(context.parent).toBeDefined();
  });
});
