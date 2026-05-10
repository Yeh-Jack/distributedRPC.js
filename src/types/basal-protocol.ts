/**
 * Time unit constants in milliseconds.
 */
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;

/**
 * Standard keyword constants.
 */
export const DEFAULT_ENCODE = "utf-8";
export const FOLLOW_UP = "  --> ";
export const MAX_HEADER_LEN = 64;
export const NO_RESPONSE = "None";
export const PROBE_MESSAGE = "Bonjour and EnjoIT.";
export const UNKNOWN_ATTRIBUTE = "Unknown";

/**
 * Network access point for a service provider.
 * Extends SocketAddress with authorization and API capabilities.
 */
export interface AccessPoint extends SocketAddress {
  /** Authorization key for accessing this provider. */
  authorization: string;
  /** API capabilities/endpoints supported by this provider. */
  api: string[];
}

/**
 * Acknowledge type for an API request.
 * `Error` and `InvalidReqData` are forced to send if error occurs from a request.
 */
export enum AckType {
  None = "None", // No ACK.
  Single = "Single", // Send ACK to requester if no response will be sent.
  Double = "Double", // Requester send ACK back to the handler to confirm the response received.
}

/**
 * Acknowledgement values for API responses.
 * Used to indicate the result status of a request.
 */
export enum AckValue {
  /** Acknowledgement message indicating successful receipt. */
  Ack = "Ack",
  /** Error occurred while processing the request. */
  Error = "Error",
  /** Request data was invalid or malformed. */
  InvalidReqData = "InvalidReqData",
  /** No acknowledgement required. */
  None = "None",
}

/**
 * Represents a remote procedure call or API request.
 * The full RPC path is formed by joining `peer.service`, `peer.instance`, and `api`.
 */
export interface ApiCall {
  /** Identity of the calling peer (service name and instance ID). */
  peer: PeerIdentity;
  /** API path delimited by '/', identifying the procedure to invoke. */
  api: string;
  /** Arguments passed to the procedure call. */
  args: any | undefined;
  /** Unique message identifier for tracking requests. */
  msgId: string | undefined;
  /** Internal promise for correlating async responses. */
  promise?: {
    resolve: Function;
    reject: Function;
  };
}

/**
 * API counter statistics for tracking request outcomes.
 *
 * @property success - Number of successful requests
 * @property invalidRequest - Number of requests with invalid data/format
 * @property failedOnProcess - Number of requests that failed during processing
 * @property total - Total number of requests (optional, calculated from sum of others)
 */
export interface ApiCounter {
  success: number;
  invalidRequest: number;
  failedOnProcess: number;
  total?: number;
}

/**
 * Specification for an API endpoint defining request/response types and acknowledgement behavior.
 */
export interface ApiSpec {
  /** Type name for the request payload. */
  request: string;
  /** Type name for the response payload, or "None" if no response. */
  response: string;
  /** Acknowledgement type required for this API. */
  ack: AckType;
}

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
   * APIs specification.
   */
  apis: any;

  /**
   * Metadata of the service provider.
   *
   * @type {{
   * id: string; // A 16 bytes collision-resistant ephemeral ID. Generate it by `IdGenerator.shortId()`.
   * name: string; // Name of the service provider.
   * desc: string; // Description of the service provider.
   * version: string; // Version of the service provider.
   * }}
   */
  provider: {
    id: string;
    name: string;
    desc: string;
    version: string;
  };
}

/**
 * State of execution.
 *
 * @public
 * @enum {string}
 */
export enum ExecutionState {
  Error = "Error",
  Halt = "Halt",
  Halting = "Halting",
  Initializing = "Initializing",
  Listening = "Listening",
  Retrying = "Retrying",
  Running = "Running",
  Starting = "Starting",
  Stopping = "Stopping",
  Stopped = "Stopped",
}

/**
 * Interface for ID generation strategies.
 * Provides methods for generating different types of IDs used throughout the system.
 *
 * @public
 * @interface
 */
export interface IdGenerator {
  /**
   * Generates a default format ID (typically UUID v4).
   * Used for message IDs and other general-purpose identification.
   *
   * @returns {string} A unique identifier string
   */
  generate(): string;

  /**
   * Generates a fixed 16-byte ID.
   * Used for instance IDs in the service provider protocol.
   *
   * @returns {string} A 16-character hexadecimal string (8 bytes timestamp + 4 bytes randomness)
   */
  shortId(): string;
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
 * Network protocol types supported by the distributed RPC framework.
 */

export enum NetworkProtocol {
  /** Transmission Control Protocol - reliable, connection-oriented communication. */
  TCP = "TCP",
  /** User Datagram Protocol - fast, connectionless communication. */
  UDP = "UDP",
}

/**
 * Uniquely identifies a service provider instance.
 */
export interface PeerIdentity {
  /** Name of the service. */
  service: string;
  /** Unique instance identifier for this service. */
  instance: string;
}

/**
 * Complete connection information for a service provider.
 * Combines network access point details with provider metadata.
 */
export type ProviderConnectInfo = AccessPoint & BasalProtocol["provider"];

/**
 * Data structure for register a service provider.
 */
export interface RegisterInfo extends BasalProtocol {
  provider: BasalProtocol["provider"] & AccessPoint;
}

/**
 * Report data structure containing system metrics for a service provider.
 *
 * @property timestamp - Unix timestamp when the report was generated
 * @property ramUsed - RAM used by the provider process in MB
 * @property ramFree - Free RAM on the system in MB
 * @property cpuLoad - CPU load percentage (0-100)
 * @property netTx - Total network transmission with auto-scaled unit (B, KB, MB, GB)
 * @property netTxBytes - Raw network transmission in bytes
 * @property netRx - Total network received with auto-scaled unit (B, KB, MB, GB)
 * @property netRxBytes - Raw network received in bytes
 * @property apiCounter - API call statistics per endpoint (optional, only for providers with API counters)
 */
export interface ReportData {
  timestamp: number;
  state: ExecutionState;
  ramUsed: number;
  ramFree: number;
  cpuLoad: number;
  netTx: string;
  netTxBytes: number;
  netRx: string;
  netRxBytes: number;
  apiCounter?: Map<string, Omit<ApiCounter, "total">>;
}

/**
 * Arguments passed to response handlers for API calls.
 */
export interface ResponseArgs {
  /** API specification defining the contract for this call. */
  apiSpec: ApiSpec;
  /** Response data payload. */
  data: any;
  /** Acknowledgement value indicating success or failure type. */
  errType: AckValue;
  /** Original API call that triggered this response. */
  request: ApiCall;
  /** Target object or service handling the response. */
  target: any;
}

/**
 * For working with RESTful style.
 * Authorization is optional.
 */
export interface RestCall extends ApiCall {
  method: string;
  authType?: string;
  authorization?: string;
}

/**
 * Service manager discovery modes.
 * Determines how service providers locate the service manager.
 */
export const ServiceManagerDiscovery = {
  /** No service manager discovery - providers operate independently. */
  None: Symbol.for("None"),
  /** UDP broadcast-based service manager discovery. */
  UDP: Symbol.for("UdpDiscovery"),
};

/**
 * Network socket address for a service endpoint.
 */
export interface SocketAddress {
  /** Remote IP address or hostname. */
  address: string;
  /** Port number for the connection. */
  port: number;
  /** Network protocol (TCP or UDP). */
  protocol: NetworkProtocol;
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
