import { describe, it, expect, vi, beforeEach } from "vitest";
import { TypedEventEmitter } from "../../network/typed-event-emitter";

interface TestEvents {
  connection: (peer: { address: string; port: number }) => void;
  data: (payload: Buffer) => void;
  error: (err: Error) => void;
  close: () => void;
  mixed: (a: number, b: string, c: boolean) => void;
}

describe("TypedEventEmitter", () => {
  let emitter: TypedEventEmitter<TestEvents>;

  beforeEach(() => {
    emitter = new TypedEventEmitter<TestEvents>();
  });

  describe("on()", () => {
    it("should register event listener with correct type", () => {
      const spy = vi.fn();
      emitter.on("connection", spy);
      expect(typeof emitter.on).toBe("function");
    });

    it("should call listener when event is emitted", () => {
      const spy = vi.fn();
      emitter.on("connection", spy);
      emitter.emit("connection", { address: "127.0.0.1", port: 8080 });
      expect(spy).toHaveBeenCalledWith({ address: "127.0.0.1", port: 8080 });
    });

    it("should support multiple listeners for same event", () => {
      const spy1 = vi.fn();
      const spy2 = vi.fn();
      emitter.on("connection", spy1);
      emitter.on("connection", spy2);
      emitter.emit("connection", { address: "127.0.0.1", port: 8080 });
      expect(spy1).toHaveBeenCalled();
      expect(spy2).toHaveBeenCalled();
    });

    it("should return this for method chaining", () => {
      const spy = vi.fn();
      const result = emitter.on("connection", spy);
      expect(result).toBe(emitter);
    });
  });

  describe("once()", () => {
    it("should register single-shot listener", () => {
      const spy = vi.fn();
      emitter.once("connection", spy);
      expect(typeof emitter.once).toBe("function");
    });

    it("should remove listener after emission", () => {
      const spy = vi.fn();
      emitter.once("connection", spy);
      emitter.emit("connection", { address: "127.0.0.1", port: 8080 });
      emitter.emit("connection", { address: "127.0.0.1", port: 8080 });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("should return this for method chaining", () => {
      const spy = vi.fn();
      const result = emitter.once("connection", spy);
      expect(result).toBe(emitter);
    });
  });

  describe("emit()", () => {
    it("should emit connection event with peer info", () => {
      const spy = vi.fn();
      emitter.on("connection", spy);
      const peer = { address: "192.168.1.1", port: 3000 };
      const result = emitter.emit("connection", peer);
      expect(spy).toHaveBeenCalledWith(peer);
      expect(result).toBe(true);
    });

    it("should emit data event with buffer payload", () => {
      const spy = vi.fn();
      emitter.on("data", spy);
      const data = Buffer.from("test data");
      emitter.emit("data", data);
      expect(spy).toHaveBeenCalledWith(data);
    });

    it("should emit error event with error object", () => {
      const spy = vi.fn();
      emitter.on("error", spy);
      const err = new Error("test error");
      emitter.emit("error", err);
      expect(spy).toHaveBeenCalledWith(err);
    });

    it("should emit close event without arguments", () => {
      const spy = vi.fn();
      emitter.on("close", spy);
      emitter.emit("close");
      expect(spy).toHaveBeenCalled();
    });

    it("should emit mixed event with multiple arguments", () => {
      const spy = vi.fn();
      emitter.on("mixed", spy);
      emitter.emit("mixed", 42, "hello", true);
      expect(spy).toHaveBeenCalledWith(42, "hello", true);
    });

    it("should return false when no listeners registered", () => {
      const result = emitter.emit("connection", {
        address: "127.0.0.1",
        port: 8080,
      });
      expect(result).toBe(false);
    });
  });

  describe("event handling", () => {
    it("should handle data events correctly", () => {
      const chunks: Buffer[] = [];
      emitter.on("data", (data) => chunks.push(data));
      emitter.emit("data", Buffer.from("hello"));
      emitter.emit("data", Buffer.from("world"));
      expect(chunks.length).toBe(2);
      expect(chunks[0].toString()).toBe("hello");
      expect(chunks[1].toString()).toBe("world");
    });

    it("should propagate errors to error listeners", () => {
      const errors: Error[] = [];
      emitter.on("error", (err) => errors.push(err));
      const err1 = new Error("error 1");
      const err2 = new Error("error 2");
      emitter.emit("error", err1);
      emitter.emit("error", err2);
      expect(errors.length).toBe(2);
      expect(errors[0]).toBe(err1);
      expect(errors[1]).toBe(err2);
    });
  });

  describe("off() method (inherited from EventEmitter)", () => {
    it("should remove event listener", () => {
      const spy = vi.fn();
      emitter.on("connection", spy);
      emitter.off("connection", spy);
      emitter.emit("connection", { address: "127.0.0.1", port: 8080 });
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("listenerCount() method (inherited from EventEmitter)", () => {
    it("should return correct listener count", () => {
      emitter.on("connection", vi.fn());
      emitter.on("connection", vi.fn());
      emitter.on("data", vi.fn());
      expect(emitter.listenerCount("connection")).toBe(2);
      expect(emitter.listenerCount("data")).toBe(1);
      expect(emitter.listenerCount("error")).toBe(0);
    });
  });

  describe("rawListeners() method (inherited from EventEmitter)", () => {
    it("should return raw listeners for event", () => {
      const spy1 = vi.fn();
      const spy2 = vi.fn();
      emitter.on("connection", spy1);
      emitter.on("connection", spy2);
      const listeners = emitter.rawListeners("connection");
      expect(listeners.length).toBe(2);
    });
  });
});

describe("TypedEventEmitter edge cases", () => {
  let emitter: TypedEventEmitter<TestEvents>;

  beforeEach(() => {
    emitter = new TypedEventEmitter<TestEvents>();
  });

  it("should handle emit with no arguments for empty event", () => {
    const spy = vi.fn();
    emitter.on("close", spy);
    emitter.emit("close");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("should handle multiple different event types", () => {
    const connectionSpy = vi.fn();
    const dataSpy = vi.fn();
    const errorSpy = vi.fn();

    emitter.on("connection", connectionSpy);
    emitter.on("data", dataSpy);
    emitter.on("error", errorSpy);

    emitter.emit("connection", { address: "1.2.3.4", port: 1234 });
    emitter.emit("data", Buffer.from("test"));
    emitter.emit("error", new Error("oops"));

    expect(connectionSpy).toHaveBeenCalledTimes(1);
    expect(dataSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("should work with removeAllListeners", () => {
    const spy = vi.fn();
    emitter.on("connection", spy);
    emitter.removeAllListeners("connection");
    emitter.emit("connection", { address: "127.0.0.1", port: 8080 });
    expect(spy).not.toHaveBeenCalled();
  });
});
