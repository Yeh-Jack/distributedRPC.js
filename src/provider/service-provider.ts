import { Server } from "net";
import { inject, injectable } from "inversify";
import { DetectedResourceAttributes } from "@opentelemetry/resources";
import { ObservableCallback } from "@opentelemetry/api";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

import {
  AccessPoint,
  AppEnv,
  BasalProtocol,
  BroadcastResponse,
  ExecutionState,
  generateInstanceId,
  getAppEnv,
  UNKNOWN_ATTRIBUTE,
} from "../types/basal-protocol";
import { TYPES } from "../aop/di-types";
import {
  createNamedTcpServer,
  createServiceManagerDiscover,
} from "../aop/container";
import { ConfigManager } from "../common/config";
import { LoggerManager } from "../common/logger";
import {
  OtelMeterics,
  listenerState,
  ServerStateMetric,
} from "../metrics/otel-metrics";
import {
  OtelTracer,
  TracingConfig,
  ATTR_PROTOCOL_VERSION,
  ATTR_SERVICE_INSTANCE,
} from "../metrics/otel-tracing";
import { NetworkProtocol, getHostIP } from "../network/network-events";
import { TcpServer } from "../network/tcp-server";

@injectable()
export class ServiceProvider {
  public readonly PROTOCOL: BasalProtocol = {
    protocol_ver: "1.0.0",
    provider: {
      id: generateInstanceId(),
      name: this.constructor.name,
      desc: "Unknown service provider.",
      version: "1.0.0",
    },
  };

  protected configManager!: ConfigManager;
  protected logger!: ReturnType<LoggerManager["getLogger"]>;
  protected tasks: Map<string, any> = new Map(); // Internal tasks handler.

  private readonly _FOLLOW_UP: string = "  --> ";
  private _initialized: boolean = false;
  private _loggerManager!: LoggerManager;
  private _serviceManager: BroadcastResponse[] | null = [];
  private _state: ExecutionState = ExecutionState.Stopped;

  // Resources should be released during shutdown.
  private _metrics!: OtelMeterics;
  private _metricsCallback?: ObservableCallback;

  /**
   * Creates a ServiceProvider instance with the provided dependencies.
   *
   * @param configManager - The configuration manager for retrieving service settings.
   * @param loggerManager - The logger manager for obtaining the application logger.
   */
  public constructor(
    @inject(TYPES.LoggerManager) loggerManager: LoggerManager,
  ) {
    this.configManager = new ConfigManager();
    this._loggerManager = loggerManager;
    this.reload();
  }

  // This is the "Destructor"
  [Symbol.dispose]() {
    this.shutdown();
  }

  /**
   * Get the unique identity string of the service instance with `<>`.
   *
   * @returns The unique identity string.
   */
  protected getArrowedIdentity(): string {
    return `<${this.getIdentity()}>`;
  }

  public getConfigManager(): ConfigManager {
    return this.configManager;
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
    return this._metrics;
  }

  protected getOtelTracerConfig(): TracingConfig {
    const provider = this.PROTOCOL.provider;
    const traceConfig: TracingConfig = {
      enabled: true,
      [ATTR_SERVICE_NAME]: provider.name,
      [ATTR_SERVICE_INSTANCE]: provider.id,
      [ATTR_SERVICE_VERSION]: provider.version,
    };
    return traceConfig;
  }

  protected getTcpServerInfo(tcpServerName: string = "response"): AccessPoint {
    // Get TCP server information.
    const tcpServer = this.tasks.get(tcpServerName);
    if (!tcpServer) {
      const message = `The <${tcpServerName}> TCP server not initiated.`;
      this.logger.error(message);
      throw new Error(message);
    }

    const addr = tcpServer.getServer()?.address();
    if (!addr || typeof addr !== "object") {
      const message = `The <${tcpServerName}> TCP server not working.`;
      this.logger.error(message);
      throw new Error(message);
    }

    // Collect the server information.
    const srvInfo: AccessPoint = {
      authorization: "", // Authorization key for accessing this provider.
      function: ["report"], // Capbilities of the provider.
      host: getHostIP(), // Host IP of the provider.
      port: addr.port, // Port number the access point listening on.
      protocol: NetworkProtocol.TCP, // Network protocol of the access point.
    };
    return this.buildAccessPointInfo(srvInfo);
  }

  protected getServiceManager(): BroadcastResponse[] | null {
    return this._serviceManager;
  }

  /**
   * Returns the configured service name.
   *
   * @returns The service name from configuration.
   */
  public getServiceName(): string {
    return this.PROTOCOL.provider.name;
  }

