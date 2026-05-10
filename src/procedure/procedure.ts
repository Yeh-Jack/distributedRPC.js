import { injectable } from "inversify";
import { createNamedTcpServer } from "../aop/container";
import { ConfigManager } from "../common/config";
import { LoggerManager } from "../common/logger";
import { TcpClient } from "../network/tcp-client";
import { TcpServer } from "../network/tcp-server";
import { ServiceProvider } from "../provider/service-provider";
import { AccessPoint, IdGenerator } from "../types/basal-protocol";

/**
 * Context required for the register procedure execution.
 */
export interface ProcedureContext {
  parent?: ServiceProvider;
  taskName: string;
  tasks: Map<string, any>;
  idGenerator: IdGenerator;
}

/**
 * Base class for all procedures.
 * Provides common dependencies and functionality for procedure execution.
 */
@injectable()
export abstract class Procedure {
  protected configManager!: ConfigManager;
  protected logger!: ReturnType<LoggerManager["getLogger"]>;
  protected context!: ProcedureContext; // Holds shared variables that will be mainipulated in this class from caller.

  /**
   * Creates a Procedure instance.
   * @param configManager - The configuration manager for accessing settings
   */
  constructor(configManager: ConfigManager) {
    this.setConfigManager(configManager);
  }

  /**
   * Start to performing this procedure.
   */
  public async execute(context?: ProcedureContext): Promise<any> {
    if (context) this.context = context;
    const clazName = this.constructor.name;
    throw new Error(`${clazName}.execute() is not implemented.`);
  }

  /**
   * Returns the execution context for this procedure.
   *
   * @returns The ProcedureContext containing shared variables and task information
   */
  public getContext(): ProcedureContext {
    return this.context;
  }

  /**
   * Sets the ConfigManager instance.
   * @param configManager - The new ConfigManager instance
   */
  public setConfigManager(configManager: ConfigManager): void {
    this.configManager = configManager;
    this.logger = configManager.getLogger();
  }

  // --------------------------------------------
  // Protected Methods
  // --------------------------------------------

  /**
   * Utility delay function.
   *
   * @param ms - Milliseconds to delay
   * @returns Promise that resolves after the delay
   */
  protected async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Initializes and starts a TCP client for communicating with a remote endpoint.
   *
   * @param name - Unique name for this client task.
   * @param ap - AccessPoint containing address and port of the remote endpoint.
   * @returns Promise that resolves to the initialized TcpClient.
   */
  protected async getTcpClient(
    name: string,
    ap?: AccessPoint,
  ): Promise<TcpClient> {
    try {
      const { idGenerator, tasks } = this.context;

      let tcpClient: TcpClient = tasks.get(name);
      if (tcpClient) return tcpClient;

      if (!ap) {
        throw new Error("Missing AccessPoint argument.");
      }
      if (!idGenerator) {
        throw new Error("Missing IdGenerator argument.");
      }

      tcpClient = new TcpClient(this.configManager, ap, name, idGenerator);
      tasks.set(name, tcpClient);
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
  protected async getTcpServer(name: string): Promise<TcpServer> {
    try {
      const { tasks } = this.context;
      let tcpServer: TcpServer = tasks.get(name);
      if (tcpServer) return tcpServer;

      tcpServer = createNamedTcpServer(this.configManager, name);
      tasks.set(name, tcpServer);
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
}
