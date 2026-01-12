import { Logger } from "winston";
import { injectable } from "inversify";

import { ConfigManager } from "../common/config";
import { LoggerManager } from "../common/logger";
import { listenerState } from "../metrics/otel-metrics";
import { TcpServer } from "../network/tcp-server";
import { UdpServer } from "../network/udp-server";
import { ServerState } from "../network/network-events";

@injectable()
export class ServiceManager {
  protected readonly SERVICE_NAME!: string;
  private services: Map<string, any> = new Map();
  private state: ServerState = ServerState.Stopped;
  private configManager: ConfigManager;
  private logger: Logger;

  constructor() {
    this.SERVICE_NAME = this.constructor.name;
    this.configManager = ConfigManager.getInstance(this.SERVICE_NAME);
    this.logger = LoggerManager.getInstance().getLogger();
  }

  public async initialize(): Promise<void> {
    this.logger.info(`Initializing ${this.SERVICE_NAME} ...`);
    this.setState(ServerState.Starting);

    // Initialize all services including TCP and UDP listeners in parallel.
    await Promise.all([
      this.initializeTcpListener("register"),
      this.initializeUdpListener("reception"),
    ]);

    this.logger.info(`${this.SERVICE_NAME} initialized successfully.`);
    this.setState(ServerState.Running);
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

  public async stop(): Promise<void> {
    this.logger.info("Stopping all services...");
    this.setState(ServerState.Stopping);

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
    this.setState(ServerState.Stopped);
  }

  public getServiceName(): string {
    return this.configManager.getCoreConfig().service_name;
  }

  public getTcpServer(name: string): TcpServer | undefined {
    return this.services.get(name) as TcpServer;
  }

  public getUdpServer(name: string): UdpServer | undefined {
    return this.services.get(name) as UdpServer;
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

  private setState(state: ServerState) {
    if (this.state !== state) {
      // Update server state metric for OpenTelemetry.
      // ObservableGauge is an async instrument and cannot be updated directly; store the latest
      // state on the gauge object for the observable callback to report.
      (listenerState as any).latestState = state;
      this.logger.info(
        `${this.SERVICE_NAME} server state: ${this.state} → ${state}.`
      );
      this.state = state;
    }
  }
}
