/**
 * Execution time interception for method timing and metrics.
 * @module exec-time-interceptor
 *
 * @deprecated This module is deprecated in favor of the new method decorator approach.
 * Use @traceMethod decorator from otel-tracing.ts instead for InversifyJS-compatible AOP.
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
 * Wraps an object instance with a Proxy that measures method execution times.
 *
 * ⚠️ DEPRECATED: This proxy-based approach breaks InversifyJS dependency injection lifecycle.
 * Use the new @traceMethod decorator from otel-tracing.ts instead for proper DI integration.
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
 * // ⚠️ DEPRECATED APPROACH
 * const service = new MyService();
 * const wrapped = withExecutionTime(service, executionMetrics);
 *
 * // All method calls will now be timed and recorded
 * await wrapped.doSomething(); // Metrics recorded automatically
 *
 * // ✅ RECOMMENDED APPROACH
 * @traceable("my_service")
 * @injectable()
 * class MyService {
 *   @traceMethod("do_something")
 *   public async doSomething(): Promise<void> {
 *     // Business logic with automatic tracing
 *   }
 * }
 * ```
 */
export function withExecutionTime<T extends object>(
  instance: T,
  metrics: ExecutionMetrics,
): T {
  console.warn(
    "⚠️ DEPRECATED: withExecutionTime() proxy-based AOP is deprecated and breaks InversifyJS lifecycle. " +
      "Use @traceMethod decorator from otel-tracing.ts instead for proper DI integration.",
  );

  return new Proxy(instance, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);

      if (typeof original !== "function") {
        return original;
      }

      if (!isAsyncFunction(original)) {
        return original;
      }

      return async function (this: any, ...args: any[]) {
        const className = target.constructor.name;
        const methodName = String(prop);
        const startTime = performance.now();
        let success = true;
        let result: any;

        try {
          result = await original.apply(this, args);
          return result;
        } catch (err) {
          success = false;
          throw err;
        } finally {
          recordExecutionMetrics(
            className,
            methodName,
            startTime,
            success,
            metrics,
            result,
          );
        }
      };
    },
  });
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
  // Return the original instance - no proxy wrapping
  // The method decorators (@traceMethod) will handle the instrumentation
  console.info(
    "✅ Service instrumented for DI compatibility. Use @traceMethod decorators for tracing.",
  );

  return instance;
}