  /**
   * Initializes and starts a TCP listener.
   *
   * @param name - Unique name for this listener.
   * @returns Promise that resolves when the listener is started.
   */
  protected async initializeTcpServer(name: string): Promise<void> {
    try {
      const tcpServer: TcpServer = createNamedTcpServer(name);
      await tcpServer.start();
      this.tasks.set(name, tcpServer);
    } catch (error) {
      this.logger.error(
        `Failed to initialize the <${name}> TCP server: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw error;
    }
  }

  /**
   * Reloads configuration only.
   *
   * @returns Promise that resolves when reload is complete.
   */
  public async reload(): Promise<void> {
    // The ConfigManager and LoggerManager should be singletons.
    if (this.configManager) {
      this.configManager.reload();
      this._setConfigManager(this.configManager);
    }

    if (this._loggerManager) {
      this._loggerManager.reload();
      this._setLoggerManager(this._loggerManager);
    }

    this.logger.silly(`Reloading in subclass ...`);
    await this.reloading();
    this.logger.silly(`${this._FOLLOW_UP}Subclass reloaded.`);
  }

  /**
   * Restart the service. Restart performs stop, reload, and start in sequence.
   *
   * @returns Promise that resolves when restart is complete.
   */
  public async restart(): Promise<void> {
    await this.stop();

    await this._releaseResources();
    await this._initializeResources();

    await this.reload();
    await this.start();
  }

  /**
   * Sets the server state and updates the OpenTelemetry metric.
   *
   * @param state - The new server state to set.
   * @remarks
   * This method updates both the internal state and the OpenTelemetry observable gauge.
   * The state change is logged and the metric is updated via the ServerStateMetric class.
   */
  protected setState(state: ExecutionState): void {
    if (this._state !== state) {
      // Update the server state metric for OpenTelemetry
      ServerStateMetric.setState(state);

      this.logger.info(
        `${this.getArrowedIdentity()} state: ${this._state} → ${state}.`,
      );
      this._state = state;
    }
  }

  /**
   * Shuts down the service gracefully. Stops all services, frees allocated resources,
   * and cleans up OpenTelemetry metrics.
   *
   * @returns Promise that resolves when shutdown is complete.
   */
  public async shutdown(): Promise<void> {
    await this.stop();
    await this._releaseResources();
    this.logger.info(`${this.getArrowedIdentity()} shutdown complete.`);
  }

  /**
   * Starts all services including TCP and UDP listeners.
   *
   * @returns Promise that resolves when initialization is complete.
   */
  public async start(): Promise<void> {
    if (!this._initialized) {
      await this._initializeResources();
    }

    this.setState(ExecutionState.Starting);

    this.logger.silly(`Starting the service in subclass ...`);
    await this.starting(); // Start services on subclass.
    this.logger.silly(`${this._FOLLOW_UP}Service started in subclass.`);

    this.logger.info(`${this.getArrowedIdentity()} started successfully.`);
    this.setState(ExecutionState.Running);
  }

  /**
   * Stops all registered services.
   *
   * @returns Promise that resolves when all services have stopped.
   */
  public async stop(): Promise<void> {
    if (this._state === ExecutionState.Stopped) return;
    this.logger.info(`Stopping the ${this.getArrowedIdentity()} service ...`);
    this.setState(ExecutionState.Stopping);

    this.logger.silly(`Stopping the service in subclass ...`);
    await this.stopping(); // Stop services on subclass.
    this.logger.silly(`${this._FOLLOW_UP}Service stopped in subclass.`);

    // Stop default services.
    const wait: Promise<void>[] = [];
    for (const [name, service] of this.tasks.entries()) {
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
    this.tasks.clear();

    this.logger.info(`${this.getArrowedIdentity()} stopped.`);
    this.setState(ExecutionState.Stopped);
  }

  // --------------------------------------------
  // Methods forced to be implemented on subclass.
  // --------------------------------------------

  /**
   * Provide actual access point information based on the provided base information.
   * The goal is to provide the `authorization` and `function` information for this provider.
   *
   * @param baseInfo - The base access point information to build upon
   * @returns The constructed access point with built information
   * @throws {Error} This method is not implemented in the base class and must be overridden by subclasses
   */
  protected buildAccessPointInfo(baseInfo: AccessPoint): AccessPoint {
    if (this.constructor.name === "ServiceProvider")
      throw new Error(
        "Method buildAccessPointInfo(baseInfo: AccessPoint) is not implemented.",
      );
    return baseInfo;
  }

  protected async initializingResources(): Promise<void> {
    if (this.constructor.name !== "ServiceProvider")
      throw new Error("Method initializing() is not implemented.");
  }

  protected async releasingResources(): Promise<void> {
    if (this.constructor.name !== "ServiceProvider")
      throw new Error("Method releasingResources() is not implemented.");
  }

  protected async reloading(): Promise<void> {
    if (this.constructor.name !== "ServiceProvider")
      throw new Error("Method reloading() is not implemented.");
  }

  protected async starting(): Promise<void> {
    if (this.constructor.name !== "ServiceProvider")
      throw new Error("Method starting() is not implemented.");
  }

  /**
   * Stops the service.
   * All tasks in the `tasks` map will be stopped automatically if the task has `stop()` method.
   * This method should be implemented by subclasses to handle service shutdown logic.
   * @throws {Error} If the method is not implemented by the subclass.
   * @returns {Promise<void>} A promise that resolves when the service has been stopped.
   * @protected
   */
  protected async stopping(): Promise<void> {
    if (this.constructor.name !== "ServiceProvider")
      throw new Error("Method stopping() is not implemented.");
  }

  // --------------------------------------------
  // Private Methods
  // --------------------------------------------

  private async _discoverServiceManager(): Promise<void> {
    const discoveryConfig =
      this.configManager.getCoreConfig().net?.sm_discovery;
    const discoveryName: string =
      discoveryConfig.description || UNKNOWN_ATTRIBUTE;
    const discovery = createServiceManagerDiscover(
      discoveryName,
      discoveryConfig,
    );
    if (!discovery) {
      this._serviceManager = null;
      return;
    }

    this.tasks.set(discoveryName, discovery);
    this._serviceManager = (await discovery.discover()).responses;
  }

  private async _initializeOtel(): Promise<void> {
    //Configure OpenTelemetry tracer.
    OtelTracer.initialize(this.getOtelTracerConfig());

    // Configure OpenTelemetry metrics.
    const provider = this.PROTOCOL.provider;
    const resourceAttr: DetectedResourceAttributes = {
      [ATTR_SERVICE_NAME]: provider.name,
      [ATTR_SERVICE_INSTANCE]: provider.id,
      [ATTR_SERVICE_VERSION]: provider.version,
      [ATTR_PROTOCOL_VERSION]: this.PROTOCOL.protocol_ver,
      "deployment.environment": getAppEnv() || AppEnv.development,
    };
    this._metrics = new OtelMeterics(resourceAttr);

    this._metricsCallback = ServerStateMetric.createCallback();
    listenerState.addCallback(this._metricsCallback);

    ServerStateMetric.setInstanceState(
      ExecutionState.Stopped,
      provider.name,
      provider.id,
    );
  }

  private async _initializeResources(): Promise<void> {
    this.logger.debug(`Initializing ${this.getArrowedIdentity()} ...`);

    await this._initializeOtel();
    await this._discoverServiceManager();

    this.logger.silly(`Initializing resources in subclass ...`);
    await this.initializingResources();
    this.logger.silly(`${this._FOLLOW_UP}Subclass resources initialized.`);

    this._initialized = true;
    this.logger.debug(`${this.getArrowedIdentity()} initialized.`);
  }

  private async _releaseMetrics(): Promise<void> {
    if (this._metrics) {
      await this._metrics.shutdown();
      this._metrics = undefined as unknown as OtelMeterics;
    }

    if (this._metricsCallback) {
      listenerState.removeCallback(this._metricsCallback);
      this._metricsCallback = undefined;
    }
  }

  /**
   * Releases allocated resources including metrics and callbacks.
   *
   * @returns Promise that resolves when resources are released.
   */
  private async _releaseResources(): Promise<void> {
    this.logger.debug(`Cleanup ${this.getArrowedIdentity()} ...`);

    this.logger.silly(`Releasing resources allocated in subclass ...`);
    await this.releasingResources(); // Release resources on subclass.
    this.logger.silly(`${this._FOLLOW_UP}Subclass resources released.`);

    await this._releaseMetrics();
    this._initialized = false;

    this.logger.debug(`${this.getArrowedIdentity()} released.`);
  }

  /**
   * Encapsulate jobs for setting ConfigManager.
   *
   * @param configManager
   */
  private _setConfigManager(configManager: ConfigManager) {
    this.configManager = configManager;
    this._updateServiceName();
  }

  /**
   * Encapsulate jobs for setting LoggerManager.
   *
   * @param loggerManager
   */
  private _setLoggerManager(loggerManager: LoggerManager) {
    // The initial / injected LoggerManager has no service_name set, so we need to reload it after updating the config.
    loggerManager?.reload();

    this._loggerManager = loggerManager;
    this.logger = loggerManager?.getLogger() ?? (console as any); // Fallback to console if no loggerManager.
  }

  private _updateServiceName() {
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
