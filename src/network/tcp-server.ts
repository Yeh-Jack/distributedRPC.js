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
import {
  activeConnections,
  bytesCounter,
  tcpConnectionDuration,
  tcpConnectionsFailed,
  tcpDataTransferSize,
} from "../metrics/otel-metrics";
import {
  NetworkEvent,
  NetworkEventMap,
  NetworkPeer,
  NetworkProtocol,
  NetworkRetryable,
} from "./network-events";
import { OtelTracing, generateCorrelationId } from "../metrics/otel-tracing";

/**
 * This class provides a robust, event-driven TCP server implementation specifically designed
 * for distributed RPC systems. It handles incoming client connections, manages connection
 * lifecycle, and integrates with OpenTelemetry for comprehensive observability.
 *
 * Key Features:
 * - Automatic retry with exponential backoff on bind failures
 * - Comprehensive connection tracking and metrics collection
 * - Graceful shutdown with proper socket cleanup
 * - Distributed tracing with correlation ID propagation
 * - OpenTelemetry metrics for network operations
 * - Event-driven architecture using TypedEventEmitter
 *
 * @remarks
 * This server is designed to be used within an InversifyJS IoC container and automatically
 * integrates with the application's configuration and logging systems. It emits typed events
 * for all significant state changes and network operations.
 *
 * @example
 * ```typescript
 * // Using IoC container
 * const tcpServer = container.get<TcpServer>(TYPES.TcpServer);
 *
 * // Listen for server events
 * tcpServer.on(NetworkEvent.Listening, () => {
 *   console.log("Server listening on port", tcpServer.getPort());
 * });
 *
 * tcpServer.on(NetworkEvent.Connection, ({ peer }) => {
 *   console.log("New connection from", peer.address);
 * });
 *
 * tcpServer.on(NetworkEvent.Data, ({ peer, data }) => {
 *   // Handle incoming RPC data
 * });
 *
 * await tcpServer.start();
 * ```
 */
@injectable()
export class TcpServer extends TypedEventEmitter<NetworkEventMap> {
  public readonly name: string;

  private _configManager: ConfigManager;
  private _logger: ReturnType<LoggerManager["getLogger"]>;

  private _abortController!: AbortController;
  private _retryScheduler!: RetryScheduler;
  private _server: Server | undefined = undefined;

  private _state: ServerState = ServerState.Stopped;
  private _address!: string;
  private _port!: number;

  private _sockets: Set<TcpSocket> = new Set();

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
    this._configManager = configManager;
    this._logger = loggerManager.getLogger();
    this.name = name;

