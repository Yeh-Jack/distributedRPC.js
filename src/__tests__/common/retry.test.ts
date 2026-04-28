import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { RetryScheduler } from "../../common/retry";
import { sleep, isAbortError } from "../../common/abort-aware";
import { retryAttempts, retryDuration } from "../../metrics/otel-metrics";

vi.mock("../../metrics/otel-metrics", () => ({
  retryAttempts: { add: vi.fn() },
  retryDuration: { record: vi.fn() },
}));

describe("RetryScheduler", () => {
  const mockTask = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockTask.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("basic behavior", () => {
    it("should run task successfully on first attempt", async () => {
      mockTask.mockResolvedValue(undefined);

      const scheduler = new RetryScheduler(mockTask, {
        interval: 100,
        max_try: 3,
        backoff: { enable: true, multiplier: 2.0, max_delay: 120000 },
      });

      await expect(scheduler.run()).resolves.toBeUndefined();
      expect(mockTask).toHaveBeenCalledTimes(1);
      expect(scheduler.getAttempt()).toBe(1);
    });

    it("should reset attempt count when reset() is called", async () => {
      mockTask.mockResolvedValue(undefined);

      const scheduler = new RetryScheduler(mockTask, {
        interval: 100,
        max_try: 0,
        backoff: { enable: true, multiplier: 2.0, max_delay: 120000 },
      });

      await scheduler.run();
      expect(scheduler.getAttempt()).toBe(1);

      scheduler.reset();
      expect(scheduler.getAttempt()).toBe(0);
    });
  });

  describe("abort handling", () => {
    it("should rethrow immediately on AbortError", async () => {
      const abortErr = new DOMException("Aborted", "AbortError");
      mockTask.mockRejectedValue(abortErr);

      const scheduler = new RetryScheduler(mockTask, {
        interval: 100,
        max_try: 0,
        backoff: { enable: true, multiplier: 2.0, max_delay: 120000 },
      });

      vi.useRealTimers();
      await expect(scheduler.run()).rejects.toThrow("Aborted");
      expect(mockTask).toHaveBeenCalledTimes(1);
    });
  });
});

describe("isAbortError", () => {
  it("should return true for DOMException with AbortError name", () => {
    const error = new DOMException("Aborted", "AbortError");
    expect(isAbortError(error)).toBe(true);
  });

  it("should return false for regular Error", () => {
    const error = new Error("Some error");
    expect(isAbortError(error)).toBe(false);
  });

  it("should return false for null", () => {
    expect(isAbortError(null)).toBe(false);
  });

  it("should return false for undefined", () => {
    expect(isAbortError(undefined)).toBe(false);
  });
});

describe("sleep", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should resolve immediately when ms is 0", async () => {
    const result = await sleep(0);
    expect(result).toBeUndefined();
  });

  it("should resolve after specified time with fake timers", async () => {
    vi.useFakeTimers();
    const promise = sleep(100);

    vi.advanceTimersByTime(99);
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);

    vi.advanceTimersByTime(1);
    await vi.runAllTimersAsync();
    expect(resolved).toBe(true);
  });

  it("should reject when signal is already aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();

    await expect(sleep(1000, controller.signal)).rejects.toThrow("Aborted");
  });

  it("should work without signal", async () => {
    vi.useFakeTimers();
    const promise = sleep(100);

    vi.advanceTimersByTime(100);
    await expect(promise).resolves.toBeUndefined();
  });
});
