import { Server } from "net";
import { inject, injectable } from "inversify";
import { DetectedResourceAttributes } from "@opentelemetry/resources";
import { ObservableCallback } from "@opentelemetry/api";

import {
  AccessPoint,
  AppEnv,
  BasalProtocol,
  BroadcastResponse,
  ServerState,
  generateInstanceId,
  getAppEnv,
  UNKNOWN_ATTRIBUTE,
} from "../types/basal-protocol";
import { TYPES } from "../aop/di-types";
import { createNamedTcpServer, createNamedUdpServer } from "../aop/container";
import { ConfigManager } from "../common/config";
import { LoggerManager } from "../common/logger";
import {
  OtelMeterics,
  listenerState,
  ServerStateMetric,
} from "../metrics/otel-metrics";
import { BroadcastUdpServer } from "../network/broadcast-udp-server";
import { NetworkProtocol, getHostIP } from "../network/network-events";
import { TcpServer } from "../network/tcp-server";

@injectable()
export class ServiceManager {
  public readonly PROTOCOL: BasalProtocol = {
    protocol_ver: "1.0.0",
    provider: {
      id: generateInstanceId(),
      name: this.constructor.name,
      desc: "Service Manager for orchestrating services.",
      version: "1.0.0",
    },
  };

  protected configManager!: ConfigManager;
  protected logger!: ReturnType<LoggerManager["getLogger"]>;

  private initialized: boolean = false;
  private loggerManager!: LoggerManager;
  private state: ServerState = ServerState.Stopped;

  // Resources should be released during shutdown.
  private metrics!: OtelMeterics;
  private metricsCallback?: ObservableCallback;
  private services: Map<string, any> = new Map();

  /**
   * Creates a ServiceManager instance with the provided dependencies.
   *
   * @param configManager - The configuration manager for retrieving service settings.
   * @param loggerManager - The logger manager for obtaining the application logger.
   */
  public constructor(
    @inject(TYPES.ConfigManager) configManager: ConfigManager,
    @inject(TYPES.LoggerManager) loggerManager: LoggerManager,
  ) {
    this.setConfigManager(configManager);
    this.setLoggerManager(loggerManager);
    this.initializeMetrics();
  }

  /**
   * Get the unique identity string of the service instance with "<>".
   *
   * @returns The unique identity string.
   */
  protected getArrowedIdentity(): string {
    return `<${this.getIdentity()}>`;
  }

  /**
   * Get the unique identity string of the service instance.
   *
   * @returns The unique identity string.
   */
  protected getIdentity(): string {
    return `${this.PROTOCOL.provider.name}-${this.PROTOCOL.provider.id}`;
  }

  /**
   * Returns the metrics instance for this service.
   *
   * @returns The OtelMeterics instance.
   */
  public getMetrics(): OtelMeterics {
    return this.metrics;
  }

  /**
   * Returns the configured service name.
   *
   * @returns The service name from configuration.
   */
  public getServiceName(): string {
    return this.configManager.getCoreConfig().service_name;
  }

  /**
   * Retrieves a registered TCP server by name.
   *
   * @param name - The name of the TCP server to retrieve.
   * @returns The TcpServer instance or undefined if not found.
   */
  public getTcpServer(name: string): TcpServer | undefined {
    return this.services.get(name) as TcpServer;
  }

  /**
   * Retrieves a registered UDP server by name.
   *
   * @param name - The name of the UDP server to retrieve.
   * @returns The BroadcastUdpServer instance or undefined if not found.
   */
  public getUdpServer(name: string): BroadcastUdpServer | undefined {
    return this.services.get(name) as BroadcastUdpServer | undefined;
  }

  /**
   * Initializes additional components or services if needed.
   *
   * @remarks
   * This method can be overridden by subclasses to add custom initialization logic.
   */
  protected initialize(): void {
    // Placeholder for additional initialization logic if needed.
  }

  /**
   * Releases allocated resources including metrics and callbacks.
   *
   * @returns Promise that resolves when resources are released.
   */
  protected async releaseResources(): Promise<void> {
    if (this.metrics) {
      await this.metrics.shutdown();
      this.metrics = undefined as unknown as OtelMeterics;
    }

    if (this.metricsCallback) {
      listenerState.removeCallback(this.metricsCallback);
      this.metricsCallback = undefined;
    }

    this.initialized = false;
  }

  /**
   * Reloads configuration only.
   *
   * @returns Promise that resolves when reload is complete.
   */
  public async reload(): Promise<void> {
    if (this.configManager) {
      this.configManager.reload();
      this.setConfigManager(this.configManager);

      this.loggerManager.reload();
      this.setLoggerManager(this.loggerManager);
    }
  }

  /**
   * Restart the service. Restart performs stop, reload, and start in sequence.
   *
   * @returns Promise that resolves when restart is complete.
   */
  public async restart(): Promise<void> {
    await this.stop();
    await this.reload();

    await this.releaseResources();

    await this.initializeMetrics();
    await this.start();
  }

  /**
   * Shuts down the service gracefully. Stops all services, frees allocated resources,
   * and cleans up OpenTelemetry metrics.
   *
   * @returns Promise that resolves when shutdown is complete.
   */
  public async shutdown(): Promise<void> {
    await this.stop();
    await this.releaseResources();
    this.logger.info(`${this.getArrowedIdentity()} shutdown complete.`);
  }

  /**
   * Starts all services including TCP and UDP listeners.
   *
   * @returns Promise that resolves when initialization is complete.
   */
  public async start(): Promise<void> {
    if (!this.initialized) {
      this.logger.debug(`Initializing ${this.getArrowedIdentity()} ...`);
      this.initialize();
      this.initialized = true;
      this.logger.debug(`${this.getArrowedIdentity()} initialized.`);
    }
    this.setState(ServerState.Starting);

    // Initialize all services including TCP and UDP listeners.
    await this.initializeTcpListener("register");
    await this.initializeBroadcastListener("reception");

    this.logger.info(`${this.getArrowedIdentity()} started successfully.`);
    this.setState(ServerState.Running);
  }

