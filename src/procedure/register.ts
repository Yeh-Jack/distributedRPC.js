import { inject, injectable } from "inversify";

import { Procedure, ProcedureContext } from "./procedure";
import { TYPES } from "../aop/container";
import { ConfigManager } from "../common/config";
import {
  AccessPoint,
  AckType,
  ApiCall,
  ApiSpec,
  RegisterInfo,
  FOLLOW_UP,
  BasalProtocol,
} from "../types/basal-protocol";
import { TcpClient } from "../network/tcp-client";

export const EVENT_PVD_REGISTERED = "pvd_registered";

/**
 * Interface containing the ServiceManager's API specifications for registration.
 */
export interface RegisterManagerInfo {
  apis: {
    register: ApiSpec;
  };
}

/**
 * Context required for the register procedure execution.
 */
export interface RegisterContext extends ProcedureContext {
  manager: { manager: RegisterManagerInfo };
  protocol: BasalProtocol;
  smTaskName: string;

  // Methods binding from the parent instance.
  ask: (
    helper: TcpClient,
    message: ApiCall,
    ackType: AckType,
  ) => Promise<{ msgId: string; promise?: Promise<any> }>;
  buildMessage: (apiPath: string, args?: any, msgId?: string) => ApiCall;
  getTcpTaskInfo: (taskName: string) => AccessPoint;
}

/**
 * Procedure for registering a service provider to the ServiceManager.
 *
 * This procedure:
 * 1. Checks if already registering or if ServiceManager task exists
 * 2. Builds registration information with protocol and access point details
 * 3. Sends registration request to ServiceManager
 * 4. Handles response and logs results
 */
@injectable()
export class RegisterProcedure extends Procedure {
  /**
   * Creates a RegisterServiceManagerProcedure instance.
   * @param configManager - The configuration manager
   */
  constructor(@inject(TYPES.ConfigManager) configManager: ConfigManager) {
    super(configManager);
  }

  /**
   * Registers the service provider to the ServiceManager.
   *
   * @param context - Execution context with dependencies
   * @returns Promise resolving to true if registration succeeded, false otherwise
   */
  public override async execute(context?: RegisterContext): Promise<boolean> {
    // Initiate variables.
    if (context) this.context = context;
    if (!this.context) return false;
    const {
      taskName,
      tasks,

      manager,
      protocol,
      smTaskName,

      ask,
      buildMessage,
      getTcpTaskInfo,
    } = this.context as RegisterContext;

    // Check preconditions
    const smTask = tasks.get(smTaskName);
    if (!(smTask instanceof TcpClient)) {
      return false;
    }
    this.logger.info("Registering this provider to the service manager ...");

    try {
      const ackType = manager.manager.apis.register.ack;
      const ap: AccessPoint = getTcpTaskInfo(taskName);
      const regInfo: RegisterInfo = {
        ...protocol,
        provider: {
          ...protocol.provider,
          ...ap,
        },
      };

      const apiData: ApiCall = buildMessage("register", regInfo);
      this.logger.silly(
        `Register information:\n${JSON.stringify(apiData, undefined, 2)}`,
      );

      const { msgId, promise } = await ask(smTask, apiData, ackType);
      if (promise) {
        return promise
          .then(
            async ({
              response,
              request,
            }: {
              response: Buffer;
              request: ApiCall;
            }) => {
              const ack: string = response ? response.toString() : "";
              this.logger.info(
                `${FOLLOW_UP}Register to the service manager: <${ack}>.`,
              );

              smTask.emit(EVENT_PVD_REGISTERED, { msgId, ack });
              return true;
            },
          )
          .catch(({ err, request }: { err: Buffer; request: ApiCall }) => {
            this.logger.warn(
              `${FOLLOW_UP}Error on <register:${msgId}>: ${err.toString()}`,
            );
            return false;
          });
      }
      return false;
    } catch (err) {
      this.logger.warn(
        `${FOLLOW_UP}Registration failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
      return false;
    }
  }
}
