import {
  metrics,
  Counter,
  Histogram,
  Meter,
  ObservableCallback,
  ObservableGauge,
  ObservableResult,
  UpDownCounter,
} from "@opentelemetry/api";
import {
  DetectedResourceAttributes,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

import { MeterType } from "../types/basal-protocol";
import { ServerStateValues } from "../metrics/otel-resource";
import {
  ProviderState,
  ATTR_SERVICE_INSTANCE,
  ATTR_SERVICE_STATE,
} from "../provider/provider-info";

/**
 * OpenTelemetry metrics module for distributed RPC.
 * Provides standardized metrics for monitoring application performance and network activity.
 * @module otel-metrics
 */

/**
 * Meter instance for application-level metrics.
 */
const _appMeter = metrics.getMeter(MeterType.Application);

/**
 * Histogram for measuring service method execution time.
 * @example
 * ```typescript
 * import { executionTime } from './otel-metrics';
 * executionTime.record(150, { method: 'processRequest', service: 'user-service' });
 * ```
 */
export const executionTime = _appMeter.createHistogram(
  "method_execution_time",
  {
    description: "Execution time of service methods",
    unit: "ms",
  },
);

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
export const retryAttempts = _appMeter.createCounter("retry_attempts_total", {
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
export const retryDuration = _appMeter.createHistogram("retry_duration", {
  description: "Retry duration of a job",
  unit: "ms",
});

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
export const serverState = _appMeter.createObservableGauge("server_state", {
  description: "Server state",
});

/**
 * Meter instance for network-level metrics.
 */
const _netMeter = metrics.getMeter(MeterType.Network);

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
export const activeConnections = _netMeter.createUpDownCounter(
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
export const bytesCounter = _netMeter.createCounter("bytes_total", {
  description: "Total bytes sent and received",
  unit: "bytes",
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
export const listenerState = _netMeter.createObservableGauge("listener_state", {
  description: "Listener state",
});

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
export const tcpConnectionDuration = _netMeter.createHistogram(
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
export const tcpConnectionsFailed = _netMeter.createCounter(
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
export const tcpDataTransferSize = _netMeter.createHistogram(
  "tcp_data_transfer_size",
  {
    description: "Size of data transferred over TCP connections",
    unit: "bytes",
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
export const udpBroadcastLatency = _netMeter.createHistogram(
  "udp_broadcast_response_time",
  {
    description: "Time to respond to UDP broadcast requests",
    unit: "ms",
  },
);

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
export const udpBroadcastRequests = _netMeter.createCounter(
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
export const udpBroadcastResponses = _netMeter.createCounter(
  "udp_broadcast_responses_total",
  {
    description: "Total UDP broadcast responses sent",
  },
);

export class OtelProviderState extends ProviderState {
  private _callback?: ObservableCallback;

  /**
   * Creates an ObservableCallback for reporting server state to OpenTelemetry.
   * The callback reports service name, instance ID, and current execution state
   * as metric attributes with a numeric state value.
   *
   * @returns ObservableCallback function that updates the metric with current state
   */
  public createCallback(): ObservableCallback {
    if (!this._callback) {
      this._callback = (observable: ObservableResult) => {
        const attr = {
          [ATTR_SERVICE_NAME]: this.provider[ATTR_SERVICE_NAME],
          [ATTR_SERVICE_INSTANCE]: this.provider[ATTR_SERVICE_INSTANCE],
          [ATTR_SERVICE_STATE]: this.state,
        };
        observable.observe(ServerStateValues[this.state], attr);
      };
    }
    return this._callback;
  }

  /**
   * Gets the cached ObservableCallback for server state reporting.
   *
   * @returns The ObservableCallback if created, undefined otherwise.
   */
  public getCallback(): ObservableCallback | undefined {
    return this._callback;
  }
}

/**
 * Provides OpenTelemetry metrics instrumentation for service providers.
 * Manages application-level and network-level meters with pre-configured metrics
 * for execution time, retries, connections, and data transfer monitoring.
 *
 * @example
 * ```typescript
 * const metrics = new OtelMeterics(resourceAttributes, providerState);
 * metrics.getExecutionTime().record(150, { method: 'processOrder' });
 * await metrics.shutdown();
 * ```
 */
export class OtelMeterics {
  /** MeterProvider instance for OpenTelemetry SDK */
  private _provider: MeterProvider;
  /** Application-level meter for business metrics */
  private _appMeter: Meter;
  /** Network-level meter for infrastructure metrics */
  private _netMeter: Meter;
  /** Optional provider state for callback-based gauges */
  private _providerState?: OtelProviderState;

  /** Histogram for method execution timing */
  private _executionTime?: Histogram;
  /** Counter for retry attempt tracking */
  private _retryAttempts?: Counter;
  /** Histogram for retry duration tracking */
  private _retryDuration?: Histogram;
  /** Observable gauge for server state reporting */
  private _serverState?: ObservableGauge;
  /** Observable gauge for listener state reporting */
  private _listenerState?: ObservableGauge;
  /** UpDownCounter for active TCP connections */
  private _activeConnections?: UpDownCounter;
  /** Counter for total bytes transferred */
  private _bytesCounter?: Counter;
  /** Counter for UDP broadcast requests received */
  private _udpBroadcastRequests?: Counter;
  /** Counter for UDP broadcast responses sent */
  private _udpBroadcastResponses?: Counter;
  /** Histogram for UDP broadcast latency */
  private _udpBroadcastLatency?: Histogram;
  /** Histogram for TCP connection duration */
  private _tcpConnectionDuration?: Histogram;
  /** Counter for failed TCP connections */
  private _tcpConnectionsFailed?: Counter;
  /** Histogram for TCP data transfer size */
  private _tcpDataTransferSize?: Histogram;

  /**
   * Constructs an OtelMeterics instance with the specified resource attributes.
   * Initializes MeterProvider, creates application and network meters,
   * sets up all metric instruments, and registers callbacks for observable gauges.
   *
   * @param providerAttr - Resource attributes (service name, instance, version) for metric identification
   * @param providerState - Optional provider state for callback-based metric reporting
   */
  constructor(
    providerAttr: DetectedResourceAttributes,
    providerState?: OtelProviderState,
  ) {
    this._provider = new MeterProvider({
      resource: resourceFromAttributes(providerAttr),
    });
    this._appMeter = this._provider.getMeter(MeterType.Application);
    this._netMeter = this._provider.getMeter(MeterType.Network);
    this._providerState = providerState;
    this._createInstruments();
    this._registerCallbacks();
  }

  /**
   * Registers ObservableCallback for server state and listener state gauges
   * if provider state is available. Called during construction.
   */
  private _registerCallbacks(): void {
    if (this._providerState) {
      const callback = this._providerState.createCallback();
      if (this._serverState) {
        this._serverState.addCallback(callback);
      }
      if (this._listenerState) {
        this._listenerState.addCallback(callback);
      }
    }
  }

  /**
   * Creates and initializes all metric instruments including histograms,
   * counters, and observable gauges for application and network metrics.
   */
  private _createInstruments(): void {
    this._executionTime = this._appMeter.createHistogram(
      "method_execution_time",
      {
        description: "Execution time of service methods",
        unit: "ms",
      },
    );
    this._retryAttempts = this._appMeter.createCounter("retry_attempts_total", {
      description: "Total retry attempts of a job",
    });
    this._retryDuration = this._appMeter.createHistogram("retry_duration", {
      description: "Retry duration of a job",
      unit: "ms",
    });
    this._serverState = this._netMeter.createObservableGauge("server_state", {
      description: "Server state",
    });
    this._listenerState = this._netMeter.createObservableGauge(
      "listener_state",
      {
        description: "Listener state",
      },
    );
    this._activeConnections = this._netMeter.createUpDownCounter(
      "active_connections",
      {
        description: "Active TCP connections",
      },
    );
    this._bytesCounter = this._appMeter.createCounter("bytes_total", {
      description: "Total bytes sent and received",
      unit: "bytes",
    });
    this._udpBroadcastRequests = this._appMeter.createCounter(
      "udp_broadcast_requests_total",
      {
        description: "Total UDP broadcast requests received",
      },
    );
    this._udpBroadcastResponses = this._appMeter.createCounter(
      "udp_broadcast_responses_total",
      {
        description: "Total UDP broadcast responses sent",
      },
    );
    this._udpBroadcastLatency = this._appMeter.createHistogram(
      "udp_broadcast_response_time",
      {
        description: "Time to respond to UDP broadcast requests",
        unit: "ms",
      },
    );
    this._tcpConnectionDuration = this._appMeter.createHistogram(
      "tcp_connection_duration",
      {
        description: "Duration of TCP connections",
        unit: "ms",
      },
    );
    this._tcpConnectionsFailed = this._appMeter.createCounter(
      "tcp_connections_failed_total",
      {
        description: "Total failed TCP connection attempts",
      },
    );
    this._tcpDataTransferSize = this._appMeter.createHistogram(
      "tcp_data_transfer_size",
      {
        description: "Size of data transferred over TCP connections",
        unit: "bytes",
      },
    );
  }

  /**
   * Gets the execution time histogram for recording method execution durations.
   *
   * @returns The Histogram instance or undefined if not initialized.
   */
  public getExecutionTime(): Histogram | undefined {
    return this._executionTime;
  }

  /**
   * Gets the retry attempts counter for tracking job retry frequency.
   *
   * @returns The Counter instance or undefined if not initialized.
   */
  public getRetryAttempts(): Counter | undefined {
    return this._retryAttempts;
  }

  /**
   * Gets the retry duration histogram for measuring time spent in retries.
   *
   * @returns The Histogram instance or undefined if not initialized.
   */
  public getRetryDuration(): Histogram | undefined {
    return this._retryDuration;
  }

  /**
   * Gets the server state observable gauge for reporting current server state.
   *
   * @returns The ObservableGauge instance or undefined if not initialized.
   */
  public getServerState(): ObservableGauge | undefined {
    return this._serverState;
  }

  /**
   * Gets the listener state observable gauge for reporting network listener status.
   *
   * @returns The ObservableGauge instance or undefined if not initialized.
   */
  public getListenerState(): ObservableGauge | undefined {
    return this._listenerState;
  }

  /**
   * Gets the active connections up/down counter for tracking TCP connection count.
   *
   * @returns The UpDownCounter instance or undefined if not initialized.
   */
  public getActiveConnections(): UpDownCounter | undefined {
    return this._activeConnections;
  }

  /**
   * Gets the bytes counter for tracking total network traffic.
   *
   * @returns The Counter instance or undefined if not initialized.
   */
  public getBytesCounter(): Counter | undefined {
    return this._bytesCounter;
  }

  /**
   * Gets the UDP broadcast requests counter for tracking discovery requests received.
   *
   * @returns The Counter instance or undefined if not initialized.
   */
  public getUdpBroadcastRequests(): Counter | undefined {
    return this._udpBroadcastRequests;
  }

  /**
   * Gets the UDP broadcast responses counter for tracking discovery responses sent.
   *
   * @returns The Counter instance or undefined if not initialized.
   */
  public getUdpBroadcastResponses(): Counter | undefined {
    return this._udpBroadcastResponses;
  }

  /**
   * Gets the UDP broadcast latency histogram for measuring discovery response times.
   *
   * @returns The Histogram instance or undefined if not initialized.
   */
  public getUdpBroadcastLatency(): Histogram | undefined {
    return this._udpBroadcastLatency;
  }

  /**
   * Gets the TCP connection duration histogram for measuring connection lifetimes.
   *
   * @returns The Histogram instance or undefined if not initialized.
   */
  public getTcpConnectionDuration(): Histogram | undefined {
    return this._tcpConnectionDuration;
  }

  /**
   * Gets the TCP connections failed counter for tracking connection errors.
   *
   * @returns The Counter instance or undefined if not initialized.
   */
  public getTcpConnectionsFailed(): Counter | undefined {
    return this._tcpConnectionsFailed;
  }

  /**
   * Gets the TCP data transfer size histogram for measuring payload sizes.
   *
   * @returns The Histogram instance or undefined if not initialized.
   */
  public getTcpDataTransferSize(): Histogram | undefined {
    return this._tcpDataTransferSize;
  }

  /**
   * Gets the network-level meter for creating additional network metrics.
   *
   * @returns The Meter instance for network metrics.
   */
  public getNetMeter(): Meter {
    return this._netMeter;
  }

  /**
   * Gets the application-level meter for creating additional application metrics.
   *
   * @returns The Meter instance for application metrics.
   */
  public getAppMeter(): Meter {
    return this._appMeter;
  }

  /**
   * Shuts down the MeterProvider and releases all resources.
   * Should be called during service shutdown to ensure proper cleanup.
   *
   * @returns Promise that resolves when shutdown is complete.
   */
  public async shutdown(): Promise<void> {
    await this._provider.shutdown();
  }
}