  /**
   * Stops all registered services.
   *
   * @returns Promise that resolves when all services have stopped.
   */
  public async stop(): Promise<void> {
    this.logger.info("Stopping all services ...");
    this.setState(ServerState.Stopping);
    const wait: Promise<void>[] = [];

    for (const [name, service] of this.services.entries()) {
      if (typeof service.stop === "function") {
        const stopPromise = service
          .stop()
          .then(() => {
            this.logger.info(`Service <${name}> stopped successfully.`);
          })
          .catch((error: Error) => {
            this.logger.error(
              `Failed to stop service <${name}>: ${
                error instanceof Error ? error.message : "Unknown error"
              }`,
            );
          });
        wait.push(stopPromise);
      }
    }

    await Promise.all(wait);
    this.services.clear();
    this.logger.info(`${this.getArrowedIdentity()} stopped.`);
    this.setState(ServerState.Stopped);
  }

  private collectServerInfo(): AccessPoint {
    // Get TCP server information.
    const tcpServerName = "register";
    const tcpServer = this.services.get(tcpServerName);
    if (!tcpServer) {
      // || !(tcpServer instanceof TcpServer)
      const message = `The <${tcpServerName}> TCP server not initiated.`;
      this.logger.error(message);
      throw new Error(message);
    }

    const server = tcpServer.getServer();
    const addr = server?.address();
    if (!addr || typeof addr !== "object") {
      const message = `The <${tcpServerName}> TCP server not running.`;
      this.logger.error(message);
      throw new Error(message);
    }

    // Collect the server information.
    const srvInfo: AccessPoint = {
      authorization: "", // Authorization key for accessing this provider.
      function: ["register", "report"], // Capbilities of the provider.
      host: getHostIP(), // Host IP of the provider.
      port: addr.port, // Port number the access point listening on.
      protocol: NetworkProtocol.TCP, // Network protocol of the access point.
    };
    return srvInfo;
  }

  private async initializeMetrics(): Promise<void> {
    // Initialize OpenTelemetry metrics with service resource attributes.
    const resourceAttr: DetectedResourceAttributes = {
      "service.name": this.PROTOCOL.provider.name,
      "service.version": this.PROTOCOL.provider.version,
      "service.instance.id": this.PROTOCOL.provider.id,
      "protocol.version": this.PROTOCOL.protocol_ver,
      "deployment.environment": getAppEnv() || AppEnv.development,
    };
    this.metrics = new OtelMeterics(resourceAttr);

    this.metricsCallback = ServerStateMetric.createCallback();
    listenerState.addCallback(this.metricsCallback);

    ServerStateMetric.setInstanceState(
      ServerState.Stopped,
      this.PROTOCOL.provider.name,
      this.PROTOCOL.provider.id,
    );
  }

  /**
   * Initializes and starts a TCP listener.
   *
   * @param name - Unique name for this listener.
   * @returns Promise that resolves when the listener is started.
   */
  private async initializeTcpListener(name: string): Promise<void> {
    try {
      const tcpServer: TcpServer = createNamedTcpServer(name);
      await tcpServer.start();
      this.services.set(name, tcpServer);
    } catch (error) {
      this.logger.error(
        `Failed to initialize the <${name}> TCP listener: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw error;
    }
  }

  /**
   * Initializes and starts a broadcast UDP listener for service discovery.
   *
   * @returns Promise that resolves when the listener is started.
   */
  private async initializeBroadcastListener(name: string): Promise<void> {
    try {
      // Prepare the ServiceManager information.
      const ap: AccessPoint = this.collectServerInfo();
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
        name,
        TYPES.BroadcastUdpServer,
      ) as unknown as BroadcastUdpServer;
      broadcastServer.setManagerInfo(response);

      await broadcastServer.start();
      this.services.set(name, broadcastServer);
    } catch (error) {
      this.logger.error(
        `Failed to initialize the <${name}> broadcast UDP listener: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw error;
    }
  }

  private setConfigManager(configManager: ConfigManager) {
    this.configManager = configManager;
    this.updateServiceName();
  }

  private setLoggerManager(loggerManager: LoggerManager) {
    // The initial / injected LoggerManager has no service_name set, so we need to reload it after updating the config.
    loggerManager?.reload();

    this.loggerManager = loggerManager;
    this.logger = loggerManager?.getLogger() ?? (console as any); // Fallback to console if no loggerManager.
  }

  /**
   * Sets the server state and updates the OpenTelemetry metric.
   *
   * @param state - The new server state to set.
   * @remarks
   * This method updates both the internal state and the OpenTelemetry observable gauge.
   * The state change is logged and the metric is updated via the ServerStateMetric class.
   */
  private setState(state: ServerState): void {
    if (this.state !== state) {
      // Update the server state metric for OpenTelemetry
      ServerStateMetric.setState(state);

      this.logger.info(
        `${this.getArrowedIdentity()} state: ${this.state} → ${state}.`,
      );
      this.state = state;
    }
  }

  private updateServiceName() {
    const coreConfig = this.configManager.getCoreConfig();
    const svcName = coreConfig.service_name;
    if (svcName && svcName !== UNKNOWN_ATTRIBUTE) {
      // If service name is defined in config file, use it.
      this.PROTOCOL.provider.name = svcName;
    } else {
      // Otherwise, set the service_name in the core configuration to the class name.
      coreConfig.service_name = this.PROTOCOL.provider.name;
    }
  }
}
