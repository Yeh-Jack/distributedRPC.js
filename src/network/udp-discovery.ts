/**
 * UDP discovery client for find service managers in the distributed RPC system.
 * Extends UdpClient to add discovery-specific functionality.
 * @module udp-discovery
 */

import * as os from "os";
import { injectable } from "inversify";

import { ConfigManager, DEFAULT_DISCOVERY_PORT } from "../common/config";
import { SendOptions, UdpClient } from "./udp-client";
import { BroadcastResponse, PROBE_MESSAGE } from "../types/basal-protocol";
import { generateCorrelationId } from "../metrics/otel-resource";
import { NetworkSpanOptions, OtelTracer } from "../metrics/otel-tracing";
import { NetworkDirection } from "./network-events";
import {
  udpBroadcastRequests,
  udpBroadcastResponses,
  udpBroadcastLatency,
} from "../metrics/otel-metrics";
import {
  NetworkEvent,
  NetworkPeer,
  getBroadcastAddress,
} from "../network/network-events";

/**
 * Configuration options for UDP discovery operations.
 */
export interface DiscoveryOptions extends SendOptions {
  /** Maximum number of responses to collect. Defaults to unlimited (0). */
  maxResponses: number;
}

/**
 * Result of a service discovery operation.
 */
export interface DiscoveryResult {
  /** Array of responses received from ServiceManagers. */
  responses: BroadcastResponse[];
  /** Total time taken for the discovery operation in milliseconds. */
  durationMs: number;
  /** Number of responses received. */
  responseCount: number;
}

/**
 * Specialized UDP client for service discovery via broadcast messages.
 *
 * This class extends UdpClient to provide discovery-specific functionality for
 * finding ServiceManagers in distributed systems. It broadcasts probe messages
 * and collects responses containing service information.
 *
 * Key Features:
 * - Broadcast discovery using "Bonjour and EnjoIT." protocol
 * - Automatic broadcast mode enabling
 * - Multiple response collection
 * - Configurable timeout and response limits
 * - Distributed tracing for discovery operations
 * - OpenTelemetry metrics for discovery operations
 *
 * @remarks
 * This client is typically used by ServiceProviders to discover available
 * ServiceManagers on the network. It implements the discovery aspect of the
 * distributed RPC architecture without requiring a centralized registry.
 *
 * @example
 * ```typescript
 * const discovery = container.get<UdpDiscovery>(TYPES.UdpDiscovery);
 * await discovery.start();
 *
 * // Discover ServiceManagers on the network
 * const result = await discovery.discover({
 *   timeout: 5000,
 *   maxResponses: 3
 * });
 *
 * console.log(`Found ${result.responseCount} ServiceManagers:`);
 * result.responses.forEach((response, idx) => {
 *   console.log(`${idx + 1}. ${response.manager.provider.name} at ${response.manager.provider.host}:${response.manager.provider.port}`);
 * });
 *
 * await discovery.stop();
 * ```
 */
@injectable()
export class UdpDiscovery extends UdpClient {
  public static readonly DEFAULT_OPTIONS: DiscoveryOptions = {
    address: "192.168.255.255",
    port: DEFAULT_DISCOVERY_PORT,
    maxResponses: 0, // 0 = unlimited.
    timeout: 5000, // Default to 5 seconds.
  };

  constructor(configManager: ConfigManager, name: string = "udp-discovery") {
    super(configManager, name);
    const broadcasts = getBroadcastAddress(); // Get an available broadcast address.
    if (broadcasts) {
      UdpDiscovery.DEFAULT_OPTIONS.address = broadcasts;
    }
  }

  /**
   * Starts the UDP discovery client and enables broadcast mode.
   *
   * @returns Promise that resolves when client is ready.
   * @throws Error if client fails to start or enable broadcast.
   */
  public override async start(): Promise<void> {
    await super.start();
    await this.setBroadcast(true);
    this.logger.info(
      `The ${this.getArrowedName()} UDP discovery client started with broadcast enabled.`,
    );
  }

