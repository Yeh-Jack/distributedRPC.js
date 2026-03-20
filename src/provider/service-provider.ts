import { injectable } from "inversify";
import { DetectedResourceAttributes } from "@opentelemetry/resources";
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
import {
  createNamedTcpServer,
  createServiceManagerDiscover,
} from "../aop/container";
import { ConfigManager } from "../common/config";
import { LoggerManager } from "../common/logger";
import { OtelMeterics, OtelProviderState } from "../metrics/otel-metrics";
import { OtelTracer } from "../metrics/otel-tracing";
import { NetworkProtocol, getHostIP } from "../network/network-events";
import { TcpServer } from "../network/tcp-server";
import {
  ProviderState,
  ProviderInfo,
  ATTR_DEPLOY_ENV,
  ATTR_PROTOCOL_VERSION,
  ATTR_SERVICE_INSTANCE,
} from "./provider-info";

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

  // Resources should be released during shutdown.
  protected metrics!: OtelMeterics;
  protected tracer!: OtelTracer;

  private readonly _FOLLOW_UP: string = "  --> ";
  private _initialized: boolean = false;
  private _managerInfo: BroadcastResponse[] | null = [];
  private _providerState!: ProviderState;

  /**
   * Creates a ServiceProvider instance.
   */
  public constructor() {}

  // This is the "Destructor"
  [Symbol.dispose]() {
    this.shutdown();
  }

  protected collectProviderInfo(): ProviderInfo {
    const provider = this.PROTOCOL.provider;
    const resource: ProviderInfo = {
      enabled: true,
      [ATTR_SERVICE_NAME]: provider.name,
      [ATTR_SERVICE_INSTANCE]: provider.id,
      [ATTR_SERVICE_VERSION]: provider.version,
      [ATTR_PROTOCOL_VERSION]: this.PROTOCOL.protocol_ver,
      [ATTR_DEPLOY_ENV]: getAppEnv() || AppEnv.development,
    };
    return resource;
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

  public getLogger() {
    return this.logger;
  }

  /**
   * Returns the metrics instance for this service.
   *
   * @returns The OtelMeterics instance.
   */
  public getMetrics(): OtelMeterics {
    return this.metrics;
  }

  protected getServiceManagerInfo(): BroadcastResponse[] | null {
    return this._managerInfo;
  }

  /**
   * Returns the configured service name.
   *
   * @returns The service name from configuration.
   */
  public getServiceName(): string {
    return this.PROTOCOL.provider.name;
  }

  public getState(): ExecutionState {
    return this._providerState.getState();
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

  /**
   * Initializes and starts a TCP listener.
   *
   * @param name - Unique name for this listener.
   * @returns Promise that resolves when the listener is started.
   */
  protected async initializeTcpServer(name: string): Promise<void> {
    try {
      const tcpServer: TcpServer = createNamedTcpServer(
        this.configManager,
        name,
      );
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
    if (this.configManager) {
      this.configManager.reload();
    } else {
      const providerName = this.PROTOCOL.provider.name;
      this.configManager = new ConfigManager(providerName);
    }
    this._setConfigManager(this.configManager);

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

    await this.reload();
    await this.start();
  }

  /**
   * Sets the server state.
   *
   * @param state - The new server state to set.
   */
  protected setState(state: ExecutionState): void {
    const curState = this.getState();
    if (curState !== state) {
      this._providerState.setState(state);
      this.logger.info(
        `${this.getArrowedIdentity()} state: ${curState} → ${state}.`,
      );
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
    if (this.getState() === ExecutionState.Stopped) return;
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
      this.configManager,
      discoveryName,
      discoveryConfig,
    );
    if (!discovery) {
      this._managerInfo = null;
      return;
    }

    this.tasks.set(discoveryName, discovery);
    this._managerInfo = (await discovery.discover()).responses;
  }

  private async _initializeOtel(): Promise<void> {
    // Use OtelProviderState instead of the default ProviderState.
    const providerInfo = this._providerState.getProvider();
    let otelProvider: OtelProviderState;
    if (this._providerState instanceof OtelProviderState) {
      otelProvider = this._providerState;
    } else {
      // Replace the default ProviderState instance by OtelProviderState instance.
      const state = this._providerState.getState();
      otelProvider = new OtelProviderState(providerInfo);
      otelProvider.setState(state);
      this._providerState = otelProvider;
    }

    const providerId = this.configManager.getProviderId();
    this.tracer = OtelTracer.getInstance(providerId, otelProvider);

    const { enabled, ...info } = providerInfo;
    const resourceAttr: DetectedResourceAttributes = { ...info };
    this.metrics = new OtelMeterics(resourceAttr, otelProvider);
  }

  private async _initializeResources(): Promise<void> {
    this.logger.debug(`Initializing ${this.getArrowedIdentity()} ...`);
    this.setState(ExecutionState.Initializing);

    await this._initializeOtel();
    await this._discoverServiceManager();

    this.logger.silly(`Initializing resources in subclass ...`);
    await this.initializingResources();
    this.logger.silly(`${this._FOLLOW_UP}Subclass resources initialized.`);

    this._initialized = true;
    this.logger.debug(`${this.getArrowedIdentity()} initialized.`);
  }

  private async _releaseMetrics(): Promise<void> {
    if (this.metrics) {
      await this.metrics.shutdown();
      this.metrics = undefined as unknown as OtelMeterics;
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
    this.logger = configManager.getLogger();
    this._updateProviderInfo();

    const providerInfo = this.collectProviderInfo();
    if (!this._providerState) {
      this._providerState = new ProviderState(providerInfo);
    } else {
      this._providerState.setProvider(providerInfo);
    }
  }

  private _updateProviderInfo() {
    // Synchronize provider's instance ID.
    const coreConfig = this.configManager.getCoreConfig();
    coreConfig.provider_id = this.PROTOCOL.provider.id;

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
