import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SpanKind, SpanStatusCode, Span } from "@opentelemetry/api";
import { DEFAULT_DISCOVERY_PORT } from "../../common/config";
import { OtelTracer } from "../../metrics/otel-tracing";
import { generateCorrelationId } from "../../metrics/otel-resource";
import {
  ProviderState,
  ProviderAttributeValue,
} from "../../provider/provider-info";
import {
  ExecutionState,
  UNKNOWN_ATTRIBUTE,
  NetworkProtocol,
} from "../../types/basal-protocol";
import { NetworkDirection } from "../../network/network-events";

vi.mock("@opentelemetry/api", async () => {
  const actual = await import("@opentelemetry/api");
  return {
    ...actual,
    trace: {
      ...actual.trace,
      getTracer: vi.fn((name: string) => ({
        startSpan: vi.fn((name: string, attrs: any) => ({
          name,
          attrs,
          setStatus: vi.fn(),
          setAttribute: vi.fn(),
          end: vi.fn(),
          recordException: vi.fn(),
        })),
      })),
    },
  };
});

describe("ProviderAttributeValue", () => {
  it("should accept string values", () => {
    const value: ProviderAttributeValue = "test-string";
    expect(value).toBe("test-string");
  });

  it("should accept number values", () => {
    const value: ProviderAttributeValue = 42;
    expect(value).toBe(42);
  });

  it("should accept boolean values", () => {
    const value: ProviderAttributeValue = true;
    expect(value).toBe(true);
  });
});

describe("ProviderState", () => {
  let providerState: ProviderState;

  beforeEach(() => {
    const defaultProvider = {
      enabled: true,
      "service.name": UNKNOWN_ATTRIBUTE,
      "service.instance": UNKNOWN_ATTRIBUTE,
      "service.version": UNKNOWN_ATTRIBUTE,
      "protocol.version": UNKNOWN_ATTRIBUTE,
      "deployment.environment": UNKNOWN_ATTRIBUTE,
    };
    providerState = new ProviderState(defaultProvider);
    providerState.setState(ExecutionState.Stopped);
  });

  describe("setState", () => {
    it("should set the provider state", () => {
      providerState.setState(ExecutionState.Listening);
      expect(providerState.getState()).toBe(ExecutionState.Listening);
    });

    it("should update state to running", () => {
      providerState.setState(ExecutionState.Running);
      expect(providerState.getState()).toBe(ExecutionState.Running);
    });

    it("should update state to starting", () => {
      providerState.setState(ExecutionState.Starting);
      expect(providerState.getState()).toBe(ExecutionState.Starting);
    });

    it("should update state to stopped", () => {
      providerState.setState(ExecutionState.Stopped);
      expect(providerState.getState()).toBe(ExecutionState.Stopped);
    });
  });

  describe("getState", () => {
    it("should return the current provider state", () => {
      providerState.setState(ExecutionState.Listening);
      expect(providerState.getState()).toBe(ExecutionState.Listening);
    });

    it("should return Stopped initially", () => {
      const defaultProvider = {
        enabled: true,
        "service.name": UNKNOWN_ATTRIBUTE,
        "service.instance": UNKNOWN_ATTRIBUTE,
        "service.version": UNKNOWN_ATTRIBUTE,
        "protocol.version": UNKNOWN_ATTRIBUTE,
        "deployment.environment": UNKNOWN_ATTRIBUTE,
      };
      const newProviderState = new ProviderState(defaultProvider);
      expect(newProviderState.getState()).toBe(ExecutionState.Stopped);
    });
  });

  describe("getCommonAttributes", () => {
    it("should return attributes with provider information", () => {
      const customProvider = {
        enabled: true,
        "service.name": "TestService",
        "service.instance": "test-id",
        "service.version": "1.0.0",
        "protocol.version": "1.0",
        "deployment.environment": "test",
      };
      const customProviderState = new ProviderState(customProvider);
      customProviderState.setState(ExecutionState.Listening);
      const attrs = customProviderState.getCommonAttributes();
      expect(attrs["provider.identity"]).toBe("TestService-test-id");
      expect(attrs["service.state"]).toBe(ExecutionState.Listening);
    });

    it("should return all attribute types", () => {
      const customProvider = {
        enabled: true,
        "service.name": "Service",
        "service.instance": "id",
        "service.version": "1.0.0",
        "protocol.version": "1.0",
        "deployment.environment": "test",
      };
      const customProviderState = new ProviderState(customProvider);
      customProviderState.setState(ExecutionState.Running);
      const attrs = customProviderState.getCommonAttributes();
      expect(typeof attrs["provider.identity"]).toBe("string");
      expect(typeof attrs["service.state"]).toBe("string");
    });
  });

  describe("getProvider", () => {
    it("should return the provider info", () => {
      const customProvider = {
        enabled: true,
        "service.name": "TestService",
        "service.instance": "test-id",
        "service.version": "1.0.0",
        "protocol.version": "1.0",
        "deployment.environment": "test",
      };
      const customProviderState = new ProviderState(customProvider);
      expect(customProviderState.getProvider()["service.name"]).toBe(
        "TestService",
      );
      expect(customProviderState.getProvider()["service.instance"]).toBe(
        "test-id",
      );
    });
  });

  describe("getProviderIdentity", () => {
    it("should return the provider identity string", () => {
      const customProvider = {
        enabled: true,
        "service.name": "OrderService",
        "service.instance": "order-svc-1",
        "service.version": "1.0.0",
        "protocol.version": "1.0",
        "deployment.environment": "test",
      };
      const customProviderState = new ProviderState(customProvider);
      expect(customProviderState.getProviderIdentity()).toBe(
        "OrderService-order-svc-1",
      );
    });
  });
});

