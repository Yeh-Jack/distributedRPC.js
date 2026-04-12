import { inject, injectable } from "inversify";
import { DetectedResourceAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

import {
  AccessPoint,
  AckType,
  AckValue,
  ApiCall,
  ApiSpec,
  AppEnv,
  BasalProtocol,
  ExecutionState,
  IdGenerator,
  NetworkProtocol,
  PeerIdentity,
  ProviderConnectInfo,
  RegisterInfo,
  ResponseArgs,
  SocketAddress,
  getAppEnv,
  DEFAULT_ENCODE,
  FOLLOW_UP,
  MAX_HEADER_LEN,
  SECOND,
  UNKNOWN_ATTRIBUTE,
} from "../types/basal-protocol";
import { BroadcastResponse260321 } from "../manager/api-spec-260321";
import { TcpClient } from "../network/tcp-client";
import {
  createNamedTcpServer,
  createServiceManagerDiscover,
  TYPES,
} from "../aop/container";
import { ConfigManager } from "../common/config";
import { LoggerManager } from "../common/logger";
import { OtelMeterics, OtelProviderState } from "../metrics/otel-metrics";
import { OtelTracer } from "../metrics/otel-tracing";
import {
  NetworkEvent,
  NetworkPeer,
  getHostIP,
} from "../network/network-events";
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
  private readonly _EVENT_MGR_RESPONSE = "mgr_response";
  protected readonly _TASK_CHANNEL_API: string = "_chnAPI";
  protected readonly _TASK_CHANNEL_RESPONSE: string = "_chnResponse";
  protected readonly _TASK_MANAGER: string = "_svcManager";
  protected readonly PROTOCOL: BasalProtocol;

  protected configManager: ConfigManager;
  protected logger!: ReturnType<LoggerManager["getLogger"]>;
  protected tasks: Map<string, any> = new Map(); // Internal tasks handler.

  // Resources should be released during shutdown.
  protected apis: any = {}; // Holds nested dynamic assigned api_name and function mapping.
  // chnResp holds nested response channels and it's in the { service: { instance: TcpClient }} format.
  protected chnResp: Record<string, Record<string, TcpClient>> = {};
  // polReqs stores API requests sent and it's in the { msgId: ApiCall } format.
  protected polReqs: Map<string, ApiCall> = new Map();
  protected metrics!: OtelMeterics;
  protected tracer!: OtelTracer;

  private _initialized: boolean = false;
  private _manager: any = {}; // Keep effective ServiceManager information.
  private _managerInfo: BroadcastResponse260321[] = [];
  private _providerState!: ProviderState;
  private _registering: boolean = false;

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

  public async activate(): Promise<void> {
    // TODO
  }

  protected async ask(
    helper: TcpClient,
    message: ApiCall,
  ): Promise<{ msgId: string; promise: Promise<any> }> {
    const msgId = await helper.sendMessage(message);
    const { promise, resolve, reject } = Promise.withResolvers();
    message.promise = {
      resolve: resolve,
      reject: reject,
    };
    this.polReqs.set(msgId, message);
    return { msgId, promise };
  }

  protected async askProviderInfo(
    data: ApiCall,
  ): Promise<ProviderConnectInfo | undefined> {
    // TODO
    return;
  }

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

  protected getPeerId(data: ApiCall, arrowed: boolean = true): string {
    const peer: PeerIdentity = data.peer;
    const msg = `${peer.service}-${peer.instance}`;
    return arrowed ? `<${msg}>` : msg;
  }

  /**
   * This is a remote instruction for description protocol format of this service provider.
   */
  public async getProtocol(): Promise<string> {
    return JSON.stringify(this.PROTOCOL);
  }

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

  protected getSocketString(
    socketAddr: SocketAddress,
    arrowed: boolean = true,
  ): string {
    const msg = `${socketAddr.address}:${socketAddr.port}`;
    return arrowed ? `<${msg}>` : msg;
  }

  public getState(): ExecutionState {
    return this._providerState.getState();
  }

  protected getTask(taskName: string = this._TASK_CHANNEL_RESPONSE): any {
    const task = this.tasks.get(taskName);
    if (!task) {
      const message = `The <${taskName}> task doesn't exist.`;
      this.logger.error(message);
      throw new Error(message);
    }
    return task;
  }

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

  public async halt(): Promise<void> {
    //TODO
  }

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
   * Initializes and starts a TCP server.
   *
   * @param name - Unique name for this listener.
   * @returns Promise that resolves when the listener is started.
   */
  protected async initializeTcpServer(name: string): Promise<any> {
    try {
      const tcpServer: TcpServer = createNamedTcpServer(
        this.configManager,
        name,
      );
      await tcpServer.start();
      this.tasks.set(name, tcpServer);
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

  public async register(): Promise<void> {
    const smTask = this.tasks.get(this._TASK_MANAGER);
    if (this._registering || !(smTask && smTask instanceof TcpClient)) return;

    this.logger.info(`Registering this provider to the service manager ...`);
    this._registering = true;
    const ap: AccessPoint = this.getTcpTaskInfo(this._TASK_CHANNEL_RESPONSE);
    const regInfo: RegisterInfo = {
      ...this.PROTOCOL,
      provider: {
        ...this.PROTOCOL.provider,
        ...ap,
      },
    };
    const apiData: ApiCall = this.buildMessage("register", regInfo);

    this.logger.silly(
      `Register information :\n${JSON.stringify(apiData, undefined, 2)}`,
    );
    const { msgId, promise } = await this.ask(smTask, apiData);

    promise
      .then(({ response, request }: { response: Buffer; request: ApiCall }) => {
        const ack: string = response ? response.toString() : "";
        this.logger.info(
          `${FOLLOW_UP}Register to the service manager: <${ack}>.`,
        );
        // await this._testRegistered(smTask, msgId);
      })
      .catch(({ err, request }: { err: Buffer; request: ApiCall }) => {
        this.logger.warn(
          `${FOLLOW_UP}Error on <register:${msgId}>: ${err.toString()}`,
        );
      })
      .finally(() => {
        this._registering = false;
      });
  }

  /**
   * Reloads configuration only.
   *
   * @returns Promise that resolves when reload is complete.
   */
  public async reload(): Promise<void> {
    this.configManager.reload();
    this._setConfigManager(this.configManager);

    this.logger.silly(`Reloading in subclass ...`);
    await this.reloading();
    this.logger.silly(`${FOLLOW_UP}Subclass reloaded.`);
  }

  public async report(): Promise<void> {
    // TODO
  }

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

  protected async setApiChannel(subscribe: boolean): Promise<any> {
    const task: TcpServer = await this.initializeTcpServer(
      this._TASK_CHANNEL_API,
    );
    if (subscribe) task.on(NetworkEvent.Data, this._handleTcpApiRequest);
    else task.off(NetworkEvent.Data, this._handleTcpApiRequest);
    return task;
  }

  protected async setResponseChannel(subscribe: boolean): Promise<any> {
    const task: TcpServer = await this.initializeTcpServer(
      this._TASK_CHANNEL_RESPONSE,
    );
    if (subscribe) task.on(NetworkEvent.Data, this._handleApiResponse);
    else task.off(NetworkEvent.Data, this._handleApiResponse);
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
    await this._stopManagerTask(this._TASK_MANAGER);
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

    this.setState(ExecutionState.Starting);

    this.logger.silly(`Starting the service in subclass ...`);
    await this.starting(); // Start services on subclass.
    this.logger.silly(`${FOLLOW_UP}Service started in subclass.`);

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

    this.logger.silly(`Stopping the service in subclass ...`);
    await this.stopping(); // Stop services on subclass.
    this.logger.silly(`${FOLLOW_UP}Service stopped in subclass.`);

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

  private async _connectManager(): Promise<void> {
    if (this._managerInfo?.length < 1) return;
    this._manager = { ...this._managerInfo[0] }; // Store received serive manager information.
    const mgrAP: AccessPoint = this._manager.manager.provider;
    this.logger.silly(
      `ServiceManager info :\n${JSON.stringify(mgrAP, undefined, 2)}`,
    );
    const smTask: TcpClient = new TcpClient(
      this.configManager,
      mgrAP,
      this._TASK_MANAGER,
    );
    this.tasks.set(this._TASK_MANAGER, smTask);
    this._manager.instance = smTask; // Store the ServiceManager instance.
    await smTask.start();

    smTask.on(NetworkEvent.Data, this._handleMgrResponse);
  }

  private _getSocketAddr(
    taskName: string = this._TASK_CHANNEL_RESPONSE,
  ): SocketAddress {
    let addr,
      protocol: NetworkProtocol = NetworkProtocol.TCP;
    const task = this.getTask(taskName);
    if (task instanceof TcpServer) addr = task.getServer()?.address();
    else if (task instanceof TcpClient) addr = task.getSocket()?.address();
    else {
      const message = `The <${taskName}> task is nither TCP server nor TCP client.`;
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

  // private _handleApiRequest = (
  //   peer: NetworkPeer,
  //   raw: string | Buffer,
  // ): void => {
  //   if (!raw) return;
  //   try {
  //     const json: ApiCall = JSON.parse(data.toString());
  //     const apiPath = json.api
  //       .split("/") // Split the path by "/".
  //       .filter(Boolean); // Remove all "falsy" (false, 0, "", null, undefined, and NaN) elements.
  //     let tier: any = this.apis; // this.apis holds nested dynamic assigned functions.
  //     for (const path of apiPath) {
  //       if (!tier || typeof tier !== "object" || !(path in tier)) {
  //         this.logger.warn(`API not found: ${json.api}`);
  //         return;
  //       }
  //       tier = tier[path];
  //     }
  //     if (typeof tier !== "function") {
  //       this.logger.warn(`Invalid API path: ${json.api}`);
  //       return;
  //     }
  //     tier.call(this, peer, json);
  //   } catch (err) {
  //     this.logger.warn(`Invalid request: Incorrect JSON format.\n${data}`);
  //   }
  // };

  private async _handleApiRequest(data: string | Buffer): Promise<void> {
    if (!data) {
      this.logger.debug(`Incomplete message received.`);
      return;
    }

    let apiSpec!: ApiSpec;
    let errType: AckValue = AckValue.None;
    let json!: ApiCall;
    let result: any[] = [];
    const message = data instanceof Buffer ? data.toString() : data;
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
  }

  private _handleApiResponse = ({
    peer,
    data,
  }: {
    peer: NetworkPeer;
    data: string | Buffer;
  }) => {
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
        this.logger.silly(`${FOLLOW_UP}Success on <${msgId}>.`);
        request.promise.resolve.call(this, { response: message, request });
      } else {
        this.logger.silly(`${FOLLOW_UP}Failed on <${msgId}>.`);
        request.promise.reject.call(this, { err: message, request });
      }
    }
  };

  private _handleChannelResponse = ({
    peer,
    data,
  }: {
    peer: NetworkPeer;
    data: string | Buffer;
  }) => {
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

  private _handleMgrResponse(peer: NetworkPeer, data: Buffer): void {
    const smTask = this.tasks.get(this._TASK_MANAGER);
    if (!smTask || !(smTask instanceof TcpClient)) return;

    let raw = "";
    try {
      raw = data.toString();
      const json = JSON.parse(raw);
      smTask.emit(this._EVENT_MGR_RESPONSE, json);
    } catch (err) {
      this.logger.warn(`Received data is not a valid JSON :\n${raw}`);
    }
  }

  private _handleTcpApiRequest = async ({
    peer,
    data,
  }: {
    peer: NetworkPeer;
    data: string | Buffer;
  }) => {
    if (!peer || !data) {
      this.logger.debug(`Incomplete message received.`);
      return;
    }
    await this._handleApiRequest(data);
  };

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
      this._managerInfo = [];
      return;
    }

    this.tasks.set(discoveryName, discovery);
    this._managerInfo = (await discovery.discover()).responses;
    await this._connectManager();
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
    this.logger.debug(`Initializing ${this.getIdentity()} ...`);
    this.setState(ExecutionState.Initializing);

    const jobs: Promise<any>[] = [];
    jobs.push(this._initializeOtel());
    jobs.push(this.initializeTcpServer(this._TASK_CHANNEL_RESPONSE));
    const result = await Promise.all(jobs);
    if (result.length > 1) this.setResponseChannel(true);

    await this._discoverServiceManager();

    this.logger.silly(`Initializing resources in subclass ...`);
    this.initializeApiFunctionMap();
    await this.initializingResources();
    this.logger.silly(`${FOLLOW_UP}Subclass resources initialized.`);

    this._initialized = true;
    this.logger.debug(`${this.getIdentity()} initialized.`);
  }

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
   * Releases allocated resources including metrics and callbacks.
   *
   * @returns Promise that resolves when resources are released.
   */
  private async _releaseResources(): Promise<void> {
    this.logger.debug(`Cleanup ${this.getIdentity()} ...`);

    this.logger.silly(`Releasing resources allocated in subclass ...`);
    await this.releasingResources(); // Release resources on subclass.
    this.logger.silly(`${FOLLOW_UP}Subclass resources released.`);

    const release: Promise<void>[] = [];
    release.push(this._releaseResponseChannels()); // Close and release response channels.
    release.push(this._releaseOtel());
    await Promise.all(release);

    this._initialized = false;
    this.logger.debug(`${this.getIdentity()} released.`);
  }

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
        this.logger.silly(
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

  private async _stopManagerTask(taskName: string): Promise<void> {
    const smTask = this.tasks.get(taskName);
    if (!smTask || !(smTask instanceof TcpClient)) return;

    smTask.off(NetworkEvent.Data, this._handleMgrResponse);
    await this._stopTask(taskName);
  }

  private async _stopTask(taskName: string): Promise<void> {
    const task = this.tasks.get(taskName);
    if (!task || typeof task.stop !== "function") return;

    const promise: Promise<void> = task
      .stop()
      .then(() => {
        this.logger.info(`Task <${taskName}> stopped successfully.`);
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

  private async _testRegistered(
    smTask: TcpClient,
    msgId: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        smTask.off(this._EVENT_MGR_RESPONSE, smResponse);
        reject(
          new Error(
            "Timeout for waiting ServiceManager registration acknowledgment",
          ),
        );
      }, 5 * SECOND);

      const smResponse = (json: any): void => {
        if (
          json.attributes["network.operation"] === "register.ack" &&
          json.attributes["correlation.id"] === msgId
        ) {
          clearTimeout(timer);
          smTask.off(this._EVENT_MGR_RESPONSE, smResponse);
          resolve();
        }
      };

      smTask.on(this._EVENT_MGR_RESPONSE, smResponse);
    });
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