  /**
   * Discovers ServiceManagers on the network by broadcasting a probe message.
   *
   * @param options - Discovery options including port, address, timeout, and max responses.
   * @returns Promise that resolves with discovery results.
   * @throws Error if discovery fails or times out.
   * @example
   * ```typescript
   * // Discover with default options
   * const result = await discovery.discover();
   *
   * // Discover with custom options
   * const result = await discovery.discover({
   *   port: 5707,
   *   address: "255.255.255.255",
   *   timeout: 10000,
   *   maxResponses: 5
   * });
   * ```
   */
  public async discover(
    options: DiscoveryOptions = UdpDiscovery.DEFAULT_OPTIONS,
  ): Promise<DiscoveryResult> {
    const { address, port, maxResponses, timeout = 5000 } = options;
    const correlationId = generateCorrelationId();
    const message = `${PROBE_MESSAGE}->${correlationId}`;
    const spanOptions: NetworkSpanOptions = {
      message: message,
      address,
      port,
      direction: NetworkDirection.Out,
      attributes: {
        "correlation.id": correlationId,
        "discovery.timeout": timeout,
        "discovery.max_responses": maxResponses,
      },
    };
    const providerId = this.configManager.getProviderId();
    const tracer = OtelTracer.getInstance(providerId);
    const discoverySpan = tracer.createBroadcastSpan(
      "discover_manager",
      spanOptions,
    );

    const responses: BroadcastResponse[] = [];
    const startTime = Date.now();

    try {
      // Prepare the probe message
      // const probeBuffer = Buffer.from(PROBE_MESSAGE);

      // Record metrics
      udpBroadcastRequests.add(1, {
        service_type: "discover_manager",
        correlation_id: correlationId,
      });

      this.logger.info(
        `Broadcasting discovery probe to ${address}:${port} with timeout ${timeout}ms`,
      );

      // Send probe and collect responses
      await this.start();
      const socket = this.getReadySocket();
      if (!socket) {
        throw new Error("UDP socket not available");
      }

      // Set up response collection
      // const options: SendOptions = { address, port, timeout };
      await this._collectResponses(message, options, responses, maxResponses);

      const duration = Date.now() - startTime;
      await this.stop();

      // Record success metrics
      udpBroadcastResponses.add(responses.length, {
        target_service: "service_discovery",
        correlation_id: correlationId,
      });

      udpBroadcastLatency.record(duration, {
        request_type: "service_discovery",
        correlation_id: correlationId,
      });

      this.logger.info(
        `Discovery completed: found ${responses.length} ServiceManager(s) in ${duration}ms`,
      );

      discoverySpan.setStatus({
        code: 1, // OK
      });
      discoverySpan.setAttribute("discovery.response_count", responses.length);
      discoverySpan.setAttribute("discovery.duration_ms", duration);

      return {
        responses,
        durationMs: duration,
        responseCount: responses.length,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Discovery failed after ${duration}ms: ${(error as Error).message}`,
      );

      discoverySpan.recordException(error as Error);
      discoverySpan.setStatus({
        code: 2, // ERROR
        message: (error as Error).message,
      });

      throw error;
    } finally {
      discoverySpan.end();
    }
  }

  /**
   * Convenience method to discover a single ServiceManager.
   * Returns the first response received or throws if none found.
   *
   * @param options - Discovery options.
   * @returns Promise that resolves with the first BroadcastResponse.
   * @throws Error if no ServiceManager responds within timeout.
   * @example
   * ```typescript
   * const manager = await discovery.discoverOne({ timeout: 3000 });
   * console.log(`Found manager at ${manager.manager.provider.host}:${manager.manager.provider.port}`);
   * ```
   */
  public async discoverOne(
    options: DiscoveryOptions = UdpDiscovery.DEFAULT_OPTIONS,
  ): Promise<DiscoveryResult> {
    const result = await this.discover({ ...options, maxResponses: 1 });

    if (result.responseCount === 0) {
      throw new Error("No ServiceManager found on the network.");
    } else if (result.responseCount > 1) {
      result.responses = [result.responses[0]];
      result.responseCount = 1;
    }
    return result;
  }

  // --------------------------------------------
  // Private Methods
  // --------------------------------------------

  /**
   * Bussiness logic of finding service managers.
   *
   * @private
   * @async
   * @param {string} probeMessage
   * @param {SendOptions} options
   * @param {BroadcastResponse[]} responses
   * @param {number} maxResponses
   * @returns {Promise<void>}
   */
  private async _collectResponses(
    probeMessage: string,
    options: SendOptions,
    responses: BroadcastResponse[],
    maxResponses: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const onMessage = (received: { peer: NetworkPeer; data: Buffer }) => {
        this.off(NetworkEvent.Message, onMessage);

        const { peer, data } = received;
        const peerInfo = `<${peer.address}:${peer.port}>`;

        try {
          // Attempt to parse the response as JSON
          const responseText = data.toString();
          const response: BroadcastResponse = JSON.parse(responseText);

          // Validate that it looks like a valid BroadcastResponse
          if (!response.manager || !response.manager.provider) {
            this.logger.warn(`Received invalid response from ${peerInfo}`);
            reject(new Error("Incomplete UDP response message."));
          }

          const provider = response.manager.provider;
          this.logger.debug(
            `Received response from <${provider.name}-${provider.id}> at ${peerInfo}.`,
          );

          responses.push(response);

          // Check if we've collected enough responses
          if (responses.length >= maxResponses) {
            resolve();
          }
        } catch (err) {
          this.logger.warn(
            `Failed to parse response from ${peerInfo}: ${(err as Error).message}`,
          );
          reject(new Error("Invalide UDP response message."));
        }
      };

      // Send the probe message
      this.once(NetworkEvent.Message, onMessage);
      this.sendAndWait(probeMessage, options).catch((err) => {
        reject(err);
      });
    });
  }
}
