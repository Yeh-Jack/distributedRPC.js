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
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  ATTR_SERVICE_INSTANCE,
  ATTR_SERVICE_STATE,
} from "../metrics/otel-tracing";
import {
  MeterType,
  ExecutionState,
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
export const ServerStateValues: Record<ExecutionState, number> = {
  [ExecutionState.Error]: 0,
  [ExecutionState.Halt]: 35,
  [ExecutionState.Halting]: 30,
  [ExecutionState.Listening]: 25,
  [ExecutionState.Retrying]: 15,
  [ExecutionState.Running]: 20,
  [ExecutionState.Starting]: 10,
  [ExecutionState.Stopping]: 40,
  [ExecutionState.Stopped]: 45,
};

/**
 * OpenTelemetry observable gauge for tracking server state transitions.
 *
 * This class provides a thread-safe mechanism for tracking and reporting server state
 * changes through OpenTelemetry's observable gauge functionality. It maintains current
 * state information and provides callback functions for metric reporting.
 *
 * Key Features:
 * - Thread-safe state management
 * - Automatic numeric state mapping for gauges
 * - Observable callback for OpenTelemetry integration
 * - Service identification tracking
 *
 * @remarks
 * This class is used in conjunction with OpenTelemetry's MeterProvider to create
 * observable gauges that report server state changes. The numeric mapping allows
 * for easy visualization of state transitions in monitoring dashboards.
 *
 * @example
 * ```typescript
 * // Update server state
 * ServerStateMetric.setState(ServerState.Listening, "UserService", "inst-1");
 *
 * // Create observable gauge
 * const gauge = meter.createObservableGauge("server_state", {
 *   callbacks: [ServerStateMetric.createCallback()],
 * });
 * ```
 */
export class ServerStateMetric {
  private static _state: ExecutionState = ExecutionState.Stopped;
  private static _serviceName: string = UNKNOWN_ATTRIBUTE;
  private static _serviceId: string = UNKNOWN_ATTRIBUTE;

  /**
   * Sets the server state for a specific service instance with name and ID.
   * @param state - The new server state.
   * @param serviceName - The service name for metric attributes.
   * @param serviceId - The service instance ID for metric attributes.
   */
  public static setInstanceState(
    state: ExecutionState,
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
  public static setState(state: ExecutionState): void {
    this._state = state;
  }

  /**
   * Gets the current server state.
   * @returns The current server state.
   */
  public static getState(): ExecutionState {
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
        [ATTR_SERVICE_NAME]: this._serviceName,
        [ATTR_SERVICE_INSTANCE]: this._serviceId,
        [ATTR_SERVICE_STATE]: this._state,
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
export const bytesCounter = appMeter.createCounter("bytes_total", {
  description: "Total bytes sent and received",
  unit: "bytes",
});

/**
 * Counter tracking UDP broadcast requests received.
 * @remarks
 * Monitors service discovery activity and UDP broadcast volume.
 * Useful for tracking how many services are discovering this service.
 * @example
 * ```typescript
 * import { udpBroadcastRequests } from './otel-metrics';
 * udpBroadcastRequests.add(1, { service_type: 'discovery' });
 * ```
 */
export const udpBroadcastRequests = appMeter.createCounter(
  "udp_broadcast_requests_total",
  {
    description: "Total UDP broadcast requests received",
  },
);

/**
 * Counter tracking UDP broadcast responses sent.
 * @remarks
 * Monitors service discovery responses and broadcast response activity.
 * Tracks how many services we've responded to during discovery.
 * @example
 * ```typescript
 * import { udpBroadcastResponses } from './otel-metrics';
 * udpBroadcastResponses.add(1, { target_service: 'OrderService' });
 * ```
 */
export const udpBroadcastResponses = appMeter.createCounter(
  "udp_broadcast_responses_total",
  {
    description: "Total UDP broadcast responses sent",
  },
);

/**
 * Histogram measuring UDP broadcast response time.
 * @remarks
 * Records the time taken to respond to UDP broadcast requests.
 * Useful for monitoring service discovery latency.
 * @example
 * ```typescript
 * import { udpBroadcastLatency } from './otel-metrics';
 * udpBroadcastLatency.record(5, { request_type: 'service_discovery' });
 * ```
 */
export const udpBroadcastLatency = appMeter.createHistogram(
  "udp_broadcast_response_time",
  {
    description: "Time to respond to UDP broadcast requests",
    unit: "ms",
  },
);

/**
 * Histogram measuring TCP connection duration.
 * @remarks
 * Records the duration of TCP connections from establishment to closure.
 * Useful for monitoring connection patterns and potential connection leaks.
 * @example
 * ```typescript
 * import { tcpConnectionDuration } from './otel-metrics';
 * tcpConnectionDuration.record(connectionDuration, { peer_address: clientAddress });
 * ```
 */
export const tcpConnectionDuration = appMeter.createHistogram(
  "tcp_connection_duration",
  {
    description: "Duration of TCP connections",
    unit: "ms",
  },
);

/**
 * Counter tracking failed TCP connection attempts.
 * @remarks
 * Monitors TCP connection failures for troubleshooting and reliability tracking.
 * Useful for identifying network issues or service availability problems.
 * @example
 * ```typescript
 * import { tcpConnectionsFailed } from './otel-metrics';
 * tcpConnectionsFailed.add(1, { error_type: 'connection_refused', peer_address: clientAddress });
 * ```
 */
export const tcpConnectionsFailed = appMeter.createCounter(
  "tcp_connections_failed_total",
  {
    description: "Total failed TCP connection attempts",
  },
);

/**
 * Histogram measuring data transfer size over TCP connections.
 * @remarks
 * Records the size of data transferred in each TCP operation.
 * Useful for monitoring network throughput and identifying large data transfers.
 * @example
 * ```typescript
 * import { tcpDataTransferSize } from './otel-metrics';
 * tcpDataTransferSize.record(dataSize, { transfer_type: 'request', direction: 'received' });
 * ```
 */
export const tcpDataTransferSize = appMeter.createHistogram(
  "tcp_data_transfer_size",
  {
    description: "Size of data transferred over TCP connections",
    unit: "bytes",
  },
);

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
/**
 * Centralized OpenTelemetry metrics initialization and management.
 *
 * This class provides a unified interface for initializing and managing OpenTelemetry
 * metrics within distributed RPC applications. It handles metric provider setup,
 * resource configuration, and provides access to pre-configured metrics.
 *
 * Key Features:
 * - Automatic metric provider initialization
 * - Resource detection and configuration
 * - Service identity integration
 * - Pre-configured application and network metrics
 * - Prometheus exporter integration
 *
 * @remarks
 * OtelMeterics serves as the main entry point for metrics operations in the
 * distributed RPC system. It automatically detects service attributes and
 * configures the OpenTelemetry metric pipeline with appropriate resource attributes.
 *
 * @example
 * ```typescript
 * const metrics = new OtelMeterics({
 *   serviceName: "OrderService",
 *   serviceVersion: "1.0.0",
 * });
 *
 * // Record application metrics
 * executionTime.record(150, { method: "processOrder" });
 * activeConnections.add(1, { direction: "inbound" });
 * ```
 */
export class OtelMeterics {
  private _provider: MeterProvider;

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
    this._provider = new MeterProvider({
      resource: resourceFromAttributes(providerAttr),
    });
    metrics.setGlobalMeterProvider(this._provider);
  }

  /**
   * Shuts down the meter provider and releases all resources.
   * @returns Promise that resolves when shutdown is complete.
   */
  public async shutdown(): Promise<void> {
    await this._provider.shutdown();
  }
}
