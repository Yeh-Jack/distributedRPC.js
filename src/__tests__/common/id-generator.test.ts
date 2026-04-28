import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DefaultIdGenerator } from "../../common/id-generator";
import { randomUUID, randomBytes } from "crypto";

vi.mock("crypto", () => ({
  randomUUID: vi.fn(),
  randomBytes: vi.fn(),
}));

describe("DefaultIdGenerator", () => {
  let generator: DefaultIdGenerator;

  beforeEach(() => {
    generator = new DefaultIdGenerator();
    vi.clearAllMocks();
  });

  describe("generate", () => {
    it("should return a UUID from randomUUID", () => {
      const mockUuid = "550e8400-e29b-41d4-a716-446655440000";
      (randomUUID as ReturnType<typeof vi.fn>).mockReturnValue(mockUuid);

      const result = generator.generate();

      expect(result).toBe(mockUuid);
      expect(randomUUID).toHaveBeenCalledTimes(1);
    });

    it("should call randomUUID each time generate is called", () => {
      (randomUUID as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce("uuid-1")
        .mockReturnValueOnce("uuid-2");

      const result1 = generator.generate();
      const result2 = generator.generate();

      expect(result1).toBe("uuid-1");
      expect(result2).toBe("uuid-2");
      expect(randomUUID).toHaveBeenCalledTimes(2);
    });
  });

  describe("shortId", () => {
    it("should return a 16-character hex string", () => {
      (randomBytes as ReturnType<typeof vi.fn>).mockReturnValue(
        Buffer.from("deadbeef", "hex"),
      );

      const result = generator.shortId();

      expect(result).toHaveLength(16);
      expect(result).toMatch(/^[0-9a-f]+$/);
    });

    it("should contain 8 hex characters from timestamp", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      (randomBytes as ReturnType<typeof vi.fn>).mockReturnValue(
        Buffer.from("0000", "hex"),
      );

      const result = generator.shortId();
      const expectedTs = Math.floor(now / 1000)
        .toString(16)
        .padStart(8, "0");

      expect(result.startsWith(expectedTs)).toBe(true);
    });

    it("should contain 8 hex characters from randomness", () => {
      (randomBytes as ReturnType<typeof vi.fn>).mockReturnValue(
        Buffer.from("deadbeef", "hex"),
      );

      const result = generator.shortId();
      const randPart = result.slice(8);

      expect(randPart).toBe("deadbeef");
    });

    it("should call randomBytes with 4 bytes", () => {
      (randomBytes as ReturnType<typeof vi.fn>).mockReturnValue(
        Buffer.from("abcd", "hex"),
      );

      generator.shortId();

      expect(randomBytes).toHaveBeenCalledWith(4);
    });

    it("should generate unique IDs on consecutive calls", () => {
      (randomBytes as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(Buffer.from("aaaa", "hex"))
        .mockReturnValueOnce(Buffer.from("bbbb", "hex"));

      const id1 = generator.shortId();
      const id2 = generator.shortId();

      expect(id1).not.toBe(id2);
    });

    it("should be lowercase hex characters only", () => {
      (randomBytes as ReturnType<typeof vi.fn>).mockReturnValue(
        Buffer.from("01234567", "hex"),
      );

      const result = generator.shortId();

      expect(result).toMatch(/^[0-9a-f]{16}$/);
    });
  });
});
