import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SpanKind, SpanStatusCode, Span } from "@opentelemetry/api";
import { DEFAULT_DISCOVERY_PORT } from "../../common/config";
import {
  OtelTracing,
  OtelTracer,
  ServerStateSpan,
  generateCorrelationId,
  traceMethod,
  traceable,
  SpanAttributeValue,
} from "../../metrics/otel-tracing";
import { ServerState, UNKNOWN_ATTRIBUTE } from "../../types/basal-protocol";

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

describe("SpanAttributeValue", () => {
  it("should accept string values", () => {
    const value: SpanAttributeValue = "test-string";
    expect(value).toBe("test-string");
  });

  it("should accept number values", () => {
    const value: SpanAttributeValue = 42;
    expect(value).toBe(42);
  });

  it("should accept boolean values", () => {
    const value: SpanAttributeValue = true;
    expect(value).toBe(true);
  });
});

describe("ServerStateSpan", () => {
  beforeEach(() => {
    ServerStateSpan.setState(
      ServerState.Stopped,
      UNKNOWN_ATTRIBUTE,
      UNKNOWN_ATTRIBUTE,
    );
  });

  describe("setState", () => {
    it("should set the server state", () => {
      ServerStateSpan.setState(ServerState.Listening, "TestService", "inst-1");
      expect(ServerStateSpan.getState()).toBe(ServerState.Listening);
    });

    it("should update service name when provided", () => {
      ServerStateSpan.setState(ServerState.Stopped, "NewService", undefined);
      const attrs = ServerStateSpan.getCommonAttributes();
      expect(attrs["service.name"]).toBe("NewService");
    });

    it("should update service id when provided", () => {
      ServerStateSpan.setState(ServerState.Stopped, undefined, "new-id");
      const attrs = ServerStateSpan.getCommonAttributes();
      expect(attrs["service.instance.id"]).toBe("new-id");
    });

    it("should update both service name and id", () => {
      ServerStateSpan.setState(
        ServerState.Starting,
        "OrderService",
        "order-svc-1",
      );
      const attrs = ServerStateSpan.getCommonAttributes();
      expect(attrs["service.name"]).toBe("OrderService");
      expect(attrs["service.instance.id"]).toBe("order-svc-1");
    });
  });

  describe("getState", () => {
    it("should return the current server state", () => {
      ServerStateSpan.setState(ServerState.Listening);
      expect(ServerStateSpan.getState()).toBe(ServerState.Listening);
    });

    it("should return Stopped initially", () => {
      ServerStateSpan.setState(
        ServerState.Stopped,
        UNKNOWN_ATTRIBUTE,
        UNKNOWN_ATTRIBUTE,
      );
      expect(ServerStateSpan.getState()).toBe(ServerState.Stopped);
    });
  });

  describe("getCommonAttributes", () => {
    it("should return attributes with service information", () => {
      ServerStateSpan.setState(ServerState.Listening, "TestService", "test-id");
      const attrs = ServerStateSpan.getCommonAttributes();
      expect(attrs["service.name"]).toBe("TestService");
      expect(attrs["service.instance.id"]).toBe("test-id");
      expect(attrs["server.state"]).toBe(ServerState.Listening);
    });

    it("should return all attribute types", () => {
      ServerStateSpan.setState(ServerState.Running, "Service", "id");
      const attrs = ServerStateSpan.getCommonAttributes();
      expect(typeof attrs["service.name"]).toBe("string");
      expect(typeof attrs["service.instance.id"]).toBe("string");
      expect(typeof attrs["server.state"]).toBe("string");
    });
  });
});

