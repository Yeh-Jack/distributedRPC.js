import { randomBytes, randomUUID } from "crypto";
import { IdGenerator } from "../types/basal-protocol";

/**
 * Default implementation of the IdGenerator interface.
 * Uses Node.js built-in UUID generation for standard IDs and
 * the existing generateInstanceId logic for short IDs.
 *
 * @public
 * @class
 * @implements {IdGenerator}
 */
export class DefaultIdGenerator implements IdGenerator {
  /**
   * Generates a UUID v4 using Node.js crypto module.
   * Used for message IDs and general-purpose identification.
   *
   * @returns {string} A UUID v4 string
   */
  public generate(): string {
    return randomUUID();
  }

  /**
   * Generates a fixed 16-byte ID with 8 bytes of timestamp (in hex) + 8 bytes of randomness (in hex).
   *
   * @returns {string} A 16-character hexadecimal string
   */
  public shortId(): string {
    // 1. Get current timestamp (seconds) - 4 bytes.
    const ts = Math.floor(Date.now() / 1000)
      .toString(16)
      .padStart(8, "0");

    // 2. Get 4 random bytes - converted to 8 hex chars.
    const rand = randomBytes(4).toString("hex");

    // Total 16 hex characters.
    return `${ts}${rand}`;
  }
}
