/**
 * Broadcast UDP server implementation for service discovery.
 * Extends UdpServer to add broadcast-specific functionality.
 * @module broadcast-udp-server
 */

import { Socket as UdpSocket, RemoteInfo } from "dgram";
import { inject, injectable } from "inversify";

import { ConfigManager } from "../common/config";
import { LoggerManager } from "../common/logger";
import { TYPES } from "../aop/di-types";
import { UdpServer } from "../network/udp-server";
import {
  BroadcastResponse,
  ServerState,
  PROBE_MESSAGE,
} from "../types/basal-protocol";
import {
  OtelTracing,
  generateCorrelationId,
} from "../metrics/otel-tracing";
import {
  udpBroadcastRequests,
  udpBroadcastResponses,
  udpBroadcastLatency,
} from "../metrics/otel-metrics";

/**
 * Specialized UDP server for service discovery via broadcast messages.
 *
 * This class extends UdpServer to provide broadcast-specific functionality for
 * service discovery in distributed systems. It responds to probe messages with
 * service catalog information, enabling zero-configuration service discovery.
 *
 * Key Features:
 * - Broadcast message handling with "Bonjour and EnjoIT." protocol
 * - ServiceManager information configuration for responses
 * - Distributed tracing for discovery operations
 * - OpenTelemetry metrics for broadcast operations
 * - Automatic validation of manager info before starting
 *
 * @remarks
 * This server is typically used by ServiceManager instances to advertise available
 * services to ServiceProviders. It implements the discovery aspect of the distributed
 * RPC architecture without requiring a centralized registry.
 *
 * @example
 * ```typescript
 * const broadcastServer = container.get<BroadcastUdpServer>(TYPES.BroadcastUdpServer);
 *
 * // Configure manager information before starting
 * broadcastServer.setManagerInfo({
 *   protocol_ver: "1.0.0",
 *   manager: { id: "mgr-1", name: "ServiceManager" },
 *   services: [
 *     { name: "OrderService", version: "1.0.0", protocol: "tcp" },
 *     { name: "PaymentService", version: "1.2.0", protocol: "tcp" }
 *   ]
 * });
 *
 * await broadcastServer.start();
 * ```
 */
@injectable()
export class BroadcastUdpServer extends UdpServer {
  private _managerInfo: BroadcastResponse | undefined = undefined;
  private _responseBuffer!: Buffer;

  constructor(
    @inject(TYPES.ConfigManager) configManager: ConfigManager,
    @inject(TYPES.LoggerManager) loggerManager: LoggerManager,
    name: string = "broadcast-udp-server",
  ) {
    super(configManager, loggerManager, name);
  }

  /**
   * Set ServiceManager information for response message to the sender of broadcast message.
   * This method should be called after the UDP server established immediately or before sendig
   * the first response message.
   *
   * @param info The information of the ServiceManager.
   */
  public setManagerInfo(info: BroadcastResponse) {
    this._managerInfo = info;
  }

  public override async start(): Promise<void> {
    await super.start();
    if (!this._managerInfo) {
      this.logger.warn(
        "ServiceManager information is not configured before starting the broadcast server.",
      );
      await this.stop(); // Stop the broadcast server to prevent cascade errors.
      throw new Error(
        `Information missing for the ${this.getArrowedName()} broadcast server.`,
      );
    }

    // Flaten managerInfo to message Buffer.
    this._responseBuffer = Buffer.from(JSON.stringify(this._managerInfo));
  }

  public override async stop(): Promise<void> {
    await super.stop();
    this._managerInfo = undefined;
    this._responseBuffer = Buffer.from("");
  }

  // --------------------------------------------
  // Protected Methods
  // --------------------------------------------

  protected override handleMessage(msg: Buffer, rinfo: RemoteInfo): void {
    // Filter illegal message first.
    if (msg.toString() !== PROBE_MESSAGE) return;

    // Safe check.
    const state = this.getState();
    const socket: UdpSocket | undefined = this.getSocket();
    if (!socket || state !== ServerState.Listening) {
      const messge = `The ${this.getArrowedName()} broadcast server not running.`;
      this.logger.error(messge);
      throw new Error(messge);
    }

    // Create distributed tracing span for the broadcast request
    const correlationId = generateCorrelationId();
    const discoverySpan = OtelTracing.createBroadcastSpan("discovery_request", {
      message: "service_probe",
      address: rinfo.address,
      port: rinfo.port,
      direction: "inbound",
      attributes: {
        "correlation.id": correlationId,
        "network.broadcast.source": `${rinfo.address}:${rinfo.port}`,
      },
    });

    const startTime = Date.now();

    try {
      // Doing things for the accepted message.
      const sender = `<${rinfo.address}:${rinfo.port}>`;
      this.logger.debug(`Received broadcast from ${sender}`);
      super.handleMessage(msg, rinfo);

      // Record metrics
      udpBroadcastRequests.add(1, {
        service_type: "service_discovery",
        correlation_id: correlationId,
      });

      // Direct reply to the sender
      socket.send(this._responseBuffer, rinfo.port, rinfo.address, (err) => {
        const responseTime = Date.now() - startTime;

        if (err) {
          this.logger.error(`Error sending response to ${sender}: ${err}`);
          discoverySpan.recordException(err);
          discoverySpan.setStatus({
            code: 2, // ERROR
            message: err.message,
          });
        } else {
          // Record success metrics
          udpBroadcastResponses.add(1, {
            target_service: "service_manager",
            correlation_id: correlationId,
          });

          udpBroadcastLatency.record(responseTime, {
            request_type: "service_discovery",
            correlation_id: correlationId,
          });

          this.logger.debug(
            `Responded ${this._responseBuffer.length} bytes to ${sender}`,
          );

          discoverySpan.setStatus({
            code: 1, // OK
          });
        }

        discoverySpan.end();
      });
    } catch (error) {
      discoverySpan.recordException(error as Error);
      discoverySpan.setStatus({
        code: 2, // ERROR
        message: (error as Error).message,
      });
      discoverySpan.end();
      throw error;
    }
  }
}
