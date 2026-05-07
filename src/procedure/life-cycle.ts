import { inject, injectable } from "inversify";

import { Procedure, ProcedureContext } from "./procedure";
import { ManagerInfo } from "./discover";
import { RegisterContext } from "./register";
import { ReportContext } from "./report";
import { TYPES } from "../aop/container";
import { ConfigManager } from "../common/config";
import { NetworkEvent, NetworkPeer } from "../network/network-events";
import { TcpClient } from "../network/tcp-client";
import { TcpServer } from "../network/tcp-server";
import { TypedEventEmitter } from "../network/typed-event-emitter";
import {
  ProviderTask,
  ServiceEvent,
  ServiceEventMap,
  ServiceProvider,
} from "../provider/service-provider";
import {
  AckValue,
  ApiCall,
  ApiSpec,
  ExecutionState,
  FOLLOW_UP,
  ResponseArgs,
  SECOND,
} from "../types/basal-protocol";

export interface LifeCycleContext extends ProcedureContext {
  eventEmitter: TypedEventEmitter<ServiceEventMap>;
  operation: LifeCycleOperation;
}

export type LifeCycleOperation =
  | "activate"
  | "halt"
  | "register"
  | "reload"
  | "report"
  | "restart"
  | "shutdown"
  | "start"
  | "stop";

@injectable()
export class LifeCycleProcedure extends Procedure {
  private _events!: TypedEventEmitter<ServiceEventMap>;
  private _parent!: ServiceProvider;

  // Current ServiceManager instance and it's information.
  private _manager: ManagerInfo = {};

  // Procedure instances.
  private _procedure: any = {};

  // Timer for the scheduled status reporter.
  private _reportTimer: NodeJS.Timeout | null = null;

  constructor(@inject(TYPES.ConfigManager) configManager: ConfigManager) {
    super(configManager);
  }

  public async execute(context?: LifeCycleContext): Promise<boolean> {
    if (context) this.context = context;
    if (!this.context) return false;

    const { eventEmitter, operation, parent } = this
      .context as LifeCycleContext;
    if (!(operation && parent)) return false;

    this._events = eventEmitter;
    this._parent = parent;
    this._procedure = parent["_procedure"];

    return await this._doSysInstruction(operation);
  }

  /**
   * Get current ServiceManager instance and it's information.
   * @returns
   */
  public getServiceManager(): ManagerInfo {
    return this._manager;
  }

  // --------------------------------------------
  // Private Life-Cycle Methods
  // --------------------------------------------

  /**
   * Activates this service provider if it's halted.
   *
   * @returns Promise that resolves when activation is complete.
   */
  private async _activate(): Promise<boolean> {
    const acceptStates = [ExecutionState.Halt];
    if (!(this._parent && acceptStates.includes(this._parent.getState())))
      return false;

    this.logger.info(
      `Activating the ${this._parent.getIdentity()} service ...`,
    );
    this._parent["setState"](ExecutionState.Starting);

    const { tasks } = this.context as LifeCycleContext;
    const task: TcpServer = tasks.get(ProviderTask.ChannelApi);
    task.start();

    this.logger.info(`${this._parent.getIdentity()} is activated.`);
    this._parent["setState"](ExecutionState.Running);
    await this._report();
    return true;
  }

  /**
   * Halts the service provider gracefully.
   * @returns Promise that resolves when halt is complete.
   */
  private async _halt(): Promise<boolean> {
    const acceptStates = [ExecutionState.Running];
    if (!(this._parent && acceptStates.includes(this._parent.getState())))
      return false;

    this.logger.info(`Halting the ${this._parent.getIdentity()} service ...`);
    this._parent["setState"](ExecutionState.Halting);

    const { tasks } = this.context as LifeCycleContext;
    const task: TcpServer = tasks.get(ProviderTask.ChannelApi);
    task.stop();

    this.logger.info(`${this._parent.getIdentity()} is halted.`);
    this._parent["setState"](ExecutionState.Halt);
    await this._report();
    return true;
  }

