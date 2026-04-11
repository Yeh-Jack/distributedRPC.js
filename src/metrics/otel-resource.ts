import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { createContextKey } from "@opentelemetry/api";

import {
  ATTR_SERVICE_INSTANCE,
  ATTR_SERVICE_STATE,
} from "../provider/provider-info";
import { ExecutionState } from "../types/basal-protocol";

/**
 * Context keys for OpenTelemetry propagation
 */
export const SERVICE_NAME_KEY = createContextKey(ATTR_SERVICE_NAME);
export const SERVICE_ID_KEY = createContextKey(ATTR_SERVICE_INSTANCE);
export const SERVICE_STATE_KEY = createContextKey(ATTR_SERVICE_STATE);

/**
 * Server state numeric mapping for metrics reporting.
 * Maps ServerState enum to numeric values for OpenTelemetry gauges.
 */
export const ServerStateValues: Record<ExecutionState, number> = {
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

/**
 * Generates a correlation ID for tracing purposes
 */
export function generateCorrelationId(): string {
  // Length of the generated ID must be less then MAX_MSG_ID_LEN (64) characters.
  return `trace_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}
