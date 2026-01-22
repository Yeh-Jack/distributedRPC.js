import {
  DetectedResourceAttributes,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import {
  metrics,
  ObservableCallback,
  ObservableResult,
} from "@opentelemetry/api";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import {
  MeterType,
  ServerState,
  UNKNOWN_ATTRIBUTE,
} from "../types/basal-protocol";

/**
 * OpenTelemetry metrics module for distributed RPC.
 * Provides standardized metrics for monitoring application performance and network activity.
 * @module otel-metrics
 */

/**
 * Meter instance for application-level metrics.
 */
export const appMeter = metrics.getMeter(MeterType.Application);

/**
 * Histogram for measuring service method execution time.
 * @example
 * ```typescript
 * import { executionTime } from './otel-metrics';
 * executionTime.record(150, { method: 'processRequest', service: 'user-service' });
 * ```
 */
export const executionTime = appMeter.createHistogram("method_execution_time", {
  description: "Execution time of service methods",
  unit: "ms",
});

/**
 * Counter tracking total retry attempts across all jobs.
 * @remarks
 * Incremented each time a job is retried, providing insight into system reliability
 * and potential issues requiring investigation.
 * @example
 * ```typescript
 * import { retryAttempts } from './otel-metrics';
 * retryAttempts.add(1, { jobId: 'job-123', reason: 'timeout' });
 * ```
 */
export const retryAttempts = appMeter.createCounter("retry_attempts_total", {
  description: "Total retry attempts of a job",
});

/**
 * Histogram measuring the duration of job retries.
 * @remarks
 * Records the time taken for each retry attempt, useful for identifying
 * persistent delays in job processing.
 * @example
 * ```typescript
 * import { retryDuration } from './otel-metrics';
 * retryDuration.record(500, { jobId: 'job-123', attempt: 2 });
 * ```
 */
export const retryDuration = appMeter.createHistogram("retry_duration", {
  description: "Retry duration of a job",
  unit: "ms",
});

/**
 * Meter instance for network-level metrics.
 */
export const netMeter = metrics.getMeter(MeterType.Network);

/**
 * Server state numeric mapping for metrics reporting.
 * Maps ServerState enum to numeric values for OpenTelemetry gauges.
 */
export const ServerStateValues: Record<ServerState, number> = {
  [ServerState.Error]: 0,
  [ServerState.Halt]: 35,
  [ServerState.Halting]: 30,
  [ServerState.Listening]: 25,
  [ServerState.Retrying]: 15,
  [ServerState.Running]: 20,
  [ServerState.Starting]: 10,
  [ServerState.Stopping]: 40,
  [ServerState.Stopped]: 45,
};

/**
 * Storage for server state that can be observed by OpenTelemetry.
 * Used with ObservableGauge callbacks to report dynamic server states.
 */
export class ServerStateMetric {
  private static _state: ServerState = ServerState.Stopped;
  private static _serviceName: string = UNKNOWN_ATTRIBUTE;
  private static _serviceId: string = UNKNOWN_ATTRIBUTE;

  /**
   * Sets the server state for a specific service instance with name and ID.
   * @param state - The new server state.
   * @param serviceName - The service name for metric attributes.
   * @param serviceId - The service instance ID for metric attributes.
   */
  public static setInstanceState(
    state: ServerState,
    serviceName: string,
    serviceId: string,
  ): void {
    this._state = state;
    this._serviceName = serviceName;
    this._serviceId = serviceId;
  }

  /**
   * Sets the current server state.
   * @param state - The new server state.
   */
  public static setState(state: ServerState): void {
    this._state = state;
  }

  /**
   * Gets the current server state.
   * @returns The current server state.
   */
  public static getState(): ServerState {
    return this._state;
  }

  /**
   * Gets the service name for metric attributes.
   * @returns The service name.
   */
  public static getServiceName(): string {
    return this._serviceName;
  }

  /**
   * Gets the service ID for metric attributes.
   * @returns The service ID.
   */
  public static getServiceId(): string {
    return this._serviceId;
  }

  /**
   * Creates an ObservableCallback for reporting server state to OpenTelemetry.
   * @returns A callback function compatible with ObservableGauge.addCallback().
   */
  public static createCallback(): ObservableCallback {
    return (observable: ObservableResult) => {
      observable.observe(ServerStateValues[this._state], {
        "service.name": this._serviceName,
        "service.instance.id": this._serviceId,
        state: this._state,
      });
    };
  }
}

/**
 * Observable gauge reporting the current server state.
 * @remarks
 * Used with a callback to report dynamic server states such as running, stopped, or degraded.
 * @example
 * ```typescript
 * import { serverState, ServerStateMetric } from './otel-metrics';
 * serverState.addCallback(ServerStateMetric.createCallback());
 * ServerStateMetric.setState(ServerState.Running, 'my-service');
 * ```
 */
export const serverState = netMeter.createObservableGauge("server_state", {
  description: "Server state",
});

/**
 * Observable gauge reporting the current listener state.
 * @remarks
 * Monitors the status of network listeners (e.g., TCP ports), indicating
 * whether they are actively accepting connections.
 * @example
 * ```typescript
 * import { listenerState, ServerStateMetric } from './otel-metrics';
 * listenerState.addCallback(ServerStateMetric.createCallback());
 * ServerStateMetric.setState(ServerState.Listening, 'tcp-listener');
 * ```
 */
export const listenerState = netMeter.createObservableGauge("listener_state", {
  description: "Listener state",
});

/**
 * UpDownCounter tracking active TCP connections.
 * @remarks
 * Incremented when a new connection is established and decremented when closed.
 * Useful for monitoring connection pool utilization and detecting connection leaks.
 * @example
 * ```typescript
 * import { activeConnections } from './otel-metrics';
 * activeConnections.add(1, { direction: 'inbound' });
 * ```
 */
export const activeConnections = netMeter.createUpDownCounter(
  "active_connections",
  { description: "Active TCP connections" },
);

/**
 * Counter tracking total bytes sent and received over the network.
 * @remarks
 * Monitors network throughput and bandwidth utilization. Use with 'direction'
 * attribute to distinguish between sent and received bytes.
 * @example
 * ```typescript
 * import { bytesCounter } from './otel-metrics';
 * bytesCounter.add(1024, { direction: 'sent' });
 * bytesCounter.add(2048, { direction: 'received' });
 * ```
 */
export const bytesCounter = netMeter.createCounter("bytes_total", {
  description: "Total bytes sent and received",
  unit: "bytes",
});

/**
 * Utility class for managing OpenTelemetry meter providers and meters.
 * @remarks
 * Provides static factory methods for creating meters and managing the global
 * meter provider instance. The constructor initializes a new MeterProvider
 * with the specified resource attributes and sets it as the global provider.
 * @example
 * ```typescript
 * import { OtelMeterics, listenerState, ServerStateMetric } from './otel-metrics';
 *
 * // Initialize the global meter provider
 * new OtelMeterics({ serviceName: 'distributed-rpc' });
 *
 * // Register the state callback
 * listenerState.addCallback(ServerStateMetric.createCallback());
 *
 * // Update state
 * ServerStateMetric.setState(ServerState.Running, 'my-service');
 * ```
 */
export class OtelMeterics {
  private provider: MeterProvider;

  /**
   * Creates and returns a Meter instance with the specified name.
   * @param name - The name to identify the meter.
   * @returns A Meter instance for creating instruments.
   */
  public static getMeter(name: string) {
    return metrics.getMeter(name);
  }

  /**
   * Returns the current global MeterProvider.
   * @returns The globally configured MeterProvider.
   */
  public static getMeterProvider() {
    return metrics.getMeterProvider();
  }

  /**
   * Initializes a new MeterProvider and sets it as the global meter provider.
   * @param providerAttr - Resource attributes to associate with the meter provider.
   * @example
   * ```typescript
   * new OtelMeterics({ serviceName: 'distributed-rpc', serviceVersion: '1.0.0' });
   * ```
   */
  constructor(providerAttr: DetectedResourceAttributes) {
    this.provider = new MeterProvider({
      resource: resourceFromAttributes(providerAttr),
    });
    metrics.setGlobalMeterProvider(this.provider);
  }
}
