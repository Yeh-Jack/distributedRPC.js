/**
 * TCP server implementation for distributed RPC communication.
 * @module tcp-server
 */

import { createServer, Server, Socket as TcpSocket } from "net";
import { inject, injectable } from "inversify";

import { isAbortError } from "../common/abort-aware";
import { ConfigManager } from "../common/config";
import { LoggerManager } from "../common/logger";
import { RetryScheduler } from "../common/retry";
import { ServerState } from "../types/basal-protocol";
import { TYPES } from "../aop/di-types";
import { TypedEventEmitter } from "./typed-event-emitter";
import { activeConnections, bytesCounter } from "../metrics/otel-metrics";
import {
  NetworkEvent,
  NetworkEventMap,
  NetworkPeer,
  NetworkProtocol,
  NetworkRetryable,
} from "./network-events";

/**
 * TCP server for handling incoming client connections.
 *
 * Features:
 * - Automatic retry with configurable backoff on bind failures
 * - Connection tracking and metrics
 * - Graceful shutdown with socket cleanup
 * - Event-driven architecture using TypedEventEmitter
 *
 * @example
 * ```typescript
 * // Using IoC container
 * const tcpServer = container.get<TcpServer>(TYPES.TcpServer);
 * tcpServer.on(NetworkEvent.Listening, () => {
 *   console.log("Server listening on port", tcpServer.getPort());
 * });
 * await tcpServer.start();
 * ```
 */
@injectable()
export class TcpServer extends TypedEventEmitter<NetworkEventMap> {
  public readonly name: string;

  private configManager: ConfigManager;
  private logger: ReturnType<LoggerManager["getLogger"]>;

  private abortController!: AbortController;
  private retryScheduler!: RetryScheduler;
  private server: Server | null = null;

  private state: ServerState = ServerState.Stopped;
  private address!: string;
  private port!: number;

  private sockets: Set<TcpSocket> = new Set();

  /**
   * Creates a new TCP server instance.
   *
   * @param configManager - The configuration manager for retrieving service settings.
   * @param loggerManager - The logger manager for obtaining the application logger.
   * @param name - Optional name to identify this server instance.
   */
  constructor(
    @inject(TYPES.ConfigManager) configManager: ConfigManager,
    @inject(TYPES.LoggerManager) loggerManager: LoggerManager,
    name: string = "tcp-server",
  ) {
    super();
    this.configManager = configManager;
    this.logger = loggerManager.getLogger();
    this.name = name;

    // Prevent process crash if 'error' is emitted and no one is listening
    this.on(ServerState.Error, (err) => {
      this.logger.error(
        `${this.getNameArrow()} Internal TCP Error: ${err.error?.message || err.error}`,
      );
    });
  }

  // -------------------------------
  // Public API
  // -------------------------------

  /**
   * Returns the current server state.
   *
   * @returns The current ServerState (Stopped, Starting, Running, Listening, etc.).
   */
  public getState(): ServerState {
    return this.state;
  }

  /**
   * Returns the port the server is listening on.
   *
   * @returns The port number (dynamically assigned if configured port is 0).
   */
  public getPort(): number {
    return this.port;
  }

  /**
   * Starts the TCP server and begins accepting connections.
   * Uses RetryScheduler for automatic retry on bind failures.
   *
   * @returns Promise that resolves when server is listening.
   * @throws Error if server fails to start after max retries.
   * @example
   * ```typescript
   * try {
   *   await tcpServer.start();
   *   console.log("Server started on port", tcpServer.getPort());
   * } catch (err) {
   *   console.error("Failed to start server:", err);
   * }
   * ```
   */
  public async start(): Promise<void> {
    if (this.state !== ServerState.Stopped) return;

    const config = this.configManager.getCoreConfig();
    this.address = config.tcp_address;
    this.port = config.tcp_port; // Default to 0.
    this.abortController = new AbortController();

    this.retryScheduler = new RetryScheduler(() => this.attemptListen(), {
      intervalMs: config.retry_interval,
      maxRetries: config.retry_max,
      signal: this.abortController.signal,
      onRetry: (ctx) => {
        this.setState(ServerState.Retrying);
        this.logger.warn(`Retry attempt #${ctx.attempt}.`);
      },
      onExhausted: (ctx) => {
        this.setState(ServerState.Error);
        this.logger.error(`Retry exhausted after ${ctx.attempt} attempts.`);
      },
      onError: (err) => {
        this.logger.error(`Retry schedule error: ${err}`);
      },
    });

    this.setState(ServerState.Starting);

    this.logger.debug(
      `Initializing ${this.getNameArrow()} TCP listener on ${this.address}:${this.port}`,
    );

    try {
      // Use RetryScheduler.run() as the main retry loop
      await this.retryScheduler.run();
    } catch (err) {
      if (isAbortError(err)) {
        // Cancellation is not a failure.
        this.setState(ServerState.Stopped);
        this.logger.warn(
          `The ${this.getNameArrow()} TCP server start aborted.`,
        );
        return;
      }
      this.setState(ServerState.Error);
      throw err;
    }
  }

