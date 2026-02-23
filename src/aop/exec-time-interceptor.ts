/**
 * Execution time interception for method timing and metrics.
 * @module exec-time-interceptor
 *
 * @deprecated This module is deprecated in favor of the new method decorator approach.
 * Use @traceMethod decorator from otel-tracing.ts instead for InversifyJS-compatible AOP.
 */
import { Logger } from "winston";

import { executionTime } from "../metrics/otel-metrics";
import { ExecutionMetrics } from "../metrics/exec-metrics";

const isAsyncFunction = (fn: any): boolean => {
  return (
    fn[Symbol.toStringTag] === "AsyncFunction" ||
    fn.constructor.name === "AsyncFunction" ||
    Object.prototype.toString.call(fn) === "[object AsyncFunction]"
  );
};

/**
 * Measures method execution time and records metrics.
 *
 * @param className - Name of the class containing the method.
 * @param methodName - Name of the method that was executed.
 * @param startTime - Start time from performance.now().
 * @param success - Whether the method executed successfully.
 * @param metrics - ExecutionMetrics instance for custom metric recording.
 * @param result - The result of the method execution (optional).
 */
function recordExecutionMetrics(
  className: string,
  methodName: string,
  startTime: number,
  success: boolean,
  metrics: ExecutionMetrics,
  result?: any,
): void {
  const duration = performance.now() - startTime;

  // Record OpenTelemetry histogram metrics
  executionTime.record(duration, {
    class: className,
    method: methodName,
  });

  // Record custom execution metrics
  metrics.recordExecutionTime(className, methodName, duration, success);

  // Log the result for debugging (if needed)
  if (result !== undefined) {
    // Could add additional logging here if needed
  }
}

/**
 * Instruments a service instance with execution time tracking.
 *
 * This function provides a DI-compatible alternative to the proxy approach.
 * It's intended to be used in InversifyJS onActivation handlers.
 *
 * @param instance - The service instance to instrument.
 * @param metrics - ExecutionMetrics instance for custom metric recording.
 * @returns The original instance (no proxy wrapper).
 * @example
 * ```typescript
 * // Use in InversifyJS container
 * container.bind<MyService>(TYPES.MyService)
 *   .to(MyService)
 *   .inTransientScope()
 *   .onActivation((context, instance) => {
 *     const metrics = context.container.get(ExecutionMetrics);
 *     return instrumentService(instance, metrics);
 *   });
 * ```
 */
export function instrumentService<T extends object>(
  instance: T,
  metrics: ExecutionMetrics,
): T {
  // The method decorators (@traceMethod) will handle the instrumentation
  const logger: Logger = metrics.getLogger();
  logger.info(
    "Service instrumented for DI compatibility. Use @traceMethod decorators for tracing.",
  );

  return instance;
}
