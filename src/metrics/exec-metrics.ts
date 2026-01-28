/**
 * Execution metrics recording for method performance tracking.
 * @module exec-metrics
 */

import { inject, injectable } from "inversify";

import { TYPES } from "../aop/di-types";
import { LoggerManager } from "../common/logger";

/**
 * Records execution metrics for method calls.
 * Provides logging-based metrics for tracking method performance and success rates.
 *
 * @remarks
 * This class is designed to work with the AOP execution time interceptor
 * to automatically record metrics for wrapped services.
 *
 * @example
 * ```typescript
 * const metrics = new ExecutionMetrics(loggerManager);
 * metrics.recordExecutionTime("UserService", "createUser", 150, true);
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