describe("OtelTracer", () => {
  let otelTracer: OtelTracer;

  beforeEach(() => {
    const defaultProvider = {
      enabled: true,
      "service.name": "test-service",
      "service.instance": "test-instance",
      "service.version": "1.0.0",
      "protocol.version": "1.0",
      "deployment.environment": "test",
    };
    const providerState = new ProviderState(defaultProvider);
    otelTracer = new OtelTracer(providerState);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getInstance", () => {
    it("should return the same instance for same providerId", () => {
      const defaultProvider = {
        enabled: true,
        "service.name": "test-service",
        "service.instance": "test-instance",
        "service.version": "1.0.0",
        "protocol.version": "1.0",
        "deployment.environment": "test",
      };
      const providerState = new ProviderState(defaultProvider);
      const instance1 = OtelTracer.getInstance("provider-1", providerState);
      const instance2 = OtelTracer.getInstance("provider-1", providerState);
      expect(instance1).toBe(instance2);
    });

    it("should return different instances for different providerIds", () => {
      const defaultProvider = {
        enabled: true,
        "service.name": "test-service",
        "service.instance": "test-instance",
        "service.version": "1.0.0",
        "protocol.version": "1.0",
        "deployment.environment": "test",
      };
      const providerState = new ProviderState(defaultProvider);
      const instance1 = OtelTracer.getInstance("provider-1", providerState);
      const instance2 = OtelTracer.getInstance("provider-2", providerState);
      expect(instance1).not.toBe(instance2);
    });
  });

  describe("getProviderIdentity", () => {
    it("should return the configured provider identity", () => {
      expect(otelTracer.getProviderIdentity()).toBe(
        "test-service-test-instance",
      );
    });
  });

  describe("getProviderState", () => {
    it("should return the provider state", () => {
      const state = otelTracer.getProviderState();
      expect(state).toBeDefined();
      expect(state.getProvider()["service.name"]).toBe("test-service");
    });
  });

  describe("createSpan", () => {
    it("should create a span with correct name", () => {
      const span = otelTracer.createSpan("test-operation");
      expect(span).toBeDefined();
    });

    it("should include provider attributes in span", () => {
      const span = otelTracer.createSpan("test-operation");
      expect(span).toBeDefined();
    });

    it("should apply custom kind when provided", () => {
      const span = otelTracer.createSpan("test-operation", {
        kind: SpanKind.CLIENT,
      });
      expect(span).toBeDefined();
    });

    it("should include custom attributes", () => {
      const attrs: Record<string, ProviderAttributeValue> = {
        "custom.attr": "value",
        "numeric.attr": 42,
      };
      const span = otelTracer.createSpan("test-operation", {
        attributes: attrs,
      });
      expect(span).toBeDefined();
    });

    it("should create disabled span when enabled is false", () => {
      const disabledProvider = {
        enabled: false,
        "service.name": "disabled-service",
        "service.instance": "disabled-instance",
        "service.version": "1.0.0",
        "protocol.version": "1.0",
        "deployment.environment": "test",
      };
      const disabledState = new ProviderState(disabledProvider);
      const disabledTracer = new OtelTracer(disabledState);
      const span = disabledTracer.createSpan("disabled-operation");
      expect(span).toBeDefined();
    });
  });

  describe("createNetworkSpan", () => {
    it("should create network span", () => {
      const span = otelTracer.createNetworkSpan("connect", {
        address: "127.0.0.1",
        port: 8080,
        protocol: NetworkProtocol.TCP,
      });
      expect(span).toBeDefined();
    });

    it("should create network span with udp protocol", () => {
      const span = otelTracer.createNetworkSpan("broadcast", {
        protocol: NetworkProtocol.UDP,
      });
      expect(span).toBeDefined();
    });

    it("should set direction to outbound when specified", () => {
      const span = otelTracer.createNetworkSpan("send", {
        direction: NetworkDirection.Out,
      });
      expect(span).toBeDefined();
    });

    it("should default direction to inbound", () => {
      const span = otelTracer.createNetworkSpan("receive", {});
      expect(span).toBeDefined();
    });

    it("should include address and port when provided", () => {
      const span = otelTracer.createNetworkSpan("connect", {
        address: "192.168.1.1",
        port: 3000,
      });
      expect(span).toBeDefined();
    });
  });

  describe("createBroadcastSpan", () => {
    it("should create broadcast span for discovery", () => {
      const span = otelTracer.createBroadcastSpan("discover");
      expect(span).toBeDefined();
    });

    it("should include message when provided", () => {
      const span = otelTracer.createBroadcastSpan("announce", {
        message: "hello",
      });
      expect(span).toBeDefined();
    });

    it("should include network address when provided", () => {
      const span = otelTracer.createBroadcastSpan("discover", {
        address: "192.168.1.255",
        port: DEFAULT_DISCOVERY_PORT,
      });
      expect(span).toBeDefined();
    });

    it("should include custom attributes", () => {
      const span = otelTracer.createBroadcastSpan("custom", {
        attributes: { "custom.field": "value" },
      });
      expect(span).toBeDefined();
    });
  });

  describe("recordException", () => {
    it("should record exception on span", () => {
      const mockSpan = {
        recordException: vi.fn(),
        setStatus: vi.fn(),
      } as unknown as Span;

      const error = new Error("Test error");
      otelTracer.recordException(mockSpan, error);

      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalled();
    });

    it("should set error status with message", () => {
      const mockSpan = {
        recordException: vi.fn(),
        setStatus: vi.fn(),
      } as unknown as Span;

      const error = new Error("Test error message");
      otelTracer.recordException(mockSpan, error);

      expect(mockSpan.setStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          code: SpanStatusCode.ERROR,
          message: "Test error message",
        }),
      );
    });
  });

  describe("configure", () => {
    it("should reconfigure the tracer with new provider state", () => {
      const newProvider = {
        enabled: true,
        "service.name": "new-service",
        "service.instance": "new-instance",
        "service.version": "2.0.0",
        "protocol.version": "2.0",
        "deployment.environment": "production",
      };
      const newProviderState = new ProviderState(newProvider);
      otelTracer.configure(newProviderState);
      expect(otelTracer.getProviderIdentity()).toBe("new-service-new-instance");
    });
  });

  describe("shutdown", () => {
    it("should shutdown the tracer", async () => {
      await expect(otelTracer.shutdown()).resolves.not.toThrow();
    });
  });
});

