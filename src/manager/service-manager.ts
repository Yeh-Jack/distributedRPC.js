import { Server } from "net";
import { injectable } from "inversify";

import { TYPES } from "../aop/di-types";
import { createNamedUdpServer } from "../aop/container";
import { BroadcastUdpServer } from "../network/broadcast-udp-server";
import { NetworkPeer } from "../network/network-events";
import { TcpServer } from "../network/tcp-server";
import { ServiceProvider } from "../provider/service-provider";
import {
  AccessPoint,
  AckType,
  ApiCall,
  BasalProtocol,
  PeerIdentity,
  ProviderConnectInfo,
  RegisterInfo,
  ResponseArgs,
  ServiceManagerDiscovery,
  generateInstanceId,
  FOLLOW_UP,
} from "../types/basal-protocol";
import {
  BroadcastResponse260321,
  ServiceManagerConfig,
  SpecServiceManager260321,
  SPEC_SVC_MGR_260321,
} from "./api-spec-260321";

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
  protected readonly PROTOCOL: BasalProtocol & SpecServiceManager260321 = {
    provider: {
      id: generateInstanceId(),
      name: this.constructor.name,
      desc: "Service Manager for orchestrating services.",
      version: "1.0.0",
    },
    ...SPEC_SVC_MGR_260321,
  };

  protected override configManager: ServiceManagerConfig =
    new ServiceManagerConfig(this.PROTOCOL.provider.name);

  private _services: Map<string, any> = new Map();
  // private _instances: Map<string, any> = new Map();

  // Resources should be released during shutdown.

  /**
   * Creates a ServiceManager instance.
   */
  public constructor() {
    super();
  }

  protected override async askProviderInfo(
    data: ApiCall,
  ): Promise<ProviderConnectInfo | undefined> {
    const register: RegisterInfo | undefined = this.getProvider(data.peer);
    return register ? register.provider : undefined;
  }

  protected getProvider(peer: PeerIdentity): RegisterInfo | undefined {
    const svcGroup = this._services.get(peer.service);
    if (!svcGroup) return;
    return svcGroup[peer.instance];
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
  // API functions.
  // --------------------------------------------

  public async gotReport(data: ApiCall): Promise<void> {
    //TODO
  }

  protected async registrar(data: ApiCall): Promise<void> {
    const from = this.getPeerId(data);
    this._putProvider(data);
    this.logger.info(`${from} registered.`);
  }

  // --------------------------------------------
  // Methods forced to be implemented on subclass.
  // --------------------------------------------

  protected buildAccessPointInfo(baseInfo: AccessPoint): AccessPoint {
    baseInfo.api = ["register", "report"];
    return baseInfo;
  }

  protected override initializeApiFunctionMap(): void {
    super.initializeApiFunctionMap();
    // Replace the standard function with the functions of the ServiceManager.
    this.apis.register = this.registrar;
    this.apis.report = this.gotReport;
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
      `ServiceManager discovery task is disabled for ${this.getIdentity()}.`,
    );
  }

  protected override async starting(): Promise<void> {
    await this.setApiChannel(true);
    await this._initializeBroadcastListener("reception");
  }

  protected override async stopping(): Promise<void> {
    await this.setApiChannel(false);
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
      const ap: AccessPoint = this.getTcpTaskInfo(this._TASK_CHANNEL_API);
      const appConfig = this.configManager.getAppConfig();
      const response: BroadcastResponse260321 = {
        manager: {
          ...this.PROTOCOL,
          provider: {
            ...this.PROTOCOL.provider,
            ...ap,
          },
        },
        redis: appConfig.redis,
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

  private _putProvider(data: ApiCall): void {
    const args = data.args;
    const { name: svcName, id: svcId } = args.provider;

    // Asume the svcId is unique from all providers.
    // Store this provider to the _services map.
    let svcGroup = this._services.get(svcName);
    if (!svcGroup) {
      svcGroup = {};
      this._services.set(svcName, svcGroup);
    }
    svcGroup[svcId] = args;

    // // Store this provider to the _instances map.
    // let svcInst = this._instances.get(svcId);
    // if (svcInst) {
    //   const svcOrg = svcInst.provider.name;
    //   const svcNew = args.provider.name;
    //   if (svcNew !== svcOrg) {
    //     const message = `The provider ID <${svcId}> is duplicated.`;
    //     this.logger.error(
    //       `${message}\nExisting service = <${svcOrg}>, new service = <${svcNew}>.`,
    //     );
    //     throw new Error(message);
    //   }
    // }
    // this._instances.set(svcId, args); // Add or update this provider instance.
  }
}
