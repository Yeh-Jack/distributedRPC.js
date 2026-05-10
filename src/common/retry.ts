/**
 * Retry scheduler with exponential backoff and abort signal support.
 * @module retry
 */

import { isAbortError, sleep } from "./abort-aware";
import { retryAttempts, retryDuration } from "../metrics/otel-metrics";
import { RetryConfig, DEFAULT_RETRY_MULTIPLIER } from "./config";

/**
 * Context object passed to retry callbacks containing attempt information.
 */
export interface RetryContext {
  /** Current attempt number (1-indexed). */
  attempt: number;
  /** The error that caused the retry. */
  error: unknown;
  /** Timestamp when the retry scheduler started. */
  startTime: number;
}

/**
 * Configuration options for RetryScheduler that extends RetryConfig with event listeners.
 */
export interface RetrySchedulerOptions extends RetryConfig {
  /** Optional AbortSignal to cancel the retry scheduler. */
  signal?: AbortSignal;
  /** Callback invoked before each retry attempt. */
  onRetry?: (ctx: RetryContext) => void;
  /** Callback invoked when max retries are exhausted. */
  onExhausted?: (ctx: RetryContext) => void;
  /** Callback invoked on non-abort errors during wait. */
  onError?: (err: unknown) => void;
}

/**
 * Production-grade retry scheduler with exponential backoff and observability.
 *
 * This class implements a sophisticated retry mechanism for asynchronous operations
 * that may fail intermittently. It provides exponential backoff to prevent
 * overwhelming failing services while maintaining resilience through configurable
 * retry policies and comprehensive observability integration.
 *
 * Key Features:
 * - Exponential backoff with configurable multiplier and maximum delay
 * - AbortSignal integration for graceful cancellation
 * - OpenTelemetry metrics for retry tracking
 * - Lifecycle callbacks for retry events
 * - Infinite retry support (maxRetries = 0 or undefined)
 * - Thread-safe operation tracking
 *
 * @remarks
 * RetryScheduler is designed for production use where reliable operation retry
 * is critical. The exponential backoff prevents system overload while the
 * observability integration provides insight into retry patterns and system health.
 *
 * @example
 * ```typescript
 * // Basic usage with exponential backoff
 * const scheduler = new RetryScheduler(
 *   async () => {
 *     await connectToService();
 *   },
 *   {
 *     interval: 1000,             // Base delay: 1 second
 *     max_try: 5,                 // Maximum retry attempts
 *     backoff: {
 *       enable: true,             // Enable exponential backoff
 *       multiplier: 2.0,          // Double delay each attempt
 *       max_delay: 120000,        // Cap at 120 seconds
 *     },
 *     onRetry: (ctx) => logger.warn(`Retry attempt ${ctx.attempt}`, { error: ctx.error }),
 *     onExhausted: (ctx) => logger.error("Max retries reached", { error: ctx.error }),
 *   }
 * );
 *
 * await scheduler.run();
 *
 * // With AbortSignal for cancellation
 * const controller = new AbortController();
 * const abortableScheduler = new RetryScheduler(task, {
 *   interval: 1000,
 *   signal: controller.signal,
 * });
 *
 * // Cancel after 10 seconds
 * setTimeout(() => controller.abort(), 10000);
 * ```
 */
export class RetryScheduler {
  private readonly _startTime = Date.now();
  private _stopped = false;
  private _attempt = 0;

  /**
   * Creates a new RetryScheduler instance.
   *
   * @param _task - The async function to execute and potentially retry.
   * @param _options - Configuration options for retry behavior.
   */
  constructor(
    private readonly _task: () => Promise<void>,
    private readonly _options: RetrySchedulerOptions,
  ) {}

  /**
   * Returns the current attempt number.
   *
   * @returns The number of attempts made (0 if never run).
   */
  public getAttempt(): number {
    return this._attempt;
  }

  /**
   * Resets the attempt counter to zero.
   * Useful after a successful operation to allow fresh retry counting.
   */
  public reset() {
    this._attempt = 0;
  }

  /**
   * Executes the task with retry logic.
   * Continues retrying until success, max retries reached, or abort signal triggered.
   *
   * @returns Promise that resolves when task succeeds.
   * @throws {unknown} Rethrows the error if task fails and max retries exhausted or operation aborted.
   */
  public async run(): Promise<void> {
    while (!this._stopped) {
      try {
        this._attempt++;
        await this._task();
        return; // Success.
      } catch (err) {
        // Record retry metrics for OpenTelemetry.
        retryAttempts.add(1, { attempt: this._attempt });

        if (isAbortError(err)) {
          throw err; // Cancellation is not a failure.
        }

        const ctx: RetryContext = {
          attempt: this._attempt,
          error: err,
          startTime: this._startTime,
        };

        if (this._isExhausted()) {
          this._options.onExhausted?.(ctx);
          throw err;
        }

        this._options.onRetry?.(ctx);

        const delay = this._calculateDelay(); // Calculate delay
        await this._waitWithAbort(err, delay);
      } finally {
        // Record retry duration metrics for OpenTelemetry.
        retryDuration.record(Date.now() - this._startTime, {
          attempt: this._attempt,
        });
      }
    }
  }

  /**
   * Stops the retry scheduler.
   * The current or next iteration will exit without error.
   */
  public stop() {
    this._stopped = true;
  }

  // --------------------------------------------
  // Private Methods
  // --------------------------------------------

  // Calculate exponential backoff delay
  private _calculateDelay(): number {
    const baseDelay = this._options.interval;
    let delay = baseDelay;
    if (this._options.backoff.enabled) {
      const maxDelay = this._options.backoff.max_delay;
      let multiplier = this._options.backoff.multiplier;
      if (multiplier < 1) multiplier = DEFAULT_RETRY_MULTIPLIER; // Set to default if it's an illegal number.

      const exponentialDelay = Math.min(
        baseDelay * Math.pow(multiplier, this._attempt - 1),
        maxDelay,
      );
      delay = exponentialDelay;
    }
    return delay;
  }

  private _isExhausted(): boolean {
    const maxtry = this._options.max_retries;
    return (
      maxtry !== undefined &&
      maxtry > 0 && // Infinity retry if max_try is 0.
      this._attempt >= maxtry
    );
  }

  private async _waitWithAbort(err: any, delayMs?: number): Promise<void> {
    try {
      const sleepDuration = delayMs ?? this._options.interval;
      await sleep(sleepDuration, this._options.signal);
    } catch (sleepErr) {
      if (isAbortError(sleepErr)) {
        throw sleepErr; // Cancellation is not a failure.
      }
      this._options.onError?.(err);
    }
  }
}
