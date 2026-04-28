import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  metrics,
  ObservableResult,
  ObservableCallback,
} from "@opentelemetry/api";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import {
  OtelMeterics,
  OtelProviderState,
  executionTime,
  retryAttempts,
  retryDuration,
  serverState,
  activeConnections,
  bytesCounter,
  listenerState,
  tcpConnectionDuration,
  tcpConnectionsFailed,
  tcpDataTransferSize,
  udpBroadcastLatency,
  udpBroadcastRequests,
  udpBroadcastResponses,
} from "../../metrics/otel-metrics";
import { ExecutionState, MeterType } from "../../types/basal-protocol";
import {
  ProviderState,
  ATTR_SERVICE_INSTANCE,
  ATTR_SERVICE_STATE,
  ATTR_PROTOCOL_VERSION,
  ATTR_DEPLOY_ENV,
} from "../../provider/provider-info";

vi.mock("@opentelemetry/api", async () => {
  const actual = await import("@opentelemetry/api");
  return {
    ...actual,
    metrics: {
      ...actual.metrics,
      getMeter: vi.fn((name: string) => ({
        createHistogram: vi.fn(() => ({
          record: vi.fn(),
        })),
        createCounter: vi.fn(() => ({
          add: vi.fn(),
        })),
        createObservableGauge: vi.fn(() => ({
          addCallback: vi.fn(),
        })),
        createUpDownCounter: vi.fn(() => ({
          add: vi.fn(),
        })),
      })),
    },
  };
});

vi.mock("@opentelemetry/sdk-metrics", async () => {
  const actual = await vi.importActual<
    typeof import("@opentelemetry/sdk-metrics")
  >("@opentelemetry/sdk-metrics");

  class MockMeterProvider {
    getMeter = vi.fn(() => ({
      createHistogram: vi.fn(() => ({
        record: vi.fn(),
      })),
      createCounter: vi.fn(() => ({
        add: vi.fn(),
      })),
      createObservableGauge: vi.fn(() => ({
        addCallback: vi.fn(),
      })),
      createUpDownCounter: vi.fn(() => ({
        add: vi.fn(),
      })),
    }));
    shutdown = vi.fn().mockResolvedValue(undefined);
  }

  return {
    ...actual,
    MeterProvider: MockMeterProvider,
  };
});

describe("OtelProviderState", () => {
  let providerState: OtelProviderState;

  beforeEach(() => {
    const provider = {
      enabled: true,
      [ATTR_SERVICE_NAME]: "test-service",
      [ATTR_SERVICE_INSTANCE]: "test-instance",
      [ATTR_SERVICE_VERSION]: "1.0.0",
      [ATTR_PROTOCOL_VERSION]: "1.0",
      [ATTR_DEPLOY_ENV]: "test",
    };
    providerState = new OtelProviderState(provider);
  });

  it("should create instance with provider info", () => {
    expect(providerState).toBeDefined();
    expect(providerState.getProvider()[ATTR_SERVICE_NAME]).toBe("test-service");
  });

  it("should create callback for observable gauge", () => {
    const callback = providerState.createCallback();
    expect(callback).toBeDefined();
    expect(typeof callback).toBe("function");
  });

  it("should return cached callback on subsequent calls", () => {
    const callback1 = providerState.createCallback();
    const callback2 = providerState.createCallback();
    expect(callback1).toBe(callback2);
  });

  it("should get callback when available", () => {
    providerState.createCallback();
    const callback = providerState.getCallback();
    expect(callback).toBeDefined();
  });

  it("should return undefined for callback when not created", () => {
    const callback = providerState.getCallback();
    expect(callback).toBeUndefined();
  });

  it("should set and get state", () => {
    providerState.setState(ExecutionState.Running);
    expect(providerState.getState()).toBe(ExecutionState.Running);
  });
});

