import { Server } from "net";
import { inject, injectable } from "inversify";

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
  IdGenerator,
  PeerIdentity,
  ProviderConnectInfo,
  RegisterInfo,
  ReportData,
  ResponseArgs,
  ServiceManagerDiscovery,
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
  protected override readonly PROTOCOL: BasalProtocol &
    SpecServiceManager260321;
  protected override configManager: ServiceManagerConfig;

  /** Registered service providers indexed by service name and instance ID. */
  private _services: Map<string, any> = new Map();
  /** Reports received from service providers, indexed by service name and instance ID. */
  private _reports: Map<string, Map<string, ReportData[]>> = new Map();

  // Resources should be released during shutdown.

  /**
   * Creates a ServiceManager instance.
   * @param idGenerator - The ID generator for creating message and instance IDs
   */
  public constructor(
    @inject(TYPES.IdGenerator) protected idGenerator: IdGenerator,
  ) {
    super(idGenerator);
    const serviceName = this.constructor.name;
    this.PROTOCOL = {
      ...SPEC_SVC_MGR_260321,
      provider: {
        id: idGenerator.shortId(),
        name: serviceName,
        desc: "Service Manager for orchestrating services.",
        version: "1.0.0",
      },
    };
    this.configManager = new ServiceManagerConfig(serviceName);
  }

  /**
   * Retrieves provider connection information for a peer.
   *
   * @param data - The API call containing peer information
   * @returns Provider connection info if the peer is registered, undefined otherwise
   */
  protected override async askProviderInfo(
    data: ApiCall,
  ): Promise<ProviderConnectInfo | undefined> {
    const register: RegisterInfo | undefined = this.getRegisterInfo(data.peer);
    return register ? register.provider : undefined;
  }

  /**
   * Clears all reports for a specific provider instance.
   *
   * @param peer - The peer identity containing service name and instance ID
   */
  public clearReports(peer: PeerIdentity): void {
    const serviceGroup = this._reports.get(peer.service);
    if (serviceGroup) {
      serviceGroup.delete(peer.instance);
      if (serviceGroup.size === 0) {
        this._reports.delete(peer.service);
      }
    }
  }

  /**
   * Retrieves registration info for a peer.
   *
   * @param peer - The peer identity to look up
   * @returns RegisterInfo if found, undefined otherwise
   */
  protected getRegisterInfo(peer: PeerIdentity): RegisterInfo | undefined {
    const svcGroup = this._services.get(peer.service);
    if (!svcGroup) return;
    return svcGroup[peer.instance];
  }

  /**
   * Gets all registered services with their instance IDs.
   *
   * @returns Array of peer identities
   */
  public getReportedInstances(): PeerIdentity[] {
    const instances: PeerIdentity[] = [];
    for (const [serviceName, serviceGroup] of this._reports.entries()) {
      for (const instanceId of serviceGroup.keys()) {
        instances.push({ service: serviceName, instance: instanceId });
      }
    }
    return instances;
  }

  /**
   * Gets all reports for a specific provider instance.
   *
   * @param peer - The peer identity containing service name and instance ID
   * @returns Array of ReportData or empty array if no reports exist
   */
  public getReports(peer: PeerIdentity): ReportData[] {
    const serviceGroup = this._reports.get(peer.service);
    if (!serviceGroup) return [];

    return serviceGroup.get(peer.instance) || [];
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

  /**
   * Receives and stores report data from service providers.
   *
   * @param data - The API call containing report data
   */
  public async gotReport(data: ApiCall): Promise<void> {
    const from = this.getPeerId(data);
    const reportData: ReportData = data.args;

    if (!reportData || typeof reportData !== "object") {
      this.logger.warn(`Invalid report data received from ${from}`);
      return;
    }

    // Get service and instance info from the peer
    const { service, instance } = data.peer;

    // Initialize service group if not exists
    let serviceGroup = this._reports.get(service);
    if (!serviceGroup) {
      serviceGroup = new Map();
      this._reports.set(service, serviceGroup);
    }

    // Get instance reports array
    let instanceReports = serviceGroup.get(instance);
    if (!instanceReports) {
      instanceReports = [];
      serviceGroup.set(instance, instanceReports);
    }

    // Store the report
    instanceReports.push(reportData);

    // Keep only last 60 reports to prevent memory bloat
    if (instanceReports.length > 60) {
      instanceReports.shift();
    }

    this.logger.silly(
      `${FOLLOW_UP}Report received from ${from}: RAM=${reportData.ramUsed}MB, Free=${reportData.ramFree}MB, CPU=${reportData.cpuLoad}%, NetTx=${reportData.netTx}`,
    );
  }

  /**
   * Gets the latest report for a specific provider instance.
   *
   * @param peer - The peer identity containing service name and instance ID
   * @returns The latest ReportData or undefined if no reports exist
   */
  public getLatestReport(peer: PeerIdentity): ReportData | undefined {
    const serviceGroup = this._reports.get(peer.service);
    if (!serviceGroup) return undefined;

    const instanceReports = serviceGroup.get(peer.instance);
    if (!instanceReports || instanceReports.length === 0) return undefined;

    return instanceReports[instanceReports.length - 1];
  }

  /**
   * Handles service provider registration requests.
   *
   * @param data - The API call containing registration information
   */
  protected async registrar(data: ApiCall): Promise<void> {
    const from = this.getPeerId(data);
    this._putProvider(data);
    this.logger.info(`${from} registered.`);
  }

  // --------------------------------------------
  // Methods forced to be implemented on subclass.
  // --------------------------------------------

  /**
   * Builds the access point information for the service manager.
   * Adds the "register" and "report" API endpoints to the access point.
   *
   * @param baseInfo - Base access point information
   * @returns Modified access point with API capabilities
   */
  protected buildAccessPointInfo(baseInfo: AccessPoint): AccessPoint {
    baseInfo.api = ["register", "report"];
    return baseInfo;
  }

  /**
   * Initializes the API function map with ServiceManager-specific handlers.
   * Overrides the parent implementation to register "register" and "report" handlers.
   */
  protected override initializeApiFunctionMap(): void {
    super.initializeApiFunctionMap();
    // Replace the standard function with the functions of the ServiceManager.
    this.apis.register = this.registrar;
    this.apis.report = this.gotReport;
  }

  /**
   * No-op implementation - ServiceManager does not require additional resource initialization.
   */
  protected override async initializingResources(): Promise<void> {
    return;
  }

  /**
   * No-op implementation - ServiceManager does not require additional resource cleanup.
   */
  protected override async releasingResources(): Promise<void> {
    return;
  }

  /**
   * Disables service manager discovery when reloading configuration.
   * Sets discovery mode to None to prevent redundant discovery operations.
   */
  protected override async reloading(): Promise<void> {
    // Disable service manager discovery task.
    const netConfig = this.configManager.getCoreConfig().net;
    netConfig.sm_discovery = ServiceManagerDiscovery.None;
    this.logger.debug(
      `ServiceManager discovery task is disabled for ${this.getIdentity()}.`,
    );
  }

  /**
   * Starts the ServiceManager by enabling the API channel and initializing broadcast listener.
   */
  protected override async starting(): Promise<void> {
    await this.setApiChannel(true);
    await this._initializeBroadcastListener("reception");
  }

  /**
   * Stops the ServiceManager by disabling the API channel.
   */
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

  /**
   * Stores provider registration information in the services registry.
   *
   * @param data - The API call containing registration info
   */
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
  }
}
