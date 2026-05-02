import { inject, injectable } from "inversify";
import { DetectedResourceAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

import { createNamedTcpServer, TYPES } from "../aop/container";
import { ConfigManager } from "../common/config";
import { LoggerManager } from "../common/logger";
import { BroadcastResponse260321 } from "../manager/api-spec-260321";
import { OtelMeterics, OtelProviderState } from "../metrics/otel-metrics";
import { OtelTracer } from "../metrics/otel-tracing";
import {
  NetworkEvent,
  NetworkPeer,
  getHostIP,
} from "../network/network-events";
import { TcpClient } from "../network/tcp-client";
import { TcpServer } from "../network/tcp-server";
import {
  ProcedureContext,
  RegisterContext,
  ReportContext,
  ManagerInfo,
} from "../procedure";
import {
  AccessPoint,
  AckType,
  AckValue,
  ApiCall,
  ApiCounter,
  ApiSpec,
  AppEnv,
  BasalProtocol,
  ExecutionState,
  IdGenerator,
  NetworkProtocol,
  PeerIdentity,
  ProviderConnectInfo,
  ResponseArgs,
  SocketAddress,
  getAppEnv,
  DEFAULT_ENCODE,
  FOLLOW_UP,
  MAX_HEADER_LEN,
  SECOND,
  UNKNOWN_ATTRIBUTE,
} from "../types/basal-protocol";
import {
  ProviderState,
  ProviderInfo,
  ATTR_DEPLOY_ENV,
  ATTR_PROTOCOL_VERSION,
  ATTR_SERVICE_INSTANCE,
} from "./provider-info";

@injectable()
export class ServiceProvider {
  // Task name of the API channel.
  protected readonly _TASK_CHANNEL_API: string = "_chnAPI";

  // Task name of the response channel.
  protected readonly _TASK_CHANNEL_RESPONSE: string = "_chnResponse";

  // Task name of the system instruction channel.
  protected readonly _TASK_CHANNEL_SYS: string = "_chnSys";

  // Task name for the ServiceManager client.
  protected readonly _TASK_MANAGER: string = "_svcManager";

  // Protocol of this service.
  protected readonly PROTOCOL: BasalProtocol;

  protected configManager: ConfigManager;
  protected logger!: ReturnType<LoggerManager["getLogger"]>;

  // Internal map of tasks, task name is the key.
  protected tasks: Map<string, any> = new Map();

  // Map of API names to handler functions.
  protected apis: any = {};

  /*
   * Response channels indexed by service name and instance ID.
   * Structure: { service: { instance: TcpClient } }
   */
  protected chnResp: Record<string, Record<string, TcpClient>> = {};

  /**
   * Pending API requests pool, indexed by message ID.
   * Structure: { msgId: ApiCall }
   */
  protected polReqs: Map<string, ApiCall> = new Map();

  // OpenTelemetry instances.
  protected metrics!: OtelMeterics;
  protected tracer!: OtelTracer;

  // Keep API called execution statistics.
  private _apiCounter: Map<string, Omit<ApiCounter, "total">> = new Map();

  // ServiceManager informations and instance.
  private _manager: any = {};
  private _managerInfo: BroadcastResponse260321[] = [];

  // Procedure instances.
  private _procedure: any = {};

  // Timer for the scheduled status reporter.
  private _reportTimer: NodeJS.Timeout | null = null;

  private _initialized: boolean = false;
  private _providerState!: ProviderState;

  /**
   * Creates a ServiceProvider instance.
   * @param idGenerator - The ID generator for creating message and instance IDs
   */
  public constructor(
    @inject(TYPES.IdGenerator) protected idGenerator: IdGenerator,
  ) {
    const serviceName = this.constructor.name;
    this.PROTOCOL = {
      protocol_ver: "1.0.0",
      provider: {
        id: this.idGenerator.shortId(),
        name: serviceName,
        desc: "Unknown service provider.",
        version: "1.0.0",
      },
      apis: {},
    };
    this.configManager = new ConfigManager(serviceName);
  }

  // This is the "Destructor"
  [Symbol.dispose]() {
    this.shutdown();
  }

  /**
   * Activates this service provider if it's halted.
   * @returns Promise that resolves when activation is complete.
   */
  public async activate(): Promise<void> {
    const acceptStates = [ExecutionState.Halt];
    if (!acceptStates.includes(this.getState())) return;

    this.logger.info(`Activating the ${this.getIdentity()} service ...`);
    this.setState(ExecutionState.Starting);

    // TODO

    this.logger.info(`${this.getIdentity()} is activated.`);
    this.setState(ExecutionState.Running);
    await this.report(); // Report status immediately.
  }

  /**
   * Sends an API call to a helper TCP client and tracks the pending request.
   *
   * @param helper - The TCP client to send the message through
   * @param message - The API call message to send
   * @param ackType - The acknowledgment type expected
   * @returns Promise resolving to message ID and optional promise for response
   */
  protected async ask(
    helper: TcpClient,
    message: ApiCall,
    ackType: AckType,
  ): Promise<{ msgId: string; promise?: Promise<any> }> {
    const msgId = await helper.sendMessage(message);
    this.polReqs.set(msgId, message);
    if (ackType === AckType.None) {
      return { msgId };
    }

    const { promise, resolve, reject } = Promise.withResolvers();
    message.promise = {
      resolve: resolve,
      reject: reject,
    };
    return { msgId, promise };
  }

  /**
   * Requests provider connection information from the ServiceManager.
   *
   * @param data - API call containing peer information
   * @returns Promise resolving to ProviderConnectInfo or undefined if not available
   */
  protected async askProviderInfo(
    data: ApiCall,
  ): Promise<ProviderConnectInfo | undefined> {
    // TODO: Implement provider info request
    return;
  }

  /**
   * Builds an API call message with peer identity and specified API path.
   *
   * @param apiPath - The API procedure path (e.g., "register", "report")
   * @param args - Optional arguments to pass to the API procedure
   * @param msgId - Optional message ID for tracking
   * @returns The constructed ApiCall message
   */
  protected buildMessage(apiPath: string, args?: any, msgId?: string): ApiCall {
    const peer: PeerIdentity = {
      service: this.PROTOCOL.provider.name,
      instance: this.PROTOCOL.provider.id,
      // ...this._getSocketAddr(this._TASK_CHANNEL_RESPONSE),
    };

    const api: ApiCall = {
      peer: peer,
      api: apiPath, // Path name of the procedure.
      args: args, // Arguments for the procedure call.
      msgId: msgId,
    };
    return api;
  }

  /**
   * Collects provider information from the protocol configuration.
   *
   * @returns ProviderInfo object with service name, instance ID, version, and environment
   */
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
   * Utility delay function.
   *
   * @param ms - Milliseconds to delay
   * @returns Promise that resolves after the delay
   */
  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Gets the configuration manager for this service.
   *
   * @returns The ConfigManager instance
   */
  public getConfigManager(): ConfigManager {
    return this.configManager;
  }

  /**
   * Get the unique identity string of the service instance.
   *
   * @returns The unique identity string.
   */
  protected getIdentity(
    provider: BasalProtocol = this.PROTOCOL,
    arrowed: boolean = true,
  ): string {
    const msg = `${provider.provider.name}-${provider.provider.id}`;
    return arrowed ? `<${msg}>` : msg;
  }

  /**
   * Gets the logger instance for this service.
   *
   * @returns The logger instance
   */
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

  /**
   * Extracts the peer identity from an API call message.
   *
   * @param data - The API call containing peer information
   * @param arrowed - Whether to wrap the identity in angle brackets
   * @returns The peer identity string
   */
  protected getPeerId(data: ApiCall, arrowed: boolean = true): string {
    const peer: PeerIdentity = data.peer;
    const msg = `${peer.service}-${peer.instance}`;
    return arrowed ? `<${msg}>` : msg;
  }

  /**
   * Returns the protocol configuration as a JSON string.
   */
  /**
   * Returns the protocol configuration as a JSON string.
   *
   * @returns JSON string representation of the protocol configuration
   */
  public async getProtocol(): Promise<string> {
    return JSON.stringify(this.PROTOCOL);
  }

  /**
   * Gets or creates a response channel TCP client for a peer.
   * If the channel doesn't exist, it queries the ServiceManager for provider
   * connection info and creates a new TCP client.
   *
   * @param data - API call containing peer information
   * @returns The TCP client for the response channel
   * @throws Error if peer information is missing or provider info cannot be obtained
   */
  protected async getResponseChannel(data: ApiCall): Promise<TcpClient> {
    const peer: PeerIdentity = data.peer;
    if (!(peer?.service && peer?.instance)) {
      throw new Error("Lack of response target information.");
    }

    // this.chnResp is in the { service: { instance: TcpClient }} format.
    let chnService = this.chnResp[peer.service];
    if (!chnService) {
      chnService = {};
      this.chnResp[peer.service] = chnService;
    }

    let channel = chnService[peer.instance];
    if (!channel) {
      // Step 1 : Ask AccessPoint information of the target from ServiceManager.
      const pvdName = this.getPeerId(data);
      this.logger.debug(
        `Asking provider ${pvdName} connection information from service manager ...`,
      );
      const pvdInfo: ProviderConnectInfo | undefined =
        await this.askProviderInfo(data);
      if (!pvdInfo) {
        throw new Error(
          `Unable to get information of the ${pvdName} provider.`,
        );
      }

      this.logger.debug(
        `${FOLLOW_UP}Connecting to response channel of ${this.getSocketString(pvdInfo)}`,
      );

      // Step 2 : Construct a TcpClient as the response channel of this provider.
      channel = new TcpClient(
        this.configManager,
        pvdInfo,
        this.getPeerId(data, false),
        this.idGenerator,
      );

      // Step 3 : Activate and store this channel.
      chnService[peer.instance] = channel;
      await channel.start();
      channel.on(NetworkEvent.Data, this._handleChannelResponse);
    }
    return channel;
  }

  /**
   * Returns the discovered ServiceManager information.
   *
   * @returns Array of BroadcastResponse260321 or null if not discovered
   */
  protected getServiceManagerInfo(): BroadcastResponse260321[] | null {
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

  /**
   * Formats a socket address as a string.
   *
   * @param socketAddr - The socket address to format
   * @param arrowed - Whether to wrap the address in angle brackets
   * @returns Formatted address string (e.g., "<192.168.1.1:8080>")
   */
  protected getSocketString(
    socketAddr: SocketAddress,
    arrowed: boolean = true,
  ): string {
    const msg = `${socketAddr.address}:${socketAddr.port}`;
    return arrowed ? `<${msg}>` : msg;
  }

  /**
   * Gets the current execution state of the provider.
   *
   * @returns The current ExecutionState
   */
  public getState(): ExecutionState {
    return this._providerState.getState();
  }

  /**
   * Gets a task by name from the internal tasks map.
   *
   * @param taskName - The name of the task to retrieve
   * @returns The task instance
   * @throws Error if the task doesn't exist
   */
  protected getTask(taskName: string = this._TASK_CHANNEL_RESPONSE): any {
    const task = this.tasks.get(taskName);
    if (!task) {
      const message = `The <${taskName}> task doesn't exist.`;
      this.logger.error(message);
      throw new Error(message);
    }
    return task;
  }

  /**
   * Gets TCP task information as an AccessPoint for the specified task.
   *
   * @param taskName - The task name (defaults to response channel)
   * @returns AccessPoint with socket address and provider capabilities
   */
  protected getTcpTaskInfo(
    taskName: string = this._TASK_CHANNEL_RESPONSE,
  ): AccessPoint {
    const socketAddr = this._getSocketAddr(taskName);
    const srvInfo: AccessPoint = {
      authorization: "", // Authorization key for accessing this provider.
      api: ["report"], // Capbilities of the provider.
      // address: getHostIP(), // Host IP of the provider.
      // port: addr.port, // Port number the access point listening on.
      // protocol: NetworkProtocol.TCP, // Network protocol of the access point.
      ...socketAddr,
    };
    return this.buildAccessPointInfo(srvInfo);
  }

  /**
   * Halts the service provider gracefully.
   * @returns Promise that resolves when halt is complete.
   */
  public async halt(): Promise<void> {
    const acceptStates = [ExecutionState.Running];
    if (!acceptStates.includes(this.getState())) return;

    this.logger.info(`Halting the ${this.getIdentity()} service ...`);
    this.setState(ExecutionState.Halting);

    // TODO

    this.logger.info(`${this.getIdentity()} is halted.`);
    this.setState(ExecutionState.Halt);
    await this.report(); // Report status immediately.
  }

  /**
   * Initializes the API function map with all available handler methods.
   * Maps API names to their handler methods on this instance.
   */
  protected initializeApiFunctionMap(): void {
    this.apis = {
      activate: this.activate,
      getProtocol: this.getProtocol,
      getServiceManagerInfo: this.getServiceManagerInfo,
      getState: this.getState,
      halt: this.halt,
      register: this.register,
      reload: this.reload,
      report: this.report,
      restart: this.restart,
      shutdown: this.shutdown,
      start: this.start,
      stop: this.stop,
    };
  }

  /**
   * Initializes and starts a TCP client for communicating with a remote endpoint.
   *
   * @param name - Unique name for this client task.
   * @param ap - AccessPoint containing address and port of the remote endpoint.
   * @returns Promise that resolves to the initialized TcpClient.
   */
  protected async initializeTcpClient(
    name: string,
    ap?: AccessPoint,
  ): Promise<TcpClient> {
    try {
      let tcpClient: TcpClient = this.tasks.get(name);
      if (tcpClient) return tcpClient;

      if (!ap) {
        throw new Error("Missing AccessPoint argument.");
      }

      tcpClient = new TcpClient(this.configManager, ap, name, this.idGenerator);
      this.tasks.set(name, tcpClient);
      await tcpClient.start();
      return tcpClient;
    } catch (error) {
      this.logger.error(
        `Failed to initialize the <${name}> TCP client: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw error;
    }
  }

  /**
   * Initializes and starts a TCP server.
   *
   * @param name - Unique name for this listener.
   * @returns Promise that resolves when the listener is started.
   */
  protected async initializeTcpServer(name: string): Promise<TcpServer> {
    try {
      let tcpServer: TcpServer = this.tasks.get(name);
      if (tcpServer) return tcpServer;

      tcpServer = createNamedTcpServer(this.configManager, name);
      this.tasks.set(name, tcpServer);
      await tcpServer.start();
      return tcpServer;
    } catch (error) {
      this.logger.error(
        `Failed to initialize the <${name}> TCP server: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw error;
    }
  }

  public logProtocol(): void {
    this.logger.info(
      `Protocol of the ${this.PROTOCOL.provider.name}:\n` +
        JSON.stringify(this.PROTOCOL, undefined, 2),
    );
  }

  /**
   * Registers this service provider with the ServiceManager.
   * Retries registration until successful. Initializes RegisterProcedure lazily.
   *
   * @returns Promise that resolves when registration succeeds
   */
  public async register(): Promise<void> {
    // Prevent multiple register procedures run.
    if (this._procedure.register) return;
    this._procedure.register = true; // Booking this procedure in minimal time.

    // Lazy initialization of the procedure.
    const { RegisterProcedure } = await import("../procedure");
    const procedure = new RegisterProcedure(this.configManager);
    this._procedure.register = procedure;

    // Context for execute the procedure.
    const context: RegisterContext = {
      // parent: this,
      taskName: this._TASK_CHANNEL_RESPONSE,
      tasks: this.tasks,
      idGenerator: this.idGenerator,

      manager: this._manager,
      protocol: this.PROTOCOL,
      smTaskName: this._TASK_MANAGER,

      ask: this.ask.bind(this),
      buildMessage: this.buildMessage.bind(this),
      getTcpTaskInfo: this.getTcpTaskInfo.bind(this),
    };

    // Repeat executing the procedure until it success.
    let success: boolean = false;
    while (!success) {
      success = await procedure.execute(context);
      if (success) {
        delete this._procedure.register;
        break;
      }
    }
  }

  /**
   * Reloads configuration only.
   *
   * @returns Promise that resolves when reload is complete.
   */
  public async reload(): Promise<void> {
    this.configManager.reload();
    this._setConfigManager(this.configManager);

    this.logger.debug(`Reloading in subclass ...`);
    await this.reloading();
    this.logger.debug(`${FOLLOW_UP}Subclass reloaded.`);
  }

  /**
   * Reports current runtime metrics to the ServiceManager.
   * Includes RAM consumption, free RAM, CPU load, and network transmission.
   *
   * @returns Promise that resolves when report is sent
   */
  public async report(): Promise<void> {
    let procedure = this._procedure.report;
    if (!procedure) {
      // Lazy initialization if procedure wasn't injected
      const { ReportProcedure } = await import("../procedure");
      procedure = new ReportProcedure(this.configManager);
      this._procedure.report = procedure; // Keep this procedure.
    }

    // Context for execute the procedure.
    const context: ReportContext = {
      parent: this,
      taskName: this._TASK_MANAGER,
      tasks: this.tasks,
      idGenerator: this.idGenerator,

      apiCounter: this._apiCounter,
      manager: this._manager,

      ask: this.ask.bind(this),
      buildMessage: this.buildMessage.bind(this),
    };

    const success = await procedure.execute(context);
    if (!success) {
      // Failed to report to ServiceManager meaning lost connection to it.
      // Thus, discover ServiceManager instances again.
      await this._discoverServiceManager();
    }
  }

  /**
   * Sends a response to an API request through the target TCP client.
   * Builds a header with success/failure status and message ID, then sends the payload.
   *
   * @param respArgs - Response arguments including API spec, data, error type, request, and target
   */
  protected async response(respArgs: ResponseArgs): Promise<void> {
    const { apiSpec, data, errType, request, target } = respArgs;
    if (!(target instanceof TcpClient)) return; // No target for respond.

    // 1. Define fixed MAX_MSG_ID_LEN (64) bytes header.
    /*
     * The first byte of the header denotes success or failed for this request.
     * Following with an UUID (message ID) of the request.
     */
    const header = Buffer.alloc(MAX_HEADER_LEN, 0);
    header[0] = 1; // Success.
    if (request.msgId) header.write(request.msgId, 1, DEFAULT_ENCODE);

    // Handle error situations.
    let payload: Buffer;
    if ([AckValue.Error, AckValue.InvalidReqData].includes(errType)) {
      header[0] = 0; // Failed.
      // Prepend header to the payload.
      payload = Buffer.concat([header, Buffer.from(errType, DEFAULT_ENCODE)]);
      await target.write(payload);
      return;
    }

    if (apiSpec.ack != AckType.None) {
      // Build payload buffer from the response data.
      if (data) {
        payload = Buffer.isBuffer(data)
          ? data
          : Buffer.from(data, DEFAULT_ENCODE);
      } else {
        payload = Buffer.from(AckValue.Ack, DEFAULT_ENCODE);
      }

      // 3. Prepend header and send response data.
      payload = Buffer.concat([header, payload]);
      await target.write(payload);
    }
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
   * Sets up the API channel TCP server for handling incoming API requests.
   *
   * @param subscribe - Whether to subscribe to data events
   * @returns The initialized TCP server
   */
  protected async setApiChannel(subscribe: boolean): Promise<TcpServer> {
    const task: TcpServer = await this.initializeTcpServer(
      this._TASK_CHANNEL_API,
    );
    if (subscribe) task.on(NetworkEvent.Data, this._handleTcpApiRequest);
    else task.off(NetworkEvent.Data, this._handleTcpApiRequest);
    return task;
  }

  /**
   * Sets up the response channel TCP server for receiving API responses from helper.
   *
   * @param subscribe - Whether to subscribe to data events
   * @returns The initialized TCP server
   */
  protected async setResponseChannel(subscribe: boolean): Promise<TcpServer> {
    const task: TcpServer = await this.initializeTcpServer(
      this._TASK_CHANNEL_RESPONSE,
    );
    if (subscribe) task.on(NetworkEvent.Data, this._handleApiResponse);
    else task.off(NetworkEvent.Data, this._handleApiResponse);
    return task;
  }

  /**
   * Sets up the system instruction channel TCP server for handling incoming
   * service life-cycle instructions (ex: reload, restart, stop, shutdown, ...).
   *
   * @param subscribe - Whether to subscribe to data events
   * @returns The initialized TCP server
   */
  protected async setSystemChannel(subscribe: boolean): Promise<TcpServer> {
    const task: TcpServer = await this.initializeTcpServer(
      this._TASK_CHANNEL_SYS,
    );
    if (subscribe) task.on(NetworkEvent.Data, this._handleTcpApiRequest);
    else task.off(NetworkEvent.Data, this._handleTcpApiRequest);
    return task;
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
      this.logger.info(`${this.getIdentity()} state: ${curState} → ${state}.`);
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
    await this._stopReportSchedule(); // Stop automatic reporting.
    await this._stopManagerTask();
    await this.setSystemChannel(false); // Stop the system instruction channel.
    await this._releaseResources();
    this.logger.info(`${this.getIdentity()} shutdown complete.`);
  }

  /**
   * Starts all services including TCP and UDP listeners.
   *
   * @returns Promise that resolves when initialization is complete.
   */
  public async start(): Promise<void> {
    const acceptStates = [
      ExecutionState.Error,
      ExecutionState.Initializing,
      ExecutionState.Retrying,
      ExecutionState.Stopped,
    ];
    if (!acceptStates.includes(this.getState())) return;

    if (!this._initialized) {
      await this._initializeResources();
    }
    await this._discoverServiceManager();
    this.setState(ExecutionState.Starting);

    this.logger.debug(`Starting the service in subclass ...`);
    await this.starting(); // Start services on subclass.
    this.logger.debug(`${FOLLOW_UP}Service started in subclass.`);

    // Establish a system instruction channel.
    await this.setSystemChannel(true);

    // Start automatic reporting.
    await this._startReportSchedule();
    this.logger.info(`${this.getIdentity()} started successfully.`);
    this.setState(ExecutionState.Running);
  }

  /**
   * Stops all registered services.
   *
   * @returns Promise that resolves when all services have stopped.
   */
  public async stop(): Promise<void> {
    const acceptStates = [ExecutionState.Running];
    if (!acceptStates.includes(this.getState())) return;

    this.logger.info(`Stopping the ${this.getIdentity()} service ...`);
    this.setState(ExecutionState.Stopping);

    this.logger.debug(`Stopping the service in subclass ...`);
    await this.stopping(); // Stop services on subclass.
    this.logger.debug(`${FOLLOW_UP}Service stopped in subclass.`);

    // Stop default services.
    const wait: Promise<void>[] = [];
    for (const name of this.tasks.keys()) {
      if (name === this._TASK_MANAGER) continue; // Don't stop ServiceManager task.

      const promise = this._stopTask(name);
      if (promise) wait.push(promise);
    }
    await Promise.all(wait);

    this.logger.info(`${this.getIdentity()} stopped.`);
    this.setState(ExecutionState.Stopped);
    await this.report(); // Report the last status.
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
    if (this.constructor.name !== "ServiceProvider")
      throw new Error(
        "Method buildAccessPointInfo(baseInfo: AccessPoint) is not implemented.",
      );
    return baseInfo;
  }

  /**
   * Initializes resources specific to the subclass.
   * Override this method to perform subclass-specific initialization.
   *
   * @throws {Error} If not implemented by subclass
   */
  protected async initializingResources(): Promise<void> {
    if (this.constructor.name !== "ServiceProvider")
      throw new Error("Method initializing() is not implemented.");
  }

  /**
   * Releases resources specific to the subclass.
   * Override this method to perform subclass-specific cleanup.
   *
   * @throws {Error} If not implemented by subclass
   */
  protected async releasingResources(): Promise<void> {
    if (this.constructor.name !== "ServiceProvider")
      throw new Error("Method releasingResources() is not implemented.");
  }

  /**
   * Reloads configuration specific to the subclass.
   * Override this method to handle subclass-specific reload logic.
   *
   * @throws {Error} If not implemented by subclass
   */
  protected async reloading(): Promise<void> {
    if (this.constructor.name !== "ServiceProvider")
      throw new Error("Method reloading() is not implemented.");
  }

  /**
   * Starts services specific to the subclass.
   * Override this method to perform subclass-specific startup logic.
   *
   * @throws {Error} If not implemented by subclass
   */
  protected async starting(): Promise<void> {
    if (this.constructor.name !== "ServiceProvider")
      throw new Error("Method starting() is not implemented.");
  }

  /**
   * Stops services specific to the subclass.
   * All tasks in the `tasks` map will be stopped automatically if the task has `stop()` method.
   * Override this method to perform subclass-specific shutdown logic.
   *
   * @throws {Error} If not implemented by subclass
   */
  protected async stopping(): Promise<void> {
    if (this.constructor.name !== "ServiceProvider")
      throw new Error("Method stopping() is not implemented.");
  }

  // --------------------------------------------
  // Private Methods
  // --------------------------------------------

  /**
   * Discovers the ServiceManager and establishes a TCP client connection.
   * Uses DiscoverProcedure to find available managers via UDP broadcast.
   * Retries discovery until a manager is found and connected.
   */
  private async _discoverServiceManager(): Promise<void> {
    // Prevent multiple discovery procedures run.
    if (this._procedure.discovery) return;
    this._procedure.discovery = true; // Booking this procedure in minimal time.
    this._managerInfo = [];
    this._manager = {};
    if (this.tasks.has(this._TASK_MANAGER)) {
      const smTask = this.tasks.get(this._TASK_MANAGER);
      smTask.stop();
      this.tasks.delete(this._TASK_MANAGER);
    }

    // Lazy initialization of the procedure.
    const { DiscoverProcedure } = await import("../procedure");
    const procedure = new DiscoverProcedure(this.configManager);
    this._procedure.discovery = procedure;

    // Context for execute the procedure.
    const context: ProcedureContext = {
      // parent: this,
      taskName: this._TASK_MANAGER,
      tasks: this.tasks,
      idGenerator: this.idGenerator,
    };

    // Repeat executing the procedure until it success.
    let result: ManagerInfo | undefined = undefined;
    while (!result) {
      result = await procedure.execute(context);
      if (result?.managerInfo) {
        this._managerInfo = result.managerInfo;
        this._manager = result.manager;
        this.tasks.set(this._TASK_MANAGER, result.instance);
        delete this._procedure.discovery;
        break;
      }
    }
  }

  /**
   * Gets the socket address (IP and port) from a task.
   *
   * @param taskName - The task name to query
   * @returns SocketAddress with address, port, and TCP protocol
   * @throws Error if task is not a TCP server/client or is malfunctioning
   */
  private _getSocketAddr(
    taskName: string = this._TASK_CHANNEL_RESPONSE,
  ): SocketAddress {
    let addr:
        | {
            address: string;
            port: number;
          }
        | undefined,
      protocol: NetworkProtocol = NetworkProtocol.TCP;
    const task = this.getTask(taskName);
    if (task instanceof TcpServer) addr = task.getServer()?.address() as any;
    else if (task instanceof TcpClient)
      addr = task.getSocket()?.address() as any;
    else {
      const message = `The <${taskName}> task is neither a TCP server nor a TCP client.`;
      this.logger.error(message);
      throw new Error(message);
    }
    if (!addr || typeof addr !== "object") {
      const message = `The <${taskName}> task is malfunction.`;
      this.logger.error(message);
      throw new Error(message);
    }

    const socketAddr: SocketAddress = {
      address: getHostIP(), // Host IP of the provider.
      port: addr.port, // Port number the access point listening on.
      protocol: protocol, // Network protocol of the access point.
    };
    return socketAddr;
  }

  /**
   * Handles incoming API request data from TCP.
   * Parses JSON, executes the API handler, and sends response.
   *
   * @param data - Raw string or Buffer data from TCP
   */
  private _handleApiRequest = async (data: string | Buffer): Promise<void> => {
    if (!data) {
      this.logger.debug(`Incomplete message received.`);
      return;
    }

    let apiSpec!: ApiSpec;
    let errType: AckValue = AckValue.None;
    let json!: ApiCall;
    let result: any[] = [];
    const message = data instanceof Buffer ? data.toString() : (data as string);
    const pmsJob: Promise<any>[] = [];
    try {
      // 1. Parse the request.
      json = JSON.parse(message);
      const parsed = this._parseRequest(json);
      if (!parsed) {
        return;
      }
      apiSpec = parsed.apiSpec;

      // 2. Perform the requested job.
      pmsJob.push(parsed.api.call(this, json));

      // 3. Get the response target channel.
      pmsJob.push(this.getResponseChannel(json));
      result = await Promise.all(pmsJob);
    } catch (err) {
      if (err instanceof SyntaxError) {
        // Matches errors like "Unexpected token" or "Unexpected end of JSON input"
        errType = AckValue.InvalidReqData;
        this.logger.warn(`Invalid request: Incorrect JSON format.\n${message}`);
      } else if (err instanceof TypeError) {
        // Matches errors if 'data' was null or undefined
        errType = AckValue.InvalidReqData;
        this.logger.warn(
          `Invalid request: Data was null or incompatible: ${err.message}`,
        );
      } else {
        errType = AckValue.Error;
        const api = json?.api ? json.api : UNKNOWN_ATTRIBUTE;
        if (err instanceof Error) {
          this.logger.error(`Unexpected error on <${api}>: ${err.message}`);
        }
      }
    } finally {
      this._updateApiCouynter(errType, json);
      if (result.length > 1) {
        const respArgs: ResponseArgs = {
          apiSpec: apiSpec,
          data: result[0],
          errType: errType,
          request: json,
          target: result[1],
        };
        await this.response(respArgs);
      }
    }
  };

  /**
   * Handles API response data from the response channel.
   * Extracts header (success/failure and message ID) and payload,
   * then resolves or rejects the pending promise.
   *
   * @param peer - The network peer that sent the response
   * @param data - The response data buffer
   */
  private _handleApiResponse = ({
    peer,
    data,
  }: {
    peer: NetworkPeer;
    data: string | Buffer;
  }): void => {
    if (!peer || !data || data.length < MAX_HEADER_LEN) {
      this.logger.debug(`Incomplete message received.`);
      return;
    }

    // 1. Extrac header from the response message.
    /*
     * The first MAX_HEADER_LEN (64) bytes of the response data is the header.
     * The first byte of the header denotes success or failed for this request.
     * Following with an UUID (message ID) of the request.
     */
    let payload = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data, DEFAULT_ENCODE);
    const header = payload.subarray(0, MAX_HEADER_LEN);
    const success = !!header[0]; // First byte is 0 or 1.
    // Convert buffer to string and eliminate padded null bytes (\0).
    const msgId = header.subarray(1).toString("utf8").replace(/\0/g, "");
    // Extract the payload (Everything from Byte 64 onwards)
    const message: Buffer = payload.subarray(MAX_HEADER_LEN);

    // 2. Resolve / reject the response message back to the requester.
    const request: ApiCall | undefined = this.polReqs.get(msgId);
    this.polReqs.delete(msgId);
    if (request?.promise) {
      if (success) {
        this.logger.debug(`${FOLLOW_UP}Success on <${msgId}>.`);
        request.promise.resolve.call(this, { response: message, request });
      } else {
        this.logger.debug(`${FOLLOW_UP}Failed on <${msgId}>.`);
        request.promise.reject.call(this, { err: message, request });
      }
    }
  };

  /**
   * Handles incoming data on a peer-specific response channel.
   * Parses the JSON API call and invokes the corresponding handler method.
   *
   * @param peer - The network peer that sent the data
   * @param data - The data buffer containing the API call JSON
   */
  private _handleChannelResponse = ({
    peer,
    data,
  }: {
    peer: NetworkPeer;
    data: string | Buffer;
  }): void => {
    if (!peer || !data) {
      this.logger.debug(`Incomplete message received.`);
      return;
    }

    // TODO
    try {
      const json: ApiCall = JSON.parse(data.toString());
      const apiPath = json.api
        .split("/") // Split the path by "/".
        .filter(Boolean); // Remove all "falsy" (false, 0, "", null, undefined, and NaN) elements.
      let tier: any = this.apis; // this.apis holds nested dynamic assigned functions.
      for (const path of apiPath) {
        if (!tier || typeof tier !== "object" || !(path in tier)) {
          this.logger.warn(`API not found: ${json.api}`);
          return;
        }
        tier = tier[path];
      }
      if (typeof tier !== "function") {
        this.logger.warn(`Invalid API path: ${json.api}`);
        return;
      }
      tier.call(this, peer, json);
    } catch (err) {
      this.logger.warn(`Invalid request: Incorrect JSON format.\n${data}`);
    }
  };

  /**
   * Wraps _handleApiRequest with peer extraction for TCP server events.
   *
   * @param params - Object containing peer and data from TCP server event
   */
  private _handleTcpApiRequest = async ({
    peer,
    data,
  }: {
    peer: NetworkPeer;
    data: string | Buffer;
  }): Promise<void> => {
    if (!peer || !data) {
      this.logger.debug(`Incomplete message received.`);
      return;
    }
    await this._handleApiRequest(data);
  };

  /**
   * Initializes OpenTelemetry tracer and metrics.
   * Replaces default ProviderState with OtelProviderState if needed.
   */
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

  /**
   * Initializes resources including OpenTelemetry, TCP servers, and subclass resources.
   * Sets up the response channel and marks provider as initialized.
   */
  private async _initializeResources(): Promise<void> {
    this.logger.debug(`Initializing ${this.getIdentity()} ...`);
    this.setState(ExecutionState.Initializing);

    const jobs: Promise<any>[] = [];
    jobs.push(this._initializeOtel());
    jobs.push(this.initializeTcpServer(this._TASK_CHANNEL_RESPONSE));
    const result = await Promise.all(jobs);
    if (result.length > 1) this.setResponseChannel(true);

    this.logger.debug(`Initializing resources in subclass ...`);
    this.initializeApiFunctionMap();
    await this.initializingResources();
    this.logger.debug(`${FOLLOW_UP}Subclass resources initialized.`);

    this._initialized = true;
    this.logger.debug(`${this.getIdentity()} initialized.`);
  }

  /**
   * Parses an API call request to extract the handler function and API spec.
   *
   * @param apiCall - The API call to parse
   * @returns Object with api handler function and apiSpec, or undefined if not found
   */
  private _parseRequest(
    apiCall: ApiCall,
  ): { api: Function; apiSpec: ApiSpec } | undefined {
    const from = this.getPeerId(apiCall);
    this.logger.debug(`Request ${from}:<${apiCall.api}> received.`);

    const apiPath = apiCall.api
      .split("/") // Split the path by "/".
      .filter(Boolean); // Remove all "falsy" (false, 0, "", null, undefined, and NaN) elements.

    // Get the handler function for this request.
    let api: any = this.apis; // this.apis holds nested dynamic assigned functions.
    let apiSpec: any = this.PROTOCOL.apis;
    for (const path of apiPath) {
      if (!api || typeof api !== "object" || !(path in api)) {
        this.logger.warn(`API not found: ${apiCall.api}`);
        return;
      }
      api = api[path];
      apiSpec = apiSpec[path];
    }

    if (typeof api !== "function") {
      this.logger.warn(`Invalid API path: ${apiCall.api}`);
      return;
    }
    return { api, apiSpec };
  }

  /**
   * Releases OpenTelemetry resources (metrics and tracer).
   */
  private async _releaseOtel(): Promise<void> {
    const promises = [];
    if (this.metrics) {
      promises.push(this.metrics.shutdown());
    }
    if (this.tracer) {
      const providerId = this.configManager.getProviderId();
      promises.push(OtelTracer.getInstance(providerId).shutdown());
    }

    await Promise.all(promises);
    this.metrics = undefined as unknown as OtelMeterics;
    this.tracer = undefined as unknown as OtelTracer;
  }

  /**
   * Releases all allocated resources including response channels and OpenTelemetry.
   * Calls subclass releasingResources hook.
   */
  private async _releaseResources(): Promise<void> {
    this.logger.debug(`Cleanup ${this.getIdentity()} ...`);

    this.logger.debug(`Releasing resources allocated in subclass ...`);
    await this.releasingResources(); // Release resources on subclass.
    this.logger.debug(`${FOLLOW_UP}Subclass resources released.`);

    const release: Promise<void>[] = [];
    release.push(this._releaseResponseChannels()); // Close and release response channels.
    release.push(this._releaseOtel());
    await Promise.all(release);

    this._initialized = false;
    this.logger.debug(`${this.getIdentity()} released.`);
  }

  /**
   * Releases all response channels (TCP clients) in the chnResp pool.
   * Stops each channel and removes it from the registry.
   *
   * @throws Error if any channels cannot be released
   */
  private async _releaseResponseChannels(): Promise<void> {
    this.logger.debug(`Release response channels ...`);
    // this.chnResp is in the { service: { instance: TcpClient }} format.
    // 1. Iterate through the services.
    for (const [service, instances] of Object.entries(this.chnResp)) {
      // 2. Iterate through the instances within the service.
      for (const [instId, channel] of Object.entries(instances)) {
        // 3. Stop the channel.
        channel.off(NetworkEvent.Data, this._handleChannelResponse);
        await channel.stop();
        delete this.chnResp[service][instId];
        this.logger.debug(
          `${FOLLOW_UP}<${service}-${instId}> response channel released.`,
        );
      }
      if (Object.keys(this.chnResp[service]).length === 0) {
        delete this.chnResp[service];
      }
    }

    if (Object.keys(this.chnResp).length > 0) {
      throw new Error(
        "Unable to release some resources on the response channel pool.",
      );
    }
    this.logger.debug(`${FOLLOW_UP}All response channels are released.`);
  }

  /**
   * Updates the ConfigManager and syncs provider information.
   *
   * @param configManager - The new ConfigManager instance
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

  /**
   * Starts the automatic report scheduling.
   * Reports are sent at configurable intervals after successful registration.
   * @returns Promise that resolves when scheduling is set up or if reporting is disabled
   */
  private async _startReportSchedule(): Promise<void> {
    // Check preconditions
    if (this._reportTimer) {
      await this._stopReportSchedule(); // Stop the existing reporter.
    }
    const reportConfig = this.configManager.getCoreConfig().report;
    if (!reportConfig?.enabled) {
      this.logger.info("Automatic reporting is disabled.");
      return;
    }
    const smTask = this.tasks.get(this._TASK_MANAGER);
    if (!(smTask instanceof TcpClient)) {
      this.logger.info("No ServiceManager found for report.");
      return;
    }

    // Schedule periodic reports
    const interval = reportConfig?.interval ?? 60 * SECOND;
    this._reportTimer = setInterval(async () => {
      await this.report();
    }, interval);

    this.logger.info(
      `Automatic reporting started for reporting every ${interval / SECOND} second(s) ...`,
    );
  }

  /**
   * Stops the automatic report scheduling timer.
   */
  private async _stopReportSchedule(): Promise<void> {
    if (this._reportTimer) {
      clearInterval(this._reportTimer);
      this._reportTimer = null;
      this.logger.debug(`${FOLLOW_UP}Automatic reporting stopped.`);
    }
  }

  /**
   * Stops the ServiceManager task if it exists.
   */
  private async _stopManagerTask(): Promise<void> {
    if (this.tasks.has(this._TASK_MANAGER)) {
      await this._stopTask(this._TASK_MANAGER);
    }
  }

  /**
   * Stops a task by name and removes it from the tasks map.
   *
   * @param taskName - The name of the task to stop
   * @returns Promise that resolves when the task is stopped
   */
  private async _stopTask(taskName: string): Promise<void> {
    const task = this.tasks.get(taskName);
    if (!task || typeof task.stop !== "function") return;

    const promise: Promise<void> = task
      .stop()
      .then(() => {
        this.logger.debug(
          `${FOLLOW_UP}<${taskName}> task stopped successfully.`,
        );
        this.tasks.delete(taskName);
      })
      .catch((error: Error) => {
        this.logger.error(
          `Failed to stop task <${taskName}>: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      });
    return promise;
  }

  /**
   * Updates API call counter statistics based on error type.
   *
   * @param errType - The type of error that occurred
   * @param json - The API call object
   */
  private _updateApiCouynter(errType: AckValue, json: ApiCall) {
    // Update API counter statistics
    if (json?.api) {
      const apiPath = json.api;
      let counter = this._apiCounter.get(apiPath);
      if (!counter) {
        counter = {
          success: 0,
          invalidRequest: 0,
          failedOnProcess: 0,
        };
        this._apiCounter.set(apiPath, counter);
      }

      // Increment appropriate counter based on error type
      if (errType === AckValue.InvalidReqData) {
        counter.invalidRequest++;
      } else if (errType === AckValue.Error) {
        counter.failedOnProcess++;
      } else if (errType === AckValue.None) {
        counter.success++;
      }
    }
  }

  /**
   * Updates provider information in protocol and config.
   * Syncs instance ID and service name between protocol and config.
   */
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