describe("OtelProviderState callback execution", () => {
  let providerState: OtelProviderState;
  let mockObserve: ReturnType<typeof vi.fn>;
  let mockObservableResult: ObservableResult;

  beforeEach(() => {
    const provider = {
      enabled: true,
      [ATTR_SERVICE_NAME]: "test-service",
      [ATTR_SERVICE_INSTANCE]: "test-instance",
      [ATTR_SERVICE_VERSION]: "1.0.0",
      [ATTR_PROTOCOL_VERSION]: "1.0",
      [ATTR_DEPLOY_ENV]: "test",
    };
    providerState = new OtelProviderState(provider);
    mockObserve = vi.fn();
    mockObservableResult = {
      observe: mockObserve,
    } as unknown as ObservableResult;
  });

  it("should observe with correct attributes when callback is invoked", () => {
    providerState.setState(ExecutionState.Running);
    const callback = providerState.createCallback();
    callback(mockObservableResult);

    expect(mockObserve).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        [ATTR_SERVICE_NAME]: "test-service",
        [ATTR_SERVICE_INSTANCE]: "test-instance",
        [ATTR_SERVICE_STATE]: ExecutionState.Running,
      }),
    );
  });

  it("should observe with correct numeric value for Running state", () => {
    providerState.setState(ExecutionState.Running);
    const callback = providerState.createCallback();
    callback(mockObservableResult);

    expect(mockObserve).toHaveBeenCalledWith(20, expect.any(Object));
  });

  it("should observe with correct numeric value for Error state", () => {
    providerState.setState(ExecutionState.Error);
    const callback = providerState.createCallback();
    callback(mockObservableResult);

    expect(mockObserve).toHaveBeenCalledWith(0, expect.any(Object));
  });

  it("should observe with correct numeric value for Stopped state", () => {
    providerState.setState(ExecutionState.Stopped);
    const callback = providerState.createCallback();
    callback(mockObservableResult);

    expect(mockObserve).toHaveBeenCalledWith(45, expect.any(Object));
  });

  it("should observe with correct numeric value for all execution states", () => {
    const expectedValues: Record<ExecutionState, number> = {
      [ExecutionState.Error]: 0,
      [ExecutionState.Halt]: 35,
      [ExecutionState.Halting]: 30,
      [ExecutionState.Initializing]: 5,
      [ExecutionState.Listening]: 25,
      [ExecutionState.Retrying]: 15,
      [ExecutionState.Running]: 20,
      [ExecutionState.Starting]: 10,
      [ExecutionState.Stopping]: 40,
      [ExecutionState.Stopped]: 45,
    };

    Object.values(ExecutionState).forEach((state) => {
      mockObserve.mockClear();
      providerState.setState(state as ExecutionState);
      const callback = providerState.createCallback();
      callback(mockObservableResult);

      expect(mockObserve).toHaveBeenCalledWith(
        expectedValues[state as ExecutionState],
        expect.any(Object),
      );
    });
  });

  it("should use the same callback reference for multiple invocations", () => {
    const callback1 = providerState.createCallback();
    callback1(mockObservableResult);
    expect(mockObserve).toHaveBeenCalledTimes(1);

    // Invoke the same callback again
    callback1(mockObservableResult);
    expect(mockObserve).toHaveBeenCalledTimes(2);
  });
});

describe("OtelMeterics", () => {
  let otelMetrics: OtelMeterics;
  let mockProviderState: OtelProviderState;
  const mockProviderAttr = {
    [ATTR_SERVICE_NAME]: "test-service",
    [ATTR_SERVICE_VERSION]: "1.0.0",
  };

  beforeEach(() => {
    mockProviderState = {
      createCallback: vi.fn().mockReturnValue(vi.fn()),
      getCallback: vi.fn(),
      getProvider: vi.fn().mockReturnValue({
        [ATTR_SERVICE_NAME]: "test-service",
        [ATTR_SERVICE_INSTANCE]: "test-instance",
      }),
      getState: vi.fn().mockReturnValue(ExecutionState.Running),
      setState: vi.fn(),
      setProvider: vi.fn(),
      getProviderIdentity: vi
        .fn()
        .mockReturnValue("test-service-test-instance"),
      getCommonAttributes: vi.fn().mockReturnValue({}),
    } as unknown as OtelProviderState;

    otelMetrics = new OtelMeterics(mockProviderAttr, mockProviderState);
  });

  it("should be defined as a class", () => {
    expect(OtelMeterics).toBeDefined();
  });

  it("should instantiate with provider attributes", () => {
    const metrics = new OtelMeterics(mockProviderAttr);
    expect(metrics).toBeDefined();
  });

  it("should instantiate with provider attributes and provider state", () => {
    expect(otelMetrics).toBeDefined();
  });

  it("should get execution time histogram", () => {
    const executionTime = otelMetrics.getExecutionTime();
    expect(executionTime).toBeDefined();
  });

  it("should get retry attempts counter", () => {
    const retryAttempts = otelMetrics.getRetryAttempts();
    expect(retryAttempts).toBeDefined();
  });

  it("should get retry duration histogram", () => {
    const retryDuration = otelMetrics.getRetryDuration();
    expect(retryDuration).toBeDefined();
  });

  it("should get server state observable gauge", () => {
    const serverState = otelMetrics.getServerState();
    expect(serverState).toBeDefined();
  });

  it("should get listener state observable gauge", () => {
    const listenerState = otelMetrics.getListenerState();
    expect(listenerState).toBeDefined();
  });

  it("should get active connections counter", () => {
    const activeConnections = otelMetrics.getActiveConnections();
    expect(activeConnections).toBeDefined();
  });

  it("should get bytes counter", () => {
    const bytesCounter = otelMetrics.getBytesCounter();
    expect(bytesCounter).toBeDefined();
  });

  it("should get UDP broadcast requests counter", () => {
    const udpBroadcastRequests = otelMetrics.getUdpBroadcastRequests();
    expect(udpBroadcastRequests).toBeDefined();
  });

  it("should get UDP broadcast responses counter", () => {
    const udpBroadcastResponses = otelMetrics.getUdpBroadcastResponses();
    expect(udpBroadcastResponses).toBeDefined();
  });

  it("should get UDP broadcast latency histogram", () => {
    const udpBroadcastLatency = otelMetrics.getUdpBroadcastLatency();
    expect(udpBroadcastLatency).toBeDefined();
  });

  it("should get TCP connection duration histogram", () => {
    const tcpConnectionDuration = otelMetrics.getTcpConnectionDuration();
    expect(tcpConnectionDuration).toBeDefined();
  });

  it("should get TCP connections failed counter", () => {
    const tcpConnectionsFailed = otelMetrics.getTcpConnectionsFailed();
    expect(tcpConnectionsFailed).toBeDefined();
  });

  it("should get TCP data transfer size histogram", () => {
    const tcpDataTransferSize = otelMetrics.getTcpDataTransferSize();
    expect(tcpDataTransferSize).toBeDefined();
  });

  it("should get network meter", () => {
    const netMeter = otelMetrics.getNetMeter();
    expect(netMeter).toBeDefined();
  });

  it("should get application meter", () => {
    const appMeter = otelMetrics.getAppMeter();
    expect(appMeter).toBeDefined();
  });

  it("should shutdown the provider", async () => {
    const metrics = new OtelMeterics(mockProviderAttr);
    await expect(metrics.shutdown()).resolves.toBeUndefined();
  });
});

