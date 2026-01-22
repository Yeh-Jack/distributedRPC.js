import { inject, injectable } from "inversify";
import { DetectedResourceAttributes } from "@opentelemetry/resources";

import {
  AppEnv,
  BasalProtocol,
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
import { TcpServer } from "../network/tcp-server";
import { UdpServer } from "../network/udp-server";

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
  private metrics!: OtelMeterics;
  private services: Map<string, any> = new Map();
  private state: ServerState = ServerState.Stopped;

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
   * @returns The UdpServer instance or undefined if not found.
   */
  public getUdpServer(name: string): UdpServer | undefined {
    return this.services.get(name) as UdpServer;
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

    this.initialized = false;
    await this.start();
  }

  /**
   * Starts all services including TCP and UDP listeners.
   *
   * @returns Promise that resolves when initialization is complete.
   */
  public async start(): Promise<void> {
    if (!this.initialized) {
      this.logger.debug(`Initializing <${this.getIdentity()}> ...`);
      this.initialize();
      this.initialized = true;
      this.logger.debug(`<${this.getIdentity()}> initialized.`);
    }
    this.setState(ServerState.Starting);

    // Initialize all services including TCP and UDP listeners in parallel.
    await Promise.all([
      this.initializeTcpListener("register"),
      this.initializeUdpListener("reception"),
    ]);

    this.logger.info(`<${this.getIdentity()}> started successfully.`);
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
    const wait = [];

    // Stop all services in parallel.
    for (const [name, service] of this.services.entries()) {
      try {
        if (typeof service.stop === "function") {
          wait.push(service.stop()); // Stop the TCP server.
          this.logger.info(`Service "${name}" stopped successfully.`);
        }
      } catch (error) {
        this.logger.error(
          `Failed to stop service "${name}": ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    }

    await Promise.all(wait);
    this.logger.info(`<${this.getIdentity()}> stopped.`);
    this.setState(ServerState.Stopped);
  }

  /**
   * Generates a unique identity string for the service instance.
   *
   * @returns The unique identity string.
   */
  protected getIdentity(): string {
    return `${this.PROTOCOL.provider.name}-${this.PROTOCOL.provider.id}`;
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

  private initializeMetrics() {
    const resourceAttr: DetectedResourceAttributes = {
      "service.name": this.PROTOCOL.provider.name,
      "service.version": this.PROTOCOL.provider.version,
      "service.instance.id": this.PROTOCOL.provider.id,
      "protocol.version": this.PROTOCOL.protocol_ver,
      "deployment.environment": getAppEnv() || AppEnv.development,
    };
    this.metrics = new OtelMeterics(resourceAttr);

    // Register the state callback with the observable gauge
    listenerState.addCallback(ServerStateMetric.createCallback());

    // Initialize the server state metric
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
      const tcpServer = createNamedTcpServer(name);
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
   * Initializes and starts a UDP listener.
   *
   * @param name - Unique name for this listener.
   * @returns Promise that resolves when the listener is started.
   */
  private async initializeUdpListener(name: string): Promise<void> {
    try {
      const udpServer = createNamedUdpServer(name);
      await udpServer.start();
      this.services.set(name, udpServer);
    } catch (error) {
      this.logger.error(
        `Failed to initialize the <${name}> UDP listener: ${
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
        `<${this.getIdentity()}> state: ${this.state} → ${state}.`,
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
