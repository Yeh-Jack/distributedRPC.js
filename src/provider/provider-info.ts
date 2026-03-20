import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { UNKNOWN_ATTRIBUTE, ExecutionState } from "../types/basal-protocol";

/**
 * Default resource configuration.
 */

export type ProviderAttributeValue = string | number | boolean;

export const ATTR_DEPLOY_ENV = "deployment.environment";
export const ATTR_PROTOCOL_VERSION = "protocol.version";
export const ATTR_PROVIDER_IDENTITY = "provider.identity";
export const ATTR_SERVICE_INSTANCE = "service.instance";
export const ATTR_SERVICE_STATE = "service.state";

export interface ProviderInfo {
  enabled: boolean;
  [ATTR_SERVICE_NAME]: string;
  [ATTR_SERVICE_INSTANCE]: string;
  [ATTR_SERVICE_VERSION]: string;
  [ATTR_PROTOCOL_VERSION]: string;
  [ATTR_DEPLOY_ENV]: string;
}

export const DEFAULT_RESOURCE: Required<ProviderInfo> = {
  enabled: false,
  [ATTR_SERVICE_NAME]: UNKNOWN_ATTRIBUTE,
  [ATTR_SERVICE_INSTANCE]: UNKNOWN_ATTRIBUTE,
  [ATTR_SERVICE_VERSION]: UNKNOWN_ATTRIBUTE,
  [ATTR_PROTOCOL_VERSION]: UNKNOWN_ATTRIBUTE,
  [ATTR_DEPLOY_ENV]: UNKNOWN_ATTRIBUTE,
};
/**
 * Centralized server state tracking for OpenTelemetry span attributes.
 *
 * This utility class maintains server state information that is automatically
 * included as attributes in all created spans. It provides a thread-safe way
 * to track state transitions and make this information available to the
 * tracing system.
 *
 * Key Features:
 * - Thread-safe state management
 * - Automatic attribute inclusion in spans
 * - Service identity tracking
 * - State change notifications to tracing system
 *
 * @remarks
 * ServerStateSpan is used throughout the distributed RPC system to ensure
 * that all spans include relevant server state information. This enables
 * better observability and debugging capabilities by correlating spans
 * with the server's operational state.
 *
 * @example
 * ```typescript
 * // Update server state
 * ServerStateSpan.setState(ServerState.Listening, "OrderService", "inst-1");
 *
 * // Get common attributes for span creation
 * const attributes = ServerStateSpan.getCommonAttributes();
 * // Returns: { "service.name": "OrderService", "service.instance": "inst-1", "server.state": "Listening" }
 * ```
 */

export class ProviderState {
  protected provider!: ProviderInfo;
  protected state: ExecutionState = ExecutionState.Stopped;

  public constructor(provider: ProviderInfo) {
    this.setProvider(provider);
  }

  /**
   * Gets common attributes.
   */
  public getCommonAttributes(): Record<string, ProviderAttributeValue> {
    return {
      [ATTR_PROVIDER_IDENTITY]: this.getProviderIdentity(),
      [ATTR_SERVICE_STATE]: this.state,
    };
  }

  public getProvider(): ProviderInfo {
    return this.provider;
  }

  public getProviderIdentity(): string {
    return `${this.provider[ATTR_SERVICE_NAME]}-${this.provider[ATTR_SERVICE_INSTANCE]}`;
  }

  /**
   * Gets current state of the provider.
   */
  public getState(): ExecutionState {
    return this.state;
  }

  public setProvider(provider: ProviderInfo): void {
    this.provider = provider;
  }

  /**
   * Sets the service provider state for span attributes.
   */
  public setState(state: ExecutionState): void {
    this.state = state;
  }
}
