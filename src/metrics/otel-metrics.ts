/**
 * Metrics related to network operations for OpenTelemetry.
 */
import { metrics } from "@opentelemetry/api";

export const meter = metrics.getMeter("network"); // Or "network-services".

export const serverState = meter.createObservableGauge("server_state", {
  description: "Server state",
});

export const listenerState = meter.createObservableGauge("listener_state", {
  description: "Listener state",
});

export const activeConnections = meter.createUpDownCounter(
  "active_connections",
  { description: "Active TCP connections" }
);

export const bytesCounter = meter.createCounter("bytes_total", {
  description: "Total bytes sent and received",
  unit: "bytes",
});

export const retryAttempts = meter.createCounter("retry_attempts_total", {
  description: "Total retry attempts of a job",
});

export const retryDuration = meter.createHistogram("retry_duration", {
  description: "Retry duration of a job",
  unit: "ms",
});

export const executionTime = meter.createHistogram("method_execution_time", {
  description: "Execution time of service methods",
  unit: "ms",
});