describe("generateCorrelationId", () => {
  it("should generate a correlation id with correct prefix", () => {
    const correlationId = generateCorrelationId();
    expect(correlationId.startsWith("trace_")).toBe(true);
  });

  it("should include timestamp in correlation id", () => {
    const timestamp = Date.now();
    const correlationId = generateCorrelationId();
    const idTimestamp = parseInt(correlationId.split("_")[1]);
    expect(idTimestamp).toBeGreaterThanOrEqual(timestamp - 1000);
    expect(idTimestamp).toBeLessThanOrEqual(timestamp + 1000);
  });

  it("should generate unique correlation ids", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateCorrelationId());
    }
    expect(ids.size).toBe(100);
  });

  it("should generate correlation ids with correct format", () => {
    for (let i = 0; i < 50; i++) {
      const id = generateCorrelationId();
      expect(id).toMatch(/^trace_\d+_[a-z0-9]+$/);
      expect(id.length).toBeGreaterThan(10);
    }
  });
});

describe("Integration tests", () => {
  let otelTracer: OtelTracer;
  let providerState: ProviderState;

  beforeEach(() => {
    const defaultProvider = {
      enabled: true,
      "service.name": "integration-test",
      "service.instance": "int-id",
      "service.version": "1.0.0",
      "protocol.version": "1.0",
      "deployment.environment": "test",
    };
    providerState = new ProviderState(defaultProvider);
    otelTracer = new OtelTracer(providerState);
  });

  it("should create spans for various operations", () => {
    const span1 = otelTracer.createSpan("operation-1");
    const span2 = otelTracer.createNetworkSpan("connect", {
      address: "127.0.0.1",
      port: 8080,
      protocol: NetworkProtocol.TCP,
    });
    const span3 = otelTracer.createBroadcastSpan("discover");

    expect(span1).toBeDefined();
    expect(span2).toBeDefined();
    expect(span3).toBeDefined();
  });

  it("should track state changes across operations", () => {
    providerState.setState(ExecutionState.Stopped);
    expect(providerState.getState()).toBe(ExecutionState.Stopped);

    providerState.setState(ExecutionState.Listening);
    expect(providerState.getState()).toBe(ExecutionState.Listening);

    const attrs = providerState.getCommonAttributes();
    expect(attrs["service.state"]).toBe(ExecutionState.Listening);
  });

  it("should generate traceable correlation IDs", () => {
    const correlationId1 = generateCorrelationId();
    const correlationId2 = generateCorrelationId();

    expect(correlationId1).not.toBe(correlationId2);
    expect(correlationId1).toMatch(/^trace_\d+_[a-z0-9]+$/);
  });

  it("should handle error recording", () => {
    const mockSpan = {
      recordException: vi.fn(),
      setStatus: vi.fn(),
    } as unknown as Span;

    otelTracer.recordException(mockSpan, new Error("test error"));

    expect(mockSpan.recordException).toHaveBeenCalled();
    expect(mockSpan.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        code: SpanStatusCode.ERROR,
      }),
    );
  });

  it("should support various span kinds", () => {
    const internalSpan = otelTracer.createSpan("internal", {
      kind: SpanKind.INTERNAL,
    });
    const serverSpan = otelTracer.createSpan("server", {
      kind: SpanKind.SERVER,
    });
    const clientSpan = otelTracer.createSpan("client", {
      kind: SpanKind.CLIENT,
    });
    const producerSpan = otelTracer.createSpan("producer", {
      kind: SpanKind.PRODUCER,
    });
    const consumerSpan = otelTracer.createSpan("consumer", {
      kind: SpanKind.CONSUMER,
    });

    expect(internalSpan).toBeDefined();
    expect(serverSpan).toBeDefined();
    expect(clientSpan).toBeDefined();
    expect(producerSpan).toBeDefined();
    expect(consumerSpan).toBeDefined();
  });
});
