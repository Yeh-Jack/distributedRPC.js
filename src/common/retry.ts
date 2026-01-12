import { isAbortError, sleep } from "./abort-aware";
import { retryAttempts, retryDuration } from "../metrics/otel-metrics";

export interface RetryContext {
  attempt: number;
  error: unknown;
  startTime: number;
}

export interface RetrySchedulerOptions {
  intervalMs: number; // Retry interval in ms.
  maxRetries?: number; // undefined or 0 = infinite retries.
  signal?: AbortSignal;
  onRetry?: (ctx: RetryContext) => void;
  onExhausted?: (ctx: RetryContext) => void;
  onError?: (err: unknown) => void;
}

/*
 * Schedule retry job based on RetrySchedulerOptions.
 * You can control the retry interval and max retry counts by the RetrySchedulerOptions.
 * You construct a RetryScheduler instance by providing an async worker function and a
 * RetrySchedulerOptions argument to define how and what the scheduler should do.
 */
export class RetryScheduler {
  private readonly startTime = Date.now();
  private stopped = false;
  private attempt = 0;

  constructor(
    private readonly task: () => Promise<void>,
    private readonly options: RetrySchedulerOptions
  ) {}

  public getAttempt(): number {
    return this.attempt;
  }

  public reset() {
    this.attempt = 0;
  }

  public async run(): Promise<void> {
    while (!this.stopped) {
      try {
        this.attempt++;
        await this.task();
        return; // Success.
      } catch (err) {
        // Record retry metrics for OpenTelemetry.
        retryAttempts.add(1, { attempt: this.attempt });

        if (isAbortError(err)) {
          throw err; // Cancellation is not a failure.
        }

        const ctx: RetryContext = {
          attempt: this.attempt,
          error: err,
          startTime: this.startTime,
        };

        if (this.isExhausted()) {
          this.options.onExhausted?.(ctx);
          throw err;
        }

        this.options.onRetry?.(ctx);
        await this.waitWithAbort(err);
      } finally {
        // Record retry duration metrics for OpenTelemetry.
        retryDuration.record(Date.now() - this.startTime, {
          attempt: this.attempt,
        });
      }
    }
  }

  public stop() {
    this.stopped = true;
  }

  private isExhausted(): boolean {
    const maxtry = this.options.maxRetries;
    return (
      maxtry !== undefined &&
      maxtry > 0 && // Infinity retry if maxRetries is 0.
      this.attempt >= maxtry
    );
  }

  private async waitWithAbort(err: any): Promise<void> {
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