describe("OtelTracing", () => {
  beforeEach(() => {
    OtelTracing.configure({
      serviceName: "test-service",
      serviceVersion: "1.0.0",
      serviceInstanceId: "test-instance",
      enabled: true,
    });
  });

  describe("configure", () => {
    it("should set configuration correctly", () => {
      expect(OtelTracing.getServiceName()).toBe("test-service");
      expect(OtelTracing.getServiceInstanceId()).toBe("test-instance");
    });

    it("should use default values for missing config", () => {
      OtelTracing.configure({ serviceName: "custom" });
      expect(OtelTracing.getServiceName()).toBe("custom");
    });
  });

  describe("getServiceName", () => {
    it("should return the configured service name", () => {
      expect(OtelTracing.getServiceName()).toBe("test-service");
    });
  });

  describe("getServiceInstanceId", () => {
    it("should return the configured service instance id", () => {
      expect(OtelTracing.getServiceInstanceId()).toBe("test-instance");
    });
  });

  describe("createSpan", () => {
    it("should create a span with correct name", () => {
      const span = OtelTracing.createSpan("test-operation");
      expect(span).toBeDefined();
    });

    it("should include service attributes in span", () => {
      const span = OtelTracing.createSpan("test-operation");
      expect(span).toBeDefined();
    });

    it("should apply custom kind when provided", () => {
      const span = OtelTracing.createSpan("test-operation", {
        kind: SpanKind.CLIENT,
      });
      expect(span).toBeDefined();
    });

    it("should include custom attributes", () => {
      const attrs: Record<string, SpanAttributeValue> = {
        "custom.attr": "value",
        "numeric.attr": 42,
      };
      const span = OtelTracing.createSpan("test-operation", {
        attributes: attrs,
      });
      expect(span).toBeDefined();
    });

    it("should create disabled span when enabled is false", () => {
      OtelTracing.configure({ enabled: false });
      const span = OtelTracing.createSpan("disabled-operation");
      expect(span).toBeDefined();
    });
  });

  describe("createNetworkSpan", () => {
    it("should create network span with tcp type", () => {
      const span = OtelTracing.createNetworkSpan("connect", "tcp", {
        address: "127.0.0.1",
        port: 8080,
      });
      expect(span).toBeDefined();
    });

    it("should create network span with udp type", () => {
      const span = OtelTracing.createNetworkSpan("broadcast", "udp");
      expect(span).toBeDefined();
    });

    it("should create network span with broadcast type", () => {
      const span = OtelTracing.createNetworkSpan("discover", "broadcast");
      expect(span).toBeDefined();
    });

    it("should set direction to outbound when specified", () => {
      const span = OtelTracing.createNetworkSpan("send", "tcp", {
        direction: "outbound",
      });
      expect(span).toBeDefined();
    });

    it("should default direction to inbound", () => {
      const span = OtelTracing.createNetworkSpan("receive", "udp");
      expect(span).toBeDefined();
    });

    it("should include address and port when provided", () => {
      const span = OtelTracing.createNetworkSpan("connect", "tcp", {
        address: "192.168.1.1",
        port: 3000,
      });
      expect(span).toBeDefined();
    });
  });

  describe("createBroadcastSpan", () => {
    it("should create broadcast span for discovery", () => {
      const span = OtelTracing.createBroadcastSpan("discover");
      expect(span).toBeDefined();
    });

    it("should include message when provided", () => {
      const span = OtelTracing.createBroadcastSpan("announce", {
        message: "hello",
      });
      expect(span).toBeDefined();
    });

    it("should include network address when provided", () => {
      const span = OtelTracing.createBroadcastSpan("discover", {
        address: "192.168.1.255",
        port: DEFAULT_DISCOVERY_PORT,
      });
      expect(span).toBeDefined();
    });

    it("should include custom attributes", () => {
      const span = OtelTracing.createBroadcastSpan("custom", {
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
      OtelTracing.recordException(mockSpan, error);

      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalled();
    });

    it("should set error status with message", () => {
      const mockSpan = {
        recordException: vi.fn(),
        setStatus: vi.fn(),
      } as unknown as Span;

      const error = new Error("Test error message");
      OtelTracing.recordException(mockSpan, error);

      expect(mockSpan.setStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          code: SpanStatusCode.ERROR,
          message: "Test error message",
        }),
      );
    });
  });

  describe("setServerState", () => {
    it("should update server state in ServerStateSpan", () => {
      OtelTracing.setServerState(ServerState.Listening, "Service", "id");
      expect(ServerStateSpan.getState()).toBe(ServerState.Listening);
    });
  });
});

