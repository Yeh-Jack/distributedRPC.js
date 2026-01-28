/**
 * Retry scheduler with exponential backoff and abort signal support.
 * @module retry
 */

import { isAbortError, sleep } from "./abort-aware";
import { retryAttempts, retryDuration } from "../metrics/otel-metrics";

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
 * Configuration options for RetryScheduler.
 */
export interface RetrySchedulerOptions {
  /** Base interval between retry attempts in milliseconds. */
  intervalMs: number;
  /** Maximum number of retries. undefined or 0 means infinite retries. */
  maxRetries?: number;
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
 * Scheduler for retrying failed async operations with configurable backoff.
 *
 * Supports:
 * - Configurable retry intervals and maximum attempts
 * - AbortSignal integration for cancellation
 * - OpenTelemetry metrics integration
 * - Callback hooks for retry lifecycle events
 *
 * @example
 * ```typescript
 * const scheduler = new RetryScheduler(
 *   async () => {
 *     await connectToService();
 *   },
 *   {
 *     intervalMs: 1000,
 *     maxRetries: 5,
 *     onRetry: (ctx) => console.log(`Retry attempt ${ctx.attempt}`),
 *     onExhausted: (ctx) => console.error("Max retries reached", ctx.error),
 *   }
 * );
 *
 * await scheduler.run();
 * scheduler.stop();
 * ```
 */
export class RetryScheduler {
  private readonly _startTime = Date.now();
  private _stopped = false;
  private _attempt = 0;

  /**
   * Creates a new RetryScheduler instance.
   *
   * @param task - The async function to execute and potentially retry.
   * @param options - Configuration options for retry behavior.
   */
  constructor(
    private readonly task: () => Promise<void>,
    private readonly options: RetrySchedulerOptions,
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
        await this.task();
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
          this.options.onExhausted?.(ctx);
          throw err;
        }

        this.options.onRetry?.(ctx);
        await this._waitWithAbort(err);
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

  private _isExhausted(): boolean {
    const maxtry = this.options.maxRetries;
    return (
      maxtry !== undefined &&
      maxtry > 0 && // Infinity retry if maxRetries is 0.
      this._attempt >= maxtry
    );
  }

  private async _waitWithAbort(err: any): Promise<void> {
    try {
      await sleep(this.options.intervalMs, this.options.signal);
    } catch (sleepErr) {
      if (isAbortError(sleepErr)) {
        throw sleepErr; // Cancellation is not a failure.
      }
      this.options.onError?.(err);
    }
  }
}
