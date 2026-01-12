import { executionTime } from "../metrics/otel-metrics";
import { ExecutionMetrics } from "../metrics/exec-metrics";

export function withExecutionTime<T extends object>(
  instance: T,
  metrics: ExecutionMetrics
): T {
  return new Proxy(instance, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);

      if (typeof original !== "function") {
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

          // OpenTelemetry
          executionTime.record(duration, {
            class: className,
            method: methodName,
          });

          // Custom metrics
          metrics.recordExecutionTime(className, methodName, duration, success);
        }
      };
    },
  });
}
