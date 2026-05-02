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

export const DEFAULT_RESOURCE: Required<ProviderInfo> = Object.freeze({
  enabled: false,
  [ATTR_SERVICE_NAME]: UNKNOWN_ATTRIBUTE,
  [ATTR_SERVICE_INSTANCE]: UNKNOWN_ATTRIBUTE,
  [ATTR_SERVICE_VERSION]: UNKNOWN_ATTRIBUTE,
  [ATTR_PROTOCOL_VERSION]: UNKNOWN_ATTRIBUTE,
  [ATTR_DEPLOY_ENV]: UNKNOWN_ATTRIBUTE,
});
/**
 * Service provider state tracking for OpenTelemetry span attributes.
 *
 * Maintains provider state information that is automatically included as
 * attributes in all created spans. Provides state change notifications
 * to the tracing system.
 */
export class ProviderState {
  protected provider!: ProviderInfo;
  protected state: ExecutionState = ExecutionState.Stopped;

  /**
   * Creates a ProviderState instance.
   *
   * @param provider - The provider info to associate with this state
   */
  public constructor(provider: ProviderInfo) {
    this.setProvider(provider);
  }

  /**
   * Gets common attributes for span creation.
   *
   * @returns Record containing provider identity and service state
   */
  public getCommonAttributes(): Record<string, ProviderAttributeValue> {
    return {
      [ATTR_PROVIDER_IDENTITY]: this.getProviderIdentity(),
      [ATTR_SERVICE_STATE]: this.state,
    };
  }

  /**
   * Gets the provider information.
   *
   * @returns The ProviderInfo object
   */
  public getProvider(): ProviderInfo {
    return this.provider;
  }

  /**
   * Gets the provider identity string.
   *
   * @returns Identity in format "{service.name}-{service.instance}"
   */
  public getProviderIdentity(): string {
    return `${this.provider[ATTR_SERVICE_NAME]}-${this.provider[ATTR_SERVICE_INSTANCE]}`;
  }

  /**
   * Gets current state of the provider.
   *
   * @returns The current ExecutionState
   */
  public getState(): ExecutionState {
    return this.state;
  }

  /**
   * Sets the provider information.
   *
   * @param provider - The provider info to set
   */
  public setProvider(provider: ProviderInfo): void {
    this.provider = provider;
  }

  /**
   * Sets the service provider state for span attributes.
   *
   * @param state - The new execution state
   */
  public setState(state: ExecutionState): void {
    this.state = state;
  }
}