  /**
   * Registers this service provider with the ServiceManager.
   * Retries registration until successful. Initializes RegisterProcedure lazily.
   *
   * @returns Promise that resolves when registration succeeds
   */
  private async _register(): Promise<boolean> {
    // Prevent multiple register procedures run.
    if (this._procedure.register) return true;
    this._procedure.register = true; // Booking this procedure in minimal time.

    // Lazy initialization of the procedure.
    const { RegisterProcedure } = await import("../procedure");
    const procedure = new RegisterProcedure(this.configManager);
    this._procedure.register = procedure;

    // Context for execute the procedure.
    const { idGenerator, tasks } = this.context as LifeCycleContext;
    const context: RegisterContext = {
      // parent: this,
      taskName: ProviderTask.ChannelResponse,
      tasks: tasks,
      idGenerator: idGenerator,

      manager: this._manager.manager!,
      protocol: this._parent["PROTOCOL"],
      smTaskName: ProviderTask.Manager,

      ask: this._parent["ask"].bind(this._parent),
      buildMessage: this._parent["buildMessage"].bind(this._parent),
      getTcpTaskInfo: this._parent["getTcpTaskInfo"].bind(this._parent),
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
    return success;
  }

  /**
   * Reloads configuration only.
   *
   * @returns Promise that resolves when reload is complete.
   */
  private async _reload(): Promise<boolean> {
    // this.configManager and parent.configManager is the same object.
    this.configManager.reload();
    this._parent["_setConfigManager"](this.configManager);

    this.logger.debug(`Reloading in subclass ...`);
    await this._parent["reloading"]();
    this.logger.debug(`${FOLLOW_UP}Subclass reloaded.`);
    return true;
  }

  /**
   * Reports current runtime metrics to the ServiceManager.
   * Includes RAM consumption, free RAM, CPU load, and network transmission.
   *
   * @returns Promise that resolves when report is sent
   */
  private async _report(): Promise<boolean> {
    let procedure = this._procedure.report;
    if (!procedure) {
      // Lazy initialization if procedure wasn't injected
      const { ReportProcedure } = await import("../procedure");
      procedure = new ReportProcedure(this.configManager);
      this._procedure.report = procedure; // Keep this procedure.
    }

    // Context for execute the procedure.
    const { idGenerator, tasks } = this.context as LifeCycleContext;
    const context: ReportContext = {
      parent: this._parent,
      taskName: ProviderTask.Manager,
      tasks: tasks,
      idGenerator: idGenerator,

      apiCounter: this._parent["_apiCounter"],
      manager: this._manager.manager?.manager!,

      ask: this._parent["ask"].bind(this._parent),
      buildMessage: this._parent["buildMessage"].bind(this._parent),
    };

    const success = await procedure.execute(context);
    if (!success) {
      // Failed to report to ServiceManager meaning lost connection to it.
      // Thus, discover ServiceManager instances again.
      this._events.emit(ServiceEvent.ManagerDisconnect, this._parent);
      await this._discoverServiceManager();
    }
    return success;
  }

  /**
   * Restart the service. Restart performs stop, reload, and start in sequence.
   *
   * @returns Promise that resolves when restart is complete.
   */
  private async _restart(): Promise<boolean> {
    await this._stop();
    await this._releaseResources();

    await this._reload();
    await this._start();
    return true;
  }

  /**
   * Shuts down the service gracefully. Stops all services, frees allocated resources,
   * and cleans up OpenTelemetry metrics.
   *
   * @returns Promise that resolves when shutdown is complete.
   */
  private async _shutdown(): Promise<boolean> {
    await this._stop();
    await this._setSystemChannel(false);
    await this._stopReportSchedule();
    await this._stopManagerTask();
    await this._releaseResources();
    this.logger.info(`${this._parent.getIdentity()} shutdown complete.`);
    return true;
  }

  /**
   * Starts this service provider.
   *
   * @returns Promise that resolves when the provider started.
   */
  private async _start(): Promise<boolean> {
    const acceptStates = [
      ExecutionState.Error,
      ExecutionState.Initializing,
      ExecutionState.Retrying,
      ExecutionState.Stopped,
    ];
    if (!(this._parent && acceptStates.includes(this._parent.getState())))
      return false;

    if (!this._parent["_initialized"]) {
      await this._parent["_initializeResources"]();
      await this._setSystemChannel(true);
    }
    await this._discoverServiceManager();
    this._parent["setState"](ExecutionState.Starting);

    this.logger.debug(`Starting the service in subclass ...`);
    await this._parent["starting"]();
    this.logger.debug(`${FOLLOW_UP}Service started in subclass.`);

    await this._startReportSchedule();
    this.logger.info(`${this._parent.getIdentity()} started successfully.`);
    this._parent["setState"](ExecutionState.Running);
    return true;
  }

  /**
   * Stops this service provider but leaves the system instruction channel active for
   * accepting life cycle instructions from service manager.
   *
   * @returns Promise that resolves when all services have stopped.
   */
  private async _stop(): Promise<boolean> {
    const acceptStates = [ExecutionState.Running];
    if (!(this._parent && acceptStates.includes(this._parent.getState())))
      return false;

    this.logger.info(`Stopping the ${this._parent.getIdentity()} service ...`);
    this._parent["setState"](ExecutionState.Stopping);

    this.logger.debug(`Stopping the service in subclass ...`);
    await this._parent["stopping"]();
    this.logger.debug(`${FOLLOW_UP}Service stopped in subclass.`);

    const { tasks } = this.context as LifeCycleContext;
    const wait: Promise<void>[] = [];
    for (const name of tasks.keys()) {
      // Leave the ServiceManager task running.
      if (name === ProviderTask.Manager) continue;

      const promise = this._stopTask(name);
      if (promise) wait.push(promise);
    }
    await Promise.all(wait);

    this.logger.info(`${this._parent.getIdentity()} stopped.`);
    this._parent["setState"](ExecutionState.Stopped);
    await this._report();
    return true;
  }

  // --------------------------------------------
  // Private Utility Methods
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
    Object.assign(this._manager, {
      // Reset service manager information.
      managerInfo: [],
      manager: null,
      instance: null,
    });

    const { idGenerator, tasks } = this.context as LifeCycleContext;
    if (tasks.has(ProviderTask.Manager)) {
      const smTask = tasks.get(ProviderTask.Manager);
      smTask.stop();
      tasks.delete(ProviderTask.Manager);
    }

    // Lazy initialization of the procedure.
    const { DiscoverProcedure } = await import("../procedure");
    const procedure = new DiscoverProcedure(this.configManager);
    this._procedure.discovery = procedure;

    // Context for execute the procedure.
    const context: ProcedureContext = {
      taskName: ProviderTask.Manager,
      tasks: tasks,
      idGenerator: idGenerator,
    };

    // Repeat executing the procedure until it success.
    let result: ManagerInfo | undefined = undefined;
    while (!result) {
      result = await procedure.execute(context);
      if (result?.manager) {
        Object.assign(this._manager, {
          // Replace service manager information.
          managerInfo: result.managerInfo,
          manager: result.manager,
          instance: result.instance,
        });
        tasks.set(ProviderTask.Manager, result.instance);
        this._events.emit(ServiceEvent.ManagerConnected, this._parent);
        delete this._procedure.discovery;
        break;
      }
    }
  }