    // Prevent process crash if 'error' is emitted and no one is listening
    this.on(ServerState.Error, (err) => {
      this._logger.error(
        `${this._getArrowedName()} Internal TCP Error: ${err.error?.message || err.error}`,
      );
    });
  }

  // -------------------------------
  // Public API
  // -------------------------------

  /**
   * Returns the port the server is listening on.
   *
   * @returns The port number (dynamically assigned if configured port is 0).
   */
  public getPort(): number {
    return this._port;
  }

  /**
   * Get the listening TCP server.
   * @returns Server
   */
  public getServer(): Server | undefined {
    return this._server;
  }

  /**
   * Returns the current server state.
   *
   * @returns The current ServerState (Stopped, Starting, Running, Listening, etc.).
   */
  public getState(): ServerState {
    return this._state;
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
    if (this._state !== ServerState.Stopped) return;

    const config = this._configManager.getCoreConfig();
    this._address = config.net.tcp_address;
    this._port = config.net.tcp_port; // Default to 0.
    this._abortController = new AbortController();

    this._retryScheduler = new RetryScheduler(() => this._attemptListen(), {
      interval: config.retry.interval,
      max_try: config.retry.max_try,
      backoff: config.retry.backoff,
      signal: this._abortController.signal,
      onRetry: (ctx) => {
        this._setState(ServerState.Retrying);
        this._logger.warn(`Retry attempt #${ctx.attempt}.`);
      },
      onExhausted: (ctx) => {
        this._setState(ServerState.Error);
        this._logger.error(`Retry exhausted after ${ctx.attempt} attempts.`);
      },
      onError: (err) => {
        this._logger.error(`Retry schedule error: ${err}`);
      },
    });

    this._setState(ServerState.Starting);

    this._logger.debug(
      `Initializing ${this._getArrowedName()} TCP listener on ${this._address}:${this._port}`,
    );

    try {
      // Use RetryScheduler.run() as the main retry loop
      await this._retryScheduler.run();
    } catch (err) {
      if (isAbortError(err)) {
        // Cancellation is not a failure.
        this._setState(ServerState.Stopped);
        this._logger.warn(
          `The ${this._getArrowedName()} TCP server start aborted.`,
        );
        return;
      }
      this._setState(ServerState.Error);
      throw err;
    }
  }

  /**
   * Stops the TCP server and closes all active connections.
   *
   * @returns Promise that resolves when the server has stopped.
   */
  public async stop(): Promise<void> {
    if (this._state === ServerState.Stopped) return;

    this._logger.info(`Stopping the ${this._getArrowedName()} TCP server ...`);
    this._setState(ServerState.Stopped);

    this._abortController.abort();
    this._retryScheduler?.stop();

    // Close the server (stops accepting NEW connections)
    const closeServerPromise = new Promise<void>((resolve) => {
      if (!this._server) return resolve();
      this._server.close((err) => {
        if (err) {
          // It's common for close() to error if the server was not open
          // We log it but resolve anyway to ensure shutdown continues.
          this._logger.warn(
            `${this._getArrowedName()} TCP server close error (ignoring)`,
            { error: err },
          );
        }
        resolve();
      });
    });

    // Forcefully destroy all ACTIVE connections.
    // Without this, server.close() waits for clients to disconnect manually
    if (this._sockets.size > 0) {
      this._logger.info(
        `Destroying ${this._sockets.size} active connections ...`,
      );
      for (const socket of this._sockets) {
        if (!socket.destroyed) {
          socket.destroy(); // Sends FIN, cleans up immediately
        }
      }
      this._sockets.clear();
    }

    await closeServerPromise;
    this._logger.info(`The ${this._getArrowedName()} TCP Server stopped.`);
  }

  // --------------------------------------------
  // Protected Methods
  // --------------------------------------------

  /**
   * Handles incoming data (Runtime logic).
   * Primaryly for subclass override to customize the incoming data handling behaviors.
   * Other classes which instantiate this class should attach their message processor
   * to the emitted `NetworkEvent.Data` event from this instance.
   * Note: This is attached via .on(), so it persists after the Promise resolves.
   */
  protected handleData(
    peer: NetworkPeer,
    data: string,
    connectionInfo: any,
  ): void {
    bytesCounter.add(data.length, connectionInfo);
    this.emit(NetworkEvent.Data, { peer, data });
  }

  // --------------------------------------------
  // Private Methods
  // --------------------------------------------

  private async _attemptListen(): Promise<void> {
    if (this._state === ServerState.Stopped) {
      throw new DOMException("Aborted", "AbortError");
    }

    return new Promise<void>((resolve, reject) => {
      try {
        this._server = createServer((socket) => this._handleConnection(socket));

        const cleanup = () => {
          this._server?.off(NetworkEvent.Listening, onListening);
          this._server?.off(NetworkEvent.Error, onError);
          this._server?.off(NetworkEvent.Close, onClose);
        };

        const onListening = () => {
          cleanup();

          // Update port if ephemeral (listen port is 0).
          const addr = this._server!.address();
          if (addr && typeof addr === "object") {
            this._port = addr.port;
          }

          this._setState(ServerState.Listening);
          this._retryScheduler.reset(); // reset attempts after success
          this._logger.info(
            `The ${this._getArrowedName()} TCP server listening on ${this._address}:${this._port}`,
          );
          this.emit(NetworkEvent.Listening);
          resolve();
        };

        const onError = (err: NodeJS.ErrnoException) => {
          cleanup();
          this._server?.close();

          if (NetworkRetryable.has(err.code ?? "")) {
            reject(err); // Reject triggers retry loop, the RetryScheduler.run() will retry.
          } else {
            this._setState(ServerState.Error);
            this.emit(NetworkEvent.Error, {
              error: err,
              peer: undefined as any,
            });
            reject(err); // Fatal, do not retry.
          }
        };

        const onClose = () => {
          cleanup();
          if (this._state !== ServerState.Stopped) {
            this._logger.warn(
              `The ${this._getArrowedName()} TCP server closed unexpectedly, retrying ...`,
            );
            reject(
              new Error(
                `The ${this._getArrowedName()} TCP server closed unexpectedly.`,
              ),
            );
          }
        };

        this._server.once(NetworkEvent.Listening, onListening);
        this._server.once(NetworkEvent.Error, onError);
        this._server.once(NetworkEvent.Close, onClose);

        this._server.listen(this._port, this._address);
      } catch (err) {
        this._setState(ServerState.Error);
        reject(err);
      }
    });
  }

  /**
   * Returns the name with "<>" of this listener.
   * Primary for logging and metric tagging.
   */
  private _getArrowedName(): string {
    return `<${this.name}>`;
  }

  private _handleConnection(socket: TcpSocket): void {
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

    // Generate correlation ID for this connection
    const correlationId = generateCorrelationId();
    const connectionStartTime = Date.now();

    // Create distributed tracing span for TCP connection
    const connectionSpan = OtelTracing.createNetworkSpan("accept", "tcp", {
      address,
      port,
      direction: "inbound",
      attributes: {
        "correlation.id": correlationId,
        "network.connection.id": `tcp_${connectionStartTime}_${Math.random().toString(36).slice(2, 8)}`,
        "network.peer.address": address,
        "network.peer.port": port,
      },
    });

    this._sockets.add(socket); // Tracking the socket.
    activeConnections.add(1, connectionInfo); // Update connection metrics for OpenTelemetry.

    this.emit(NetworkEvent.Connection, { peer });

    // Handle data reception with tracing
    socket.on(NetworkEvent.Data, (data) => {
      if (data.length > 0) {
        // Record data transfer metrics
        tcpDataTransferSize.record(data.length, {
          transfer_type: "request",
          direction: "received",
          correlation_id: correlationId,
        });

        // Create span for data handling
        const dataHandlingSpan = OtelTracing.createNetworkSpan(
          "handle_data",
          "tcp",
          {
            address,
            port,
            direction: "inbound",
            attributes: {
              "correlation.id": correlationId,
              "network.data.size": data.length,
              "network.event": "data_received",
            },
          },
        );

        try {
          // Call Function.apply() to force 'this' scope.
          this.handleData.apply(this, [peer, data.toString(), connectionInfo]);
          dataHandlingSpan.setStatus({ code: 1 }); // OK
        } catch (error) {
          OtelTracing.recordException(dataHandlingSpan, error as Error);
          dataHandlingSpan.setStatus({
            code: 2, // ERROR
            message: (error as Error).message,
          });
          throw error;
        } finally {
          dataHandlingSpan.end();
        }
      }
    });

    // Handle connection closure with metrics
    socket.on(NetworkEvent.Close, (hadError) => {
      const connectionDuration = Date.now() - connectionStartTime;

      // Record connection duration metrics
      tcpConnectionDuration.record(connectionDuration, {
        correlation_id: correlationId,
        had_error: hadError,
      });

      activeConnections.add(-1, connectionInfo);

      if (hadError) {
        // Record failed connection metrics
        tcpConnectionsFailed.add(1, {
          error_type: "connection_closed_with_error",
          peer_address: address,
          correlation_id: correlationId,
        });

        connectionSpan.setStatus({
          code: 2, // ERROR
          message: "Connection closed with error",
        });
      } else {
        connectionSpan.setStatus({
          code: 1, // OK
        });
      }

      this.emit(NetworkEvent.Close, { peer, hadError });
      this._sockets.delete(socket); // Remove from tracking on close.

      // End the connection span
      connectionSpan.end();
    });

    // Handle socket errors
    socket.on(NetworkEvent.Error, (err) => {
      // Cast to NodeJS.ErrnoException to access the code property safely
      const nodeError = err as NodeJS.ErrnoException;

      // Record failed connection metrics
      tcpConnectionsFailed.add(1, {
        error_type: nodeError.code || "unknown_error",
        peer_address: address,
        correlation_id: correlationId,
      });

      OtelTracing.recordException(connectionSpan, err, {
        "error.code": nodeError.code,
        "error.message": err.message,
      });

      connectionSpan.setStatus({
        code: 2, // ERROR
        message: err.message,
      });

      this.emit(NetworkEvent.Error, { error: err, peer });

      // Defensive: ensure the socket is destroyed on error to prevent leaks.
      if (!socket.destroyed) {
        socket.destroy();
      }

      // End the connection span on error
      connectionSpan.end();
    });
  }

  private _setState(state: ServerState): void {
    if (this._state !== state) {
      this._logger.info(
        `${this._getArrowedName()} ${this._port}/TCP state: ${this._state} → ${state}`,
      );
      this._state = state;
    }
  }
}
