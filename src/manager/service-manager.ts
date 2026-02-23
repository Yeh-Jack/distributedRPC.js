import { Server } from "net";
import { injectable } from "inversify";

import {
  AccessPoint,
  BasalProtocol,
  BroadcastResponse,
  ServiceManagerDiscovery,
  generateInstanceId,
} from "../types/basal-protocol";
import { TYPES } from "../aop/di-types";
import { createNamedUdpServer } from "../aop/container";
import { BroadcastUdpServer } from "../network/broadcast-udp-server";
import { TcpServer } from "../network/tcp-server";
import { ServiceProvider } from "../provider/service-provider";

/**
 * Central orchestration service for distributed RPC system management.
 *
 * The ServiceManager coordinates services providers, handles service discovery, and
 * manages the system's operational state. It serves as the entry point for service
 * initialization and provides coordination capabilities.
 * This service should be started up first in the whole system for services information
 * gathering and distribution.
 *
 * Key Responsibilities:
 * - Service registration and discovery coordination
 * - Protocol version management
 *
 * @remarks
 * ServiceManager accepts broadcast probing message and responses manager and system
 * configurations for provider which will be used for configuring the service provider
 * , hence start up a service with zero-configuration achived.
 *
 * @example
 * ```typescript
 * const serviceManager = container.get<ServiceManager>(TYPES.ServiceManager);
 *
 * // Initialize all services
 * await serviceManager.initialize();
 *
 * // Start all managed servers
 * await serviceManager.start();
 *
 * // Graceful shutdown
 * await serviceManager.shutdown();
 * ```
 */
@injectable()
export class ServiceManager extends ServiceProvider {
  public readonly PROTOCOL: BasalProtocol = {
    protocol_ver: "1.0.0",
    provider: {
      id: generateInstanceId(),
      name: this.constructor.name,
      desc: "Service Manager for orchestrating services.",
      version: "1.0.0",
    },
  };

  // Resources should be released during shutdown.

  /**
   * Creates a ServiceManager instance.
   */
  public constructor() {
    super();
  }

  /**
   * Retrieves a registered TCP server by name.
   *
   * @param name - The name of the TCP server to retrieve.
   * @returns The TcpServer instance or undefined if not found.
   */
  public getTcpServer(name: string): TcpServer | undefined {
    return this.tasks.get(name) as TcpServer;
  }

  /**
   * Retrieves a registered UDP server by name.
   *
   * @param name - The name of the UDP server to retrieve.
   * @returns The BroadcastUdpServer instance or undefined if not found.
   */
  public getUdpServer(name: string): BroadcastUdpServer | undefined {
    return this.tasks.get(name) as BroadcastUdpServer | undefined;
  }

  // --------------------------------------------
  // Methods forced to be implemented on subclass.
  // --------------------------------------------

  protected buildAccessPointInfo(baseInfo: AccessPoint): AccessPoint {
    baseInfo.function = ["register", "report"];
    return baseInfo;
  }

  protected override async initializingResources(): Promise<void> {
    return;
  }

  protected override async releasingResources(): Promise<void> {
    return;
  }

  protected override async reloading(): Promise<void> {
    // Disable service manager discovery task.
    const netConfig = this.configManager.getCoreConfig().net;
    netConfig.sm_discovery = ServiceManagerDiscovery.None;
    this.logger.debug(
      `ServiceManager discovery task is disabled for ${this.getArrowedIdentity()}.`,
    );
  }

  protected override async starting(): Promise<void> {
    await this.initializeTcpServer("register");
    await this._initializeBroadcastListener("reception");
  }

  protected override async stopping(): Promise<void> {
    return;
  }

  // --------------------------------------------
  // Private Methods
  // --------------------------------------------

  /**
   * Initializes and starts a broadcast UDP listener for service discovery.
   *
   * @returns Promise that resolves when the listener is started.
   */
  private async _initializeBroadcastListener(name: string): Promise<void> {
    try {
      // Prepare the ServiceManager information.
      const ap: AccessPoint = this.getTcpServerInfo("register");
      const response: BroadcastResponse = {
        manager: {
          ...this.PROTOCOL,
          provider: {
            ...this.PROTOCOL.provider,
            ...ap,
          },
        },
      };

      // Construct the UDP broadcast server.
      const broadcastServer = createNamedUdpServer(
        this.configManager,
        name,
        TYPES.BroadcastUdpServer,
      ) as unknown as BroadcastUdpServer;
      broadcastServer.setManagerInfo(response);

      await broadcastServer.start();
      this.tasks.set(name, broadcastServer);
    } catch (error) {
      this.logger.error(
        `Failed to initialize the <${name}> broadcast UDP listener: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw error;
    }
  }
}
