/**
 * TCP server implementation for distributed RPC communication.
 * @module tcp-server
 */

import { createServer, Server, Socket as TcpSocket } from "net";
import { injectable } from "inversify";

import { isAbortError } from "../common/abort-aware";
import { ConfigManager } from "../common/config";
import { LoggerManager } from "../common/logger";
import { RetryScheduler } from "../common/retry";
import { ExecutionState, NetworkProtocol } from "../types/basal-protocol";
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
  NetworkDirection,
  NetworkEvent,
  NetworkEventMap,
  NetworkPeer,
  NetworkRetryable,
} from "./network-events";
import { generateCorrelationId } from "../metrics/otel-resource";
import { NetworkSpanOptions, OtelTracer } from "../metrics/otel-tracing";

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

  protected configManager: ConfigManager;
  protected logger: ReturnType<LoggerManager["getLogger"]>;

  private _abortController!: AbortController;
  private _retryScheduler!: RetryScheduler;
  private _state: ExecutionState = ExecutionState.Stopped;
  private _server: Server | undefined = undefined;

  private _address!: string;
  private _port: number = 0; // 0 means not initialized yet.

  private _sockets: Set<TcpSocket> = new Set();
  private _txBytes: number = 0; // Track transmitted bytes
  private _rxBytes: number = 0; // Track received bytes

  /**
   * Creates a new TCP server instance.
   *
   * @param configManager - The configuration manager for retrieving service settings.
   * @param name - Optional name to identify this server instance.
   */
  constructor(configManager: ConfigManager, name: string = "tcp-server") {
    super();
    this.configManager = configManager;
    this.logger = configManager.getLogger();
    this.name = name;

    // Prevent process crash if 'error' is emitted and no one is listening
    this.on(ExecutionState.Error, (err) => {
      this.logger.error(
        `${this.getArrowedName()} Internal TCP Error: ${err.error?.message || err.error}`,
      );
    });
  }

  // -------------------------------
  // Public API
  // -------------------------------

  /**
   * Broadcasts data to all connected clients.
   *
   * @param data - The data to broadcast
   * @returns Total bytes written
   */
  public broadcast(data: Buffer | string): number {
    const dataBuffer = typeof data === "string" ? Buffer.from(data) : data;
    let totalWritten = 0;

    for (const socket of this._sockets) {
      if (!socket.destroyed) {
        const written = socket.write(dataBuffer);
        if (written) {
          totalWritten += dataBuffer.length;
        }
      }
    }

    this._txBytes += totalWritten;
    return totalWritten;
  }

  /**
   * Returns the port the server is listening on.
   *
   * @returns The port number (dynamically assigned if configured port is 0).
   */
  public getPort(): number {
    return this._port;
  }

  /**
   * Returns the total bytes received by this server.
   *
   * @returns Total received bytes
   */
  public getRxBytes(): number {
    return this._rxBytes;
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
  public getState(): ExecutionState {
    return this._state;
  }

  /**
   * Returns the total bytes transmitted by this server.
   *
   * @returns Total transmitted bytes
   */
  public getTxBytes(): number {
    return this._txBytes;
  }

  /**
   * Resets the byte counters.
   */
  public resetByteCounters(): void {
    this._txBytes = 0;
    this._rxBytes = 0;
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
    if (this._state !== ExecutionState.Stopped) return;

    const config = this.configManager.getCoreConfig();
    const tcpConfig = config.net.tcp;
    const retryConfig = config.retry;

    this.logger = this.configManager.getLogger(); // Reload the logger.
    this._abortController = new AbortController();
    this._address = tcpConfig.address;

    /*
     * Use configured port only when initializing.
     * Otherwise, use the port previously occupied to keep serving on the same port.
     */
    if (this._port === 0) {
      this._port = tcpConfig.port; // Default to 0.
    }

    this._setState(ExecutionState.Starting);
    this.logger.debug(
      `Initializing ${this.getArrowedName()} TCP listener on ${this._address}:${this._port}`,
    );

    this._retryScheduler = new RetryScheduler(() => this._attemptListen(), {
      interval: retryConfig.interval,
      max_retries: retryConfig.max_retries,
      backoff: retryConfig.backoff,
      signal: this._abortController.signal,
      onRetry: (ctx) => {
        this._setState(ExecutionState.Retrying);
        this.logger.warn(
          `Retry attempt #${ctx.attempt} for ${this.getArrowedName()}.`,
        );
      },
      onExhausted: (ctx) => {
        this._setState(ExecutionState.Halt);
        this.logger.error(
          `Retry exhausted after ${ctx.attempt} attempts for ${this.getArrowedName()}.`,
        );
      },
      onError: (err) => {
        this._setState(ExecutionState.Error);
        this.logger.error(
          `Retry schedule error from ${this.getArrowedName()}: ${err}`,
        );
      },
    });

    try {
      // Use RetryScheduler.run() as the main retry loop
      await this._retryScheduler.run();
    } catch (err) {
      if (isAbortError(err)) {
        // Cancellation is not a failure.
        this._setState(ExecutionState.Stopped);
        this.logger.warn(
          `The ${this.getArrowedName()} TCP server start aborted.`,
        );
        return;
      }
      this._setState(ExecutionState.Error);
      throw err;
    }
  }

  /**
   * Stops the TCP server and closes all active connections.
   *
   * @returns Promise that resolves when the server has stopped.
   */
  public async stop(): Promise<void> {
    if (this._state === ExecutionState.Stopped) return;

    this.logger.info(`Stopping the ${this.getArrowedName()} TCP server ...`);
    this._setState(ExecutionState.Stopped);

    this._abortController.abort();
    this._retryScheduler?.stop();

    // Close the server (stops accepting NEW connections)
    const closeServerPromise = new Promise<void>((resolve) => {
      if (!this._server) return resolve();
      this._server.close((err) => {
        if (err) {
          // It's common for close() to error if the server was not open
          // We log it but resolve anyway to ensure shutdown continues.
          this.logger.warn(
            `${this.getArrowedName()} TCP server close error (ignoring)`,
            { error: err },
          );
        }
        resolve();
      });
    });

    // Forcefully destroy all ACTIVE connections.
    // Without this, server.close() waits for clients to disconnect manually
    if (this._sockets.size > 0) {
      this.logger.info(
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
    this.logger.info(`The ${this.getArrowedName()} TCP Server stopped.`);
  }

  // --------------------------------------------
  // Protected Methods
  // --------------------------------------------

  /**
   * Returns the name with "<>" of this listener.
   * Primary for logging and metric tagging.
   */
  protected getArrowedName(): string {
    return `<${this.name}>`;
  }

  protected handleConnection(socket: TcpSocket): void {
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
    const spanOptions: NetworkSpanOptions = {
      address,
      port,
      protocol: NetworkProtocol.TCP,
      direction: NetworkDirection.Out,
      attributes: {
        "correlation.id": correlationId,
        "network.target": `${address}:${port}`,
      },
    };
    const providerId = this.configManager.getProviderId();
    const tracer = OtelTracer.getInstance(providerId);
    const connectionSpan = tracer.createNetworkSpan("accept", spanOptions);

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
        const spanOptions: NetworkSpanOptions = {
          address,
          port,
          protocol: NetworkProtocol.TCP,
          direction: NetworkDirection.In,
          attributes: {
            "correlation.id": correlationId,
            "network.data.size": data.length,
            "network.event": "data_received",
          },
        };
        const dataHandlingSpan = tracer.createNetworkSpan(
          "handle_data",
          spanOptions,
        );

        try {
          // Call Function.apply() to force 'this' scope.
          this.handleData.apply(this, [peer, data, connectionInfo]);
          dataHandlingSpan.setStatus({ code: 1 }); // OK
        } catch (error) {
          tracer.recordException(dataHandlingSpan, error as Error);
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

      tracer.recordException(connectionSpan, err, {
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

  /**
   * Handles incoming data (Runtime logic).
   * Primaryly for subclass override to customize the incoming data handling behaviors.
   * Other classes which instantiate this class should attach their message processor
   * to the emitted `NetworkEvent.Data` event from this instance.
   * Note: This is attached via .on(), so it persists after the Promise resolves.
   */
  protected handleData(
    peer: NetworkPeer,
    data: string | Buffer,
    connectionInfo: any,
  ): void {
    const dataLength =
      typeof data === "string" ? Buffer.byteLength(data) : data.length;
    this._rxBytes += dataLength;
    bytesCounter.add(dataLength, connectionInfo);
    this.emit(NetworkEvent.Data, { peer, data });
  }

  // --------------------------------------------
  // Private Methods
  // --------------------------------------------

  private async _attemptListen(): Promise<void> {
    if (this._state === ExecutionState.Stopped) {
      throw new DOMException("Aborted", "AbortError");
    }

    return new Promise<void>((resolve, reject) => {
      try {
        this._server = createServer((socket) => this.handleConnection(socket));

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

          this._setState(ExecutionState.Listening);
          this._retryScheduler.reset(); // reset attempts after success
          this.logger.info(
            `The ${this.getArrowedName()} TCP server listening on ${this._address}:${this._port}`,
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
            this._setState(ExecutionState.Error);
            this.emit(NetworkEvent.Error, {
              error: err,
              peer: undefined as any,
            });
            reject(err); // Fatal, do not retry.
          }
        };

        const onClose = () => {
          cleanup();
          if (this._state !== ExecutionState.Stopped) {
            this.logger.warn(
              `The ${this.getArrowedName()} TCP server closed unexpectedly, retrying ...`,
            );
            reject(
              new Error(
                `The ${this.getArrowedName()} TCP server closed unexpectedly.`,
              ),
            );
          }
        };

        this._server.once(NetworkEvent.Listening, onListening);
        this._server.once(NetworkEvent.Error, onError);
        this._server.once(NetworkEvent.Close, onClose);

        this._server.listen(this._port, this._address);
      } catch (err) {
        this._setState(ExecutionState.Error);
        reject(err);
      }
    });
  }

  private _setState(state: ExecutionState): void {
    if (this._state !== state) {
      this.logger.info(
        `${this.getArrowedName()} ${this._port}/TCP state: ${this._state} → ${state}`,
      );
      this._state = state;
    }
  }
}
