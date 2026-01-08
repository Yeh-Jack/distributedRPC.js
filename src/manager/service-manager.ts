import { Logger } from "winston";
import { TcpServer } from "../network/tcp-server";
import { UdpServer } from "../network/udp-server";
import { ConfigManager } from "../common/config";
import { LoggerManager } from "../common/logger";

export class ServiceManager {
  protected readonly SERVICE_NAME!: string;
  private services: Map<string, any> = new Map();
  private configManager: ConfigManager;
  private logger: Logger;

  constructor() {
    this.SERVICE_NAME = this.constructor.name;
    this.configManager = ConfigManager.getInstance(this.SERVICE_NAME);
    this.logger = LoggerManager.getInstance().getLogger();
  }

  public async reload(): Promise<void> {
    if (this.configManager) {
      await this.stop();

      this.configManager.reload();
      LoggerManager.getInstance().reload();
      this.logger = LoggerManager.getInstance().getLogger();

      await this.initialize();
    }
  }

  public async initialize(): Promise<void> {
    this.logger.info(`Initializing ${this.SERVICE_NAME} ...`);

    // Initialize all services including TCP and UDP listeners
    await this.initializeTcpListener("register");
    await this.initializeUdpListener("reception");

    this.logger.info(`${this.SERVICE_NAME} initialized successfully.`);
  }

  private async initializeTcpListener(name: string): Promise<void> {
    try {
      const tcpServer = new TcpServer(name);
      await tcpServer.start();
      this.services.set(name, tcpServer);

      this.logger.info(
        `TCP listener "${name}" registered and started successfully.`
      );
    } catch (error) {
      this.logger.error(
        `Failed to initialize TCP listener "${name}": ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      throw error;
    }
  }

  private async initializeUdpListener(name: string): Promise<void> {
    try {
      const udpServer = new UdpServer(name);
      await udpServer.start();
      this.services.set(name, udpServer);

      this.logger.info(
        `UDP listener "${name}" registered and started successfully.`
      );
    } catch (error) {
      this.logger.error(
        `Failed to initialize UDP listener "${name}": ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      throw error;
    }
  }

  public async stop(): Promise<void> {
    this.logger.info("Stopping all services...");

    // Stop all services
    for (const [name, service] of this.services.entries()) {
      try {
        if (typeof service.stop === "function") {
          await service.stop();
          this.logger.info(`Service "${name}" stopped successfully.`);
        }
      } catch (error) {
        this.logger.error(
          `Failed to stop service "${name}": ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    }

    this.logger.info("All services stopped.");
  }

  public getTcpServer(name: string): TcpServer | undefined {
    return this.services.get(name) as TcpServer;
  }

  public getUdpServer(name: string): UdpServer | undefined {
    return this.services.get(name) as UdpServer;
  }
}