  /**
   * Excute the system instruction.
   *
   * @param operation Name of the instruction for execute.
   * @returns
   */
  private async _doSysInstruction(
    operation: LifeCycleOperation,
  ): Promise<boolean> {
    const methodName = ("_" + operation) as keyof LifeCycleProcedure;
    const instFunc = this[methodName] as (() => Promise<boolean>) | undefined;
    if (typeof instFunc !== "function") {
      this.logger.warn(`Invalid system instruction: <${operation}>.`);
      return false;
    }
    return await instFunc.call(this);
  }

  /**
   * Handles incoming system instruction from TCP channel.
   * Parses JSON, executes the instruction, and sends response back.
   * The response is sent back to the same channel.
   *
   * @param peer - NetworkPeer of the request.
   * @param data - Raw string or Buffer data from TCP
   */
  private _handleTcpSysRequest = async ({
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

    let apiSpec!: ApiSpec;
    let errType: AckValue = AckValue.None;
    let json!: ApiCall;
    let result: any;
    const message = data instanceof Buffer ? data.toString() : (data as string);
    const pmsJob: Promise<any>[] = [];
    try {
      // 1. Parse the request.
      json = JSON.parse(message);
      const parsed = this._parent["_parseRequest"](json);
      if (!parsed) {
        return;
      }
      apiSpec = parsed.apiSpec;

      // 2. Perform the requested instruction.
      result = [
        await this._doSysInstruction(parsed.apiName! as LifeCycleOperation),
        peer.socket,
      ];
    } catch (err) {
      errType = this._parent["_handleRequestError"](
        err as Error,
        message,
        json?.api,
      );
    } finally {
      this._parent["_updateApiCouynter"](errType, json);
      if (result.length > 1) {
        const respArgs: ResponseArgs = {
          apiSpec: apiSpec,
          data: result[0],
          errType: errType,
          request: json,
          target: result[1],
        };

        // Response the instruction execution result.
        await this._parent["response"](respArgs);
      }
    }
  };

  /**
   * Releases all allocated resources including response channels and OpenTelemetry.
   * Calls subclass releasingResources hook.
   */
  private async _releaseResources(): Promise<void> {
    this.logger.debug(`Cleanup ${this._parent.getIdentity()} ...`);

    this.logger.debug(`Releasing resources allocated in subclass ...`);
    await this._parent["releasingResources"](); // Release resources on subclass.
    this.logger.debug(`${FOLLOW_UP}Subclass resources released.`);

    const release: Promise<void>[] = [];
    release.push(this._parent["_releaseResponseChannels"]()); // Close and release response channels.
    release.push(this._parent["_releaseOtel"]());
    await Promise.all(release);

    this._parent["_initialized"] = false;
    this.logger.debug(`${this._parent.getIdentity()} released.`);
  }

  /**
   * Sets up the system instruction channel TCP server for handling incoming
   * service life-cycle instructions (ex: reload, restart, stop, shutdown, ...).
   *
   * @param subscribe - Whether to subscribe to data events
   * @returns The initialized TCP server
   */
  private async _setSystemChannel(subscribe: boolean): Promise<TcpServer> {
    const task: TcpServer = await this._parent["getTcpServer"](
      ProviderTask.ChannelSys,
    );
    if (subscribe) task.on(NetworkEvent.Data, this._handleTcpSysRequest);
    else task.off(NetworkEvent.Data, this._handleTcpSysRequest);
    return task;
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

    const { tasks } = this.context as LifeCycleContext;
    const smTask = tasks.get(ProviderTask.Manager);
    if (!(smTask instanceof TcpClient)) {
      this.logger.info("No ServiceManager found for report.");
      return;
    }

    // Schedule periodic reports
    const interval = reportConfig?.interval ?? 60 * SECOND;
    this._reportTimer = setInterval(async () => {
      await this._report();
    }, interval);

    this.logger.info(
      `Automatic reporting started for reporting every ${interval / SECOND} second(s) ...`,
    );
  }

  /**
   * Stops the ServiceManager task if it exists.
   */
  private async _stopManagerTask(): Promise<void> {
    const { tasks } = this.context as LifeCycleContext;
    if (tasks.has(ProviderTask.Manager)) {
      await this._stopTask(ProviderTask.Manager);
    }
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
   * Stops a task by name and removes it from the tasks map.
   *
   * @param taskName - The name of the task to stop
   * @returns Promise that resolves when the task is stopped
   */
  private async _stopTask(taskName: string): Promise<void> {
    const { tasks } = this.context as LifeCycleContext;
    const task = tasks.get(taskName);
    if (!task || typeof task.stop !== "function") return;

    const promise: Promise<void> = task
      .stop()
      .then(() => {
        this.logger.debug(
          `${FOLLOW_UP}<${taskName}> task stopped successfully.`,
        );
        tasks.delete(taskName);
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
}