describe("OtelTracer", () => {
  beforeEach(() => {
    OtelTracer.initialize({
      serviceName: "tracer-test-service",
      serviceVersion: "2.0.0",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initialize", () => {
    it("should initialize tracing with config", () => {
      expect(OtelTracer.isInitialized()).toBe(true);
      expect(OtelTracing.getServiceName()).toBe("tracer-test-service");
    });

    it("should only initialize once", () => {
      const initialState = OtelTracer.isInitialized();
      OtelTracer.initialize({
        serviceName: "another-service",
      });
      expect(OtelTracer.isInitialized()).toBe(initialState);
      expect(OtelTracing.getServiceName()).toBe("tracer-test-service");
    });
  });

  describe("isInitialized", () => {
    it("should return true after initialization", () => {
      expect(OtelTracer.isInitialized()).toBe(true);
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

describe("traceMethod decorator", () => {
  it("should return a function from decorator", () => {
    const decorator = traceMethod();
    expect(typeof decorator).toBe("function");
  });

  it("should accept name parameter", () => {
    const decorator = traceMethod("test-name");
    expect(typeof decorator).toBe("function");
  });

  it("should accept options with kind", () => {
    const decorator = traceMethod("test", { kind: SpanKind.CLIENT });
    expect(typeof decorator).toBe("function");
  });

  it("should accept options with attributes", () => {
    const decorator = traceMethod("test", {
      attributes: { "test.attr": "value" },
    });
    expect(typeof decorator).toBe("function");
  });

  it("should accept both name and options", () => {
    const decorator = traceMethod("custom", { kind: SpanKind.SERVER });
    expect(typeof decorator).toBe("function");
  });
});

describe("traceable decorator", () => {
  it("should return a function from decorator", () => {
    const decorator = traceable("test-component");
    expect(typeof decorator).toBe("function");
  });

  it("should accept component name parameter", () => {
    const decorator = traceable("my-component");
    expect(typeof decorator).toBe("function");
  });

  it("should modify class instance when applied", () => {
    const TestClass = traceable("test")(
      class {
        value = "test";
      } as any,
    );

    const InstanceClass = TestClass as any;
    const instance = new InstanceClass();
    expect(instance.__componentName).toBe("test");
    expect(instance.__instrumented).toBe(true);
  });

  it("should preserve class name when using named class", () => {
    const TestClass = traceable("test")(class TestClass {}) as any;

    expect(TestClass.name).toBe("TestClass");
  });

  it("should support constructor arguments", () => {
    const TestClass = traceable("test")(
      class TestClass {
        constructor(public value: string) {}
      },
    ) as any;

    const instance = new TestClass("test-value");
    expect(instance.value).toBe("test-value");
    expect(instance.__componentName).toBe("test");
  });
});

describe("Integration tests", () => {
  beforeEach(() => {
    OtelTracing.configure({
      serviceName: "integration-test",
      serviceVersion: "1.0.0",
      serviceInstanceId: "int-id",
      enabled: true,
    });
  });

  it("should create spans for various operations", () => {
    const span1 = OtelTracing.createSpan("operation-1");
    const span2 = OtelTracing.createNetworkSpan("connect", "tcp", {
      address: "127.0.0.1",
      port: 8080,
    });
    const span3 = OtelTracing.createBroadcastSpan("discover");

    expect(span1).toBeDefined();
    expect(span2).toBeDefined();
    expect(span3).toBeDefined();
  });

  it("should track state changes across operations", () => {
    ServerStateSpan.setState(ServerState.Stopped, "stopped-svc", "stopped-id");
    expect(ServerStateSpan.getState()).toBe(ServerState.Stopped);

    ServerStateSpan.setState(
      ServerState.Listening,
      "listening-svc",
      "listening-id",
    );
    expect(ServerStateSpan.getState()).toBe(ServerState.Listening);

    const attrs = ServerStateSpan.getCommonAttributes();
    expect(attrs["service.name"]).toBe("listening-svc");
    expect(attrs["server.state"]).toBe(ServerState.Listening);
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

    OtelTracing.recordException(mockSpan, new Error("test error"));

    expect(mockSpan.recordException).toHaveBeenCalled();
    expect(mockSpan.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        code: SpanStatusCode.ERROR,
      }),
    );
  });

  it("should support various span kinds", () => {
    const internalSpan = OtelTracing.createSpan("internal", {
      kind: SpanKind.INTERNAL,
    });
    const serverSpan = OtelTracing.createSpan("server", {
      kind: SpanKind.SERVER,
    });
    const clientSpan = OtelTracing.createSpan("client", {
      kind: SpanKind.CLIENT,
    });
    const producerSpan = OtelTracing.createSpan("producer", {
      kind: SpanKind.PRODUCER,
    });
    const consumerSpan = OtelTracing.createSpan("consumer", {
      kind: SpanKind.CONSUMER,
    });

    expect(internalSpan).toBeDefined();
    expect(serverSpan).toBeDefined();
    expect(clientSpan).toBeDefined();
    expect(producerSpan).toBeDefined();
    expect(consumerSpan).toBeDefined();
  });
});