describe("OtelMeterics without provider state", () => {
  const mockProviderAttr = {
    [ATTR_SERVICE_NAME]: "test-service",
    [ATTR_SERVICE_VERSION]: "1.0.0",
  };

  it("should create instruments without provider state", () => {
    const metrics = new OtelMeterics(mockProviderAttr);
    expect(metrics.getExecutionTime()).toBeDefined();
    expect(metrics.getRetryAttempts()).toBeDefined();
    expect(metrics.getRetryDuration()).toBeDefined();
    expect(metrics.getServerState()).toBeDefined();
    expect(metrics.getListenerState()).toBeDefined();
    expect(metrics.getActiveConnections()).toBeDefined();
    expect(metrics.getBytesCounter()).toBeDefined();
    expect(metrics.getUdpBroadcastRequests()).toBeDefined();
    expect(metrics.getUdpBroadcastResponses()).toBeDefined();
    expect(metrics.getUdpBroadcastLatency()).toBeDefined();
    expect(metrics.getTcpConnectionDuration()).toBeDefined();
    expect(metrics.getTcpConnectionsFailed()).toBeDefined();
    expect(metrics.getTcpDataTransferSize()).toBeDefined();
  });
});

describe("Module-level metrics", () => {
  it("executionTime should be defined", () => {
    expect(executionTime).toBeDefined();
  });

  it("retryAttempts should be defined", () => {
    expect(retryAttempts).toBeDefined();
  });

  it("retryDuration should be defined", () => {
    expect(retryDuration).toBeDefined();
  });

  it("serverState should be defined", () => {
    expect(serverState).toBeDefined();
  });

  it("activeConnections should be defined", () => {
    expect(activeConnections).toBeDefined();
  });

  it("bytesCounter should be defined", () => {
    expect(bytesCounter).toBeDefined();
  });

  it("listenerState should be defined", () => {
    expect(listenerState).toBeDefined();
  });

  it("tcpConnectionDuration should be defined", () => {
    expect(tcpConnectionDuration).toBeDefined();
  });

  it("tcpConnectionsFailed should be defined", () => {
    expect(tcpConnectionsFailed).toBeDefined();
  });

  it("tcpDataTransferSize should be defined", () => {
    expect(tcpDataTransferSize).toBeDefined();
  });

  it("udpBroadcastLatency should be defined", () => {
    expect(udpBroadcastLatency).toBeDefined();
  });

  it("udpBroadcastRequests should be defined", () => {
    expect(udpBroadcastRequests).toBeDefined();
  });

  it("udpBroadcastResponses should be defined", () => {
    expect(udpBroadcastResponses).toBeDefined();
  });
});
