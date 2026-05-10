import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isAbortError, sleep } from "../../common/abort-aware";

describe("isAbortError", () => {
  it("should return true for DOMException with AbortError name", () => {
    const error = new DOMException("Aborted", "AbortError");
    expect(isAbortError(error)).toBe(true);
  });

  it("should return false for regular Error", () => {
    const error = new Error("Some error");
    expect(isAbortError(error)).toBe(false);
  });

  it("should return false for DOMException with different name", () => {
    const error = new DOMException("Not found", "NotFoundError");
    expect(isAbortError(error)).toBe(false);
  });

  it("should return false for null", () => {
    expect(isAbortError(null)).toBe(false);
  });

  it("should return false for undefined", () => {
    expect(isAbortError(undefined)).toBe(false);
  });

  it("should return false for non-object values", () => {
    expect(isAbortError("string")).toBe(false);
    expect(isAbortError(123)).toBe(false);
    expect(isAbortError(false)).toBe(false);
  });

  it("should return false for object that is not DOMException", () => {
    const error = { name: "AbortError", message: "Aborted" };
    expect(isAbortError(error)).toBe(false);
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

  it("should resolve immediately when ms is negative", async () => {
    const result = await sleep(-100);
    expect(result).toBeUndefined();
  });

  it("should resolve after specified milliseconds", async () => {
    vi.useFakeTimers();
    const promise = sleep(100);
    let isPending = true;
    promise.then(() => {
      isPending = false;
    });

    vi.advanceTimersByTime(99);
    expect(isPending).toBe(true);

    vi.advanceTimersByTime(1);
    await vi.runAllTimersAsync();
    expect(isPending).toBe(false);
  });

  it("should reject with AbortError when signal is already aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();

    await expect(sleep(1000, controller.signal)).rejects.toThrow("Aborted");
  });

  it("should reject with AbortError when signal is aborted during sleep", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const promise = sleep(1000, controller.signal);

    vi.advanceTimersByTime(500);
    controller.abort();

    await expect(promise).rejects.toThrow("Aborted");
  });

  it("should reject with AbortError with correct DOMException properties", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();

    try {
      await sleep(1000, controller.signal);
      fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DOMException);
      expect((err as DOMException).name).toBe("AbortError");
      expect((err as DOMException).message).toBe("Aborted");
    }
  });

  it("should work without signal (resolves normally)", async () => {
    vi.useFakeTimers();
    const promise = sleep(100);

    vi.advanceTimersByTime(100);
    await expect(promise).resolves.toBeUndefined();
  });

  it("should clear timeout on abort", async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
    const controller = new AbortController();
    const promise = sleep(1000, controller.signal);

    vi.advanceTimersByTime(500);
    controller.abort();

    await expect(promise).rejects.toThrow("Aborted");
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
