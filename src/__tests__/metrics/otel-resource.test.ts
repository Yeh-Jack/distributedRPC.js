import { describe, it, expect, vi } from "vitest";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  ServerStateValues,
  generateCorrelationId,
  SERVICE_NAME_KEY,
  SERVICE_ID_KEY,
  SERVICE_STATE_KEY,
} from "../../metrics/otel-resource";
import { ExecutionState } from "../../types/basal-protocol";

describe("ServerStateValues", () => {
  it("should map Error state to 0", () => {
    expect(ServerStateValues[ExecutionState.Error]).toBe(0);
  });

  it("should map Halt state to 35", () => {
    expect(ServerStateValues[ExecutionState.Halt]).toBe(35);
  });

  it("should map Halting state to 30", () => {
    expect(ServerStateValues[ExecutionState.Halting]).toBe(30);
  });

  it("should map Initializing state to 5", () => {
    expect(ServerStateValues[ExecutionState.Initializing]).toBe(5);
  });

  it("should map Listening state to 25", () => {
    expect(ServerStateValues[ExecutionState.Listening]).toBe(25);
  });

  it("should map Retrying state to 15", () => {
    expect(ServerStateValues[ExecutionState.Retrying]).toBe(15);
  });

  it("should map Running state to 20", () => {
    expect(ServerStateValues[ExecutionState.Running]).toBe(20);
  });

  it("should map Starting state to 10", () => {
    expect(ServerStateValues[ExecutionState.Starting]).toBe(10);
  });

  it("should map Stopping state to 40", () => {
    expect(ServerStateValues[ExecutionState.Stopping]).toBe(40);
  });

  it("should map Stopped state to 45", () => {
    expect(ServerStateValues[ExecutionState.Stopped]).toBe(45);
  });

  it("should have values for all ExecutionState enum members", () => {
    const enumValues = Object.keys(ExecutionState);
    enumValues.forEach((key) => {
      const state = ExecutionState[key as keyof typeof ExecutionState];
      expect(ServerStateValues).toHaveProperty(state);
    });
  });
});

describe("generateCorrelationId", () => {
  it("should generate a correlation id with trace prefix", () => {
    const correlationId = generateCorrelationId();
    expect(correlationId.startsWith("trace_")).toBe(true);
  });

  it("should include timestamp in correlation id", () => {
    const before = Date.now();
    const correlationId = generateCorrelationId();
    const after = Date.now();

    const timestampPart = correlationId.split("_")[1];
    const timestamp = parseInt(timestampPart, 10);

    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  it("should generate unique correlation ids", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateCorrelationId());
    }
    expect(ids.size).toBe(100);
  });

  it("should generate correlation id with correct format", () => {
    const correlationId = generateCorrelationId();
    const parts = correlationId.split("_");

    expect(parts.length).toBe(3);
    expect(parts[0]).toBe("trace");
    expect(parts[1]).toMatch(/^\d+$/);
    expect(parts[2].length).toBeGreaterThan(0);
  });

  it("should generate correlation id shorter than MAX_MSG_ID_LEN (64)", () => {
    for (let i = 0; i < 50; i++) {
      const correlationId = generateCorrelationId();
      expect(correlationId.length).toBeLessThan(64);
    }
  });
});

describe("Context keys", () => {
  it("SERVICE_NAME_KEY should be defined", () => {
    expect(SERVICE_NAME_KEY).toBeDefined();
  });

  it("SERVICE_ID_KEY should be defined", () => {
    expect(SERVICE_ID_KEY).toBeDefined();
  });

  it("SERVICE_STATE_KEY should be defined", () => {
    expect(SERVICE_STATE_KEY).toBeDefined();
  });

  it("context keys should be unique", () => {
    expect(SERVICE_NAME_KEY).not.toBe(SERVICE_ID_KEY);
    expect(SERVICE_ID_KEY).not.toBe(SERVICE_STATE_KEY);
    expect(SERVICE_NAME_KEY).not.toBe(SERVICE_STATE_KEY);
  });
});
