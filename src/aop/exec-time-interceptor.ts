/**
 * Execution time interception for method timing and metrics.
 * @module exec-time-interceptor
 */

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
 * Wraps an object instance with a Proxy that measures method execution times.
 *
 * Uses JavaScript Proxy to intercept all method calls, recording:
 * - Execution duration via performance.now()
 * - OpenTelemetry histogram metrics
 * - Custom execution metrics for logging
 *
 * @typeParam T - The type of object to wrap.
 * @param instance - The instance to wrap with execution time tracking.
 * @param metrics - ExecutionMetrics instance for custom metric recording.
 * @returns A proxied instance with automatic execution time measurement.
 * @example
 * ```typescript
 * const service = new MyService();
 * const wrapped = withExecutionTime(service, executionMetrics);
 *
 * // All method calls will now be timed and recorded
 * await wrapped.doSomething(); // Metrics recorded automatically
 * ```
 */
export function withExecutionTime<T extends object>(
  instance: T,
  metrics: ExecutionMetrics,
): T {
  return new Proxy(instance, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);

      if (typeof original !== "function") {
        return original;
      }

      if (!isAsyncFunction(original)) {
        return original;
      }

      return async (...args: any[]) => {
        const className = target.constructor.name;
        const methodName = String(prop);
        const start = performance.now();
        let success = true;

        try {
          return await original.apply(target, args);
        } catch (err) {
          success = false;
          throw err;
        } finally {
          const duration = performance.now() - start;

          executionTime.record(duration, {
            class: className,
            method: methodName,
          });

          metrics.recordExecutionTime(className, methodName, duration, success);
        }
      };
    },
  });
}
