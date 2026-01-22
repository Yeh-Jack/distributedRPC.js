import { describe, it, expect, vi, beforeEach } from "vitest";
import { withExecutionTime } from "../../aop/exec-time-interceptor";
import { ExecutionMetrics } from "../../metrics/exec-metrics";

class TestService {
  public syncMethod(): string {
    return "sync-result";
  }

  public async asyncMethod(): Promise<string> {
    return "async-result";
  }

  public syncMethodWithArgs(a: number, b: number): number {
    return a + b;
  }

  public async asyncMethodWithArgs(x: string): Promise<string> {
    return `processed: ${x}`;
  }

  public get value(): number {
    return 42;
  }
}

describe("exec-time-interceptor", () => {
  let mockMetrics: ExecutionMetrics;
  let mockRecordExecutionTime: any;

  beforeEach(() => {
    mockRecordExecutionTime = vi.fn();
    mockMetrics = {
      recordExecutionTime: mockRecordExecutionTime,
    } as unknown as ExecutionMetrics;
  });

  it("should return sync method results directly without wrapping in Promise", () => {
    const service = new TestService();
    const wrapped = withExecutionTime(service, mockMetrics);

    const result = wrapped.syncMethod();

    expect(result).toBe("sync-result");
    expect(typeof result).toBe("string");
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("should return sync method with arguments correctly", () => {
    const service = new TestService();
    const wrapped = withExecutionTime(service, mockMetrics);

    const result = wrapped.syncMethodWithArgs(5, 10);

    expect(result).toBe(15);
    expect(typeof result).toBe("number");
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("should wrap async methods in Promise", async () => {
    const service = new TestService();
    const wrapped = withExecutionTime(service, mockMetrics);

    const result = wrapped.asyncMethod();

    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBe("async-result");
  });

  it("should wrap async methods with arguments in Promise", async () => {
    const service = new TestService();
    const wrapped = withExecutionTime(service, mockMetrics);

    const result = wrapped.asyncMethodWithArgs("test");

    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBe("processed: test");
  });

  it("should not intercept property getters", () => {
    const service = new TestService();
    const wrapped = withExecutionTime(service, mockMetrics);

    const result = wrapped.value;

    expect(result).toBe(42);
    expect(typeof result).toBe("number");
  });

  it("should record metrics for async methods", async () => {
    const service = new TestService();
    const wrapped = withExecutionTime(service, mockMetrics);

    await wrapped.asyncMethod();

    expect(mockRecordExecutionTime).toHaveBeenCalledWith(
      "TestService",
      "asyncMethod",
      expect.any(Number),
      true,
    );
  });

  it("should not record metrics for sync methods", () => {
    const service = new TestService();
    const wrapped = withExecutionTime(service, mockMetrics);

    wrapped.syncMethod();

    expect(mockRecordExecutionTime).not.toHaveBeenCalled();
  });

  it("should return wrapped instance that is a Proxy", () => {
    const service = new TestService();
    const wrapped = withExecutionTime(service, mockMetrics);

    expect(wrapped).not.toBe(service);
    expect(wrapped).toBeInstanceOf(Object);
  });
});
