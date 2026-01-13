import { randomBytes } from "crypto";

export enum ServerState {
  Error = "Error",
  Halt = "Halt",
  Halting = "Halting",
  Listening = "Listening",
  Retrying = "Retrying",
  Running = "Running",
  Starting = "Starting",
  Stopping = "Stopping",
  Stopped = "Stopped",
}

/**
 * Basal protocol (a shared contract) for service providers.
 * This protocol defines the basic structure and metadata for service providers
 * in the distributed RPC framework.
 */
export interface BasalProtocol {
  protocol_ver: string;
  provider: {
    id: string; // A 8 bytes collision-resistant ephemeral ID.
    name: string;
    version: string;
  };
}

/**
 * Simple ID generator which creates 4 bytes of Timestamp (seconds) and 4 bytes of Randomness.
 * Because of the timestamp prefix, IDs are roughly sortable by creation time.
 */
export function generateInstanceId(): string {
  // 1. Get current timestamp (seconds) - 4 bytes
  const ts = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, "0");

  // 2. Get 4 random bytes - converted to 8 hex chars
  const rand = randomBytes(4).toString("hex");

  // Total 16 hex characters (8 bytes)
  return `${ts}${rand}`;
}
