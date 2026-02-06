/**
 * Execution metrics recording for method performance tracking.
 * @module exec-metrics
 */

import { inject, injectable } from "inversify";

import { TYPES } from "../aop/di-types";
import { LoggerManager } from "../common/logger";

/**
 * Execution metrics recorder for tracking method performance and reliability.
 *
 * This class provides a lightweight mechanism for recording execution metrics
 * including timing and success rates for method calls. It's designed to work
 * seamlessly with logging systems and can serve as a fallback metrics solution
 * or complement to OpenTelemetry-based metrics.
 *
 * Key Features:
 * - Method execution time tracking
 * - Success/failure rate recording
 * - Logging-based metrics (no external dependencies)
 * - Integration with LoggerManager
 * - Configurable logging levels
 *
 * @remarks
 * ExecutionMetrics is designed for scenarios where lightweight metrics
 * collection is needed without the overhead of full observability platforms.
 * It integrates directly with the application's logging system and provides
 * basic performance tracking capabilities.
 *
 * @example
 * ```typescript
 * const metrics = new ExecutionMetrics(loggerManager);
 *
 * // Record successful execution
 * metrics.recordExecutionTime("UserService", "createUser", 150.5, true);
 *
 * // Record failed execution
 * metrics.recordExecutionTime("PaymentService", "processPayment", 5000, false);
 *
 * // Output: [EXEC] UserService.createUser: 150.5000ms, success
 * //        [EXEC] PaymentService.processPayment: 5000.0000ms, failed
 * ```
 */
@injectable()
export class ExecutionMetrics {
  private readonly _logger!: ReturnType<LoggerManager["getLogger"]>;

  /**
   * Creates an ExecutionMetrics instance.
   *
   * @param loggerManager - The logger manager for obtaining the application logger.
   */
  constructor(
    @inject(TYPES.LoggerManager) loggerManager: LoggerManager | null = null,
  ) {
    this._logger = loggerManager?.getLogger() ?? (console as any); // Fallback to console if no loggerManager.
  }

  /**
   * Records execution time and success status for a method call.
   *
   * @param className - Name of the class containing the method.
   * @param methodName - Name of the method that was executed.
   * @param duration - Execution duration in milliseconds.
   * @param success - Whether the method executed successfully.
   * @example
   * ```typescript
   * metrics.recordExecutionTime("UserService", "createUser", 150.5, true);
   * ```
   */
  public recordExecutionTime(
    className: string,
    methodName: string,
    duration: number,
    success: boolean,
  ) {
    this._logger.debug(
      `[EXEC] ${className}.${methodName}: ${duration.toFixed(
        4,
      )}ms, ${success ? "success" : "failed"}.`,
    );
  }
}