  /**
   * Stops the TCP server and closes all active connections.
   *
   * @returns Promise that resolves when the server has stopped.
   */
  public async stop(): Promise<void> {
    if (this.state === ServerState.Stopped) return;

    this.logger.info(`Stopping the ${this.getNameArrow()} TCP server ...`);
    this.setState(ServerState.Stopped);

    this.abortController.abort();
    this.retryScheduler?.stop();

    // Close the server (stops accepting NEW connections)
    const closeServerPromise = new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close((err) => {
        if (err) {
          // It's common for close() to error if the server was not open
          // We log it but resolve anyway to ensure shutdown continues.
          this.logger.warn(
            `${this.getNameArrow()} TCP server close error (ignoring)`,
            { error: err },
          );
        }
        resolve();
      });
    });

    // Forcefully destroy all ACTIVE connections.
    // Without this, server.close() waits for clients to disconnect manually
    if (this.sockets.size > 0) {
      this.logger.info(
        `Destroying ${this.sockets.size} active connections ...`,
      );
      for (const socket of this.sockets) {
        if (!socket.destroyed) {
          socket.destroy(); // Sends FIN, cleans up immediately
        }
      }
      this.sockets.clear();
    }

    await closeServerPromise;
    this.logger.info(`The ${this.getNameArrow()} TCP Server stopped.`);
  }

  // -------------------------------
  // Single attempt to listen
  // -------------------------------

  private async attemptListen(): Promise<void> {
    if (this.state === ServerState.Stopped) {
      throw new DOMException("Aborted", "AbortError");
    }

    return new Promise<void>((resolve, reject) => {
      try {
        this.server = createServer((socket) => this.handleConnection(socket));

        const cleanup = () => {
          this.server?.off(NetworkEvent.Listening, onListening);
          this.server?.off(NetworkEvent.Error, onError);
          this.server?.off(NetworkEvent.Close, onClose);
        };

        const onListening = () => {
          cleanup();

          // Update port if ephemeral (listen port is 0).
          const addr = this.server!.address();
          if (addr && typeof addr === "object") {
            this.port = addr.port;
          }

          this.setState(ServerState.Listening);
          this.retryScheduler.reset(); // reset attempts after success
          this.logger.info(
            `The ${this.getNameArrow()} TCP server listening on ${this.address}:${this.port}`,
          );
          this.emit(NetworkEvent.Listening);
          resolve();
        };

        const onError = (err: NodeJS.ErrnoException) => {
          cleanup();
          this.server?.close();

          if (NetworkRetryable.has(err.code ?? "")) {
            reject(err); // Reject triggers retry loop, the RetryScheduler.run() will retry.
          } else {
            this.setState(ServerState.Error);
            this.emit(NetworkEvent.Error, {
              error: err,
              peer: undefined as any,
            });
            reject(err); // Fatal, do not retry.
          }
        };

        const onClose = () => {
          cleanup();
          if (this.state !== ServerState.Stopped) {
            this.logger.warn(
              `The ${this.getNameArrow()} TCP server closed unexpectedly, retrying ...`,
            );
            reject(
              new Error(
                `The ${this.getNameArrow()} TCP server closed unexpectedly.`,
              ),
            );
          }
        };

        this.server.once(NetworkEvent.Listening, onListening);
        this.server.once(NetworkEvent.Error, onError);
        this.server.once(NetworkEvent.Close, onClose);

        this.server.listen(this.port, this.address);
      } catch (err) {
        this.setState(ServerState.Error);
        reject(err);
      }
    });
  }

  private handleConnection(socket: TcpSocket): void {
    const address = socket.remoteAddress || "";
    const port = socket.remotePort || 0;
    const peer: NetworkPeer = {
      protocol: NetworkProtocol.TCP,
      socket,
      address,
      port,
    };
    const connectionInfo = {
      protocol: NetworkProtocol.TCP,
      "peer.address": address,
      "peer.port": port,
    };

    this.sockets.add(socket); // Tracking the socket.
    activeConnections.add(1, connectionInfo); // Update connection metrics for OpenTelemetry.

    this.emit(NetworkEvent.Connection, { peer });

    socket.on(NetworkEvent.Data, (data) => {
      bytesCounter.add(data.length, connectionInfo);
      this.emit(NetworkEvent.Data, { peer, data });
      socket.write(`Echo: ${data.toString()}`);
    });

    socket.on(NetworkEvent.Close, (hadError) => {
      activeConnections.add(-1, connectionInfo);
      this.emit(NetworkEvent.Close, { peer, hadError });
      this.sockets.delete(socket); // Remove from tracking on close.
    });

    socket.on(NetworkEvent.Error, (err) => {
      this.emit(NetworkEvent.Error, { error: err, peer });

      // Defensive: ensure the socket is destroyed on error to prevent leaks.
      if (!socket.destroyed) {
        socket.destroy();
      }
    });
  }

  /**
   * Returns the name with "<>" of this listener.
   * Primary for logging and metric tagging.
   */
  private getNameArrow(): string {
    return `<${this.name}>`;
  }

  private setState(state: ServerState): void {
    if (this.state !== state) {
      this.logger.info(
        `${this.getNameArrow()} ${this.port}/TCP state: ${this.state} → ${state}`,
      );
      this.state = state;
    }
  }
}
