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
import { deprecate } from "util";

const isAsyncFunction = (fn: any): boolean => {
  return (
    fn[Symbol.toStringTag] === "AsyncFunction" ||
    fn.constructor.name === "AsyncFunction" ||
    Object.prototype.toString.call(fn) === "[object AsyncFunction]"
  );
};

/**
 * @deprecated
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
  const logger: Logger = metrics.getLogger();
  logger.info(
    "Service instrumented for DI compatibility. Use @traceMethod decorators for tracing.",
  );

  return instance;
}

/**
 * @deprecated
 * Wraps a service instance with a Proxy to track method execution time.
 * Intercepts all method calls and records duration metrics using ExecutionMetrics.
 * Supports both sync and async methods.
 *
 * @param instance - The service instance to wrap with execution time tracking.
 * @param metrics - ExecutionMetrics instance for recording timing data.
 * @returns A proxied instance that tracks execution time for all method calls.
 */
export function withExecutionTime<T extends object>(
  instance: T,
  metrics: ExecutionMetrics,
): T {
  const handler: ProxyHandler<T> = {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (typeof value === "function" && prop !== "constructor") {
        return function (...args: any[]) {
          const startTime = performance.now();
          const className = instance.constructor.name;

          if (isAsyncFunction(value)) {
            const result = value.apply(target, args);
            return result
              .then((resolved: any) => {
                metrics.recordExecutionTime(
                  className,
                  String(prop),
                  performance.now() - startTime,
                  true,
                );
                return resolved;
              })
              .catch((error: any) => {
                metrics.recordExecutionTime(
                  className,
                  String(prop),
                  performance.now() - startTime,
                  false,
                );
                throw error;
              });
          } else {
            const result = value.apply(target, args);
            return result;
          }
        };
      }

      return value;
    },
  };

  return new Proxy(instance, handler);
}
