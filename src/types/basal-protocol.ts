import { randomBytes } from "crypto";

/**
 * Unknown attribute constant.
 *
 * @type {"Unknown"}
 */
export const UNKNOWN_ATTRIBUTE = "Unknown";

/**
 * Application environments.
 *
 * @public
 * @enum {string}
 */
export enum AppEnv {
  development = "development",
  production = "production",
  staging = "staging",
  test = "test",
}

/**
 * Types of meters for OpenTelemetry.
 *
 * @public
 * @enum {string}
 */
export enum MeterType {
  Application = "application",
  Network = "network",
  Host = "host",
}

/**
 * State of the server.
 *
 * @public
 * @enum {string}
 */
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
  /**
   * Version of the protocol.
   *
   * @type {string}
   */
  protocol_ver: string;

  /**
   * Metadata of the service provider.
   *
   * @type {{
   *     id: string; // A 16 bytes collision-resistant ephemeral ID. Generate it by `generateInstanceId()`.
   *     name: string; // Name of the service provider.
   *     desc: string; // Description of the service provider.
   *     version: string; // Version of the service provider.
   *   }}
   */
  provider: {
    id: string;
    name: string;
    desc: string;
    version: string;
  };
}

/**
 * Simple ID generator which creates 8 bytes of Timestamp (seconds) and 8 bytes of Randomness.
 * Because of the timestamp prefix, IDs are roughly sortable by creation time.
 *
 * @public
 * @returns {string}
 */
export function generateInstanceId(): string {
  // 1. Get current timestamp (seconds) - 4 bytes.
  const ts = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, "0");

  // 2. Get 4 random bytes - converted to 8 hex chars.
  const rand = randomBytes(4).toString("hex");

  // Total 16 hex characters.
  return `${ts}${rand}`;
}

/**
 * Get application environment from NODE_ENV. If undefined or invalid, defaults to 'development'.
 * This function checks against the AppEnv enum to ensure validity.
 *
 * @public
 * @returns {AppEnv}
 */
export function getAppEnv(): AppEnv {
  const env = process.env.NODE_ENV as any;

  // Check if the environment variable exists in the Enum values
  if (Object.values(AppEnv).includes(env)) {
    return env as AppEnv;
  }

  // Default to development if undefined or invalid (e.g., "local", "prod")
  return AppEnv.development;
}
