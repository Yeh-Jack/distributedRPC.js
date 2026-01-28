/**
 * UDP server implementation for distributed RPC communication.
 * @module udp-server
 */

import dgram, { Socket as UdpSocket, RemoteInfo } from "dgram";
import { inject, injectable } from "inversify";

import { isAbortError } from "../common/abort-aware";
import { ConfigManager } from "../common/config";
import { LoggerManager } from "../common/logger";
import { RetryScheduler } from "../common/retry";
import { ServerState } from "../types/basal-protocol";
import { TYPES } from "../aop/di-types";
import { TypedEventEmitter } from "./typed-event-emitter";
import { bytesCounter } from "../metrics/otel-metrics";
import {
  NetworkEvent,
  NetworkEventMap,
  NetworkPeer,
  NetworkProtocol,
  NetworkRetryable,
} from "./network-events";

/**
 * UDP server for handling incoming datagram messages.
 *
 * Features:
 * - Automatic retry with configurable backoff on bind failures
 * - Message tracking and metrics
 * - Graceful shutdown
 * - Event-driven architecture using TypedEventEmitter
 *
 * @example
 * ```typescript
 * // Using IoC container
 * const udpServer = container.get<UdpServer>(TYPES.UdpServer);
 * udpServer.on(NetworkEvent.Listening, () => {
 *   console.log("UDP server listening on port", udpServer.getPort());
 * });
 * udpServer.on(NetworkEvent.Message, ({ peer, data }) => {
 *   console.log("Received from", peer.address, ":", data);
 * });
 * await udpServer.start();
 * ```
 */
@injectable()
export class UdpServer extends TypedEventEmitter<NetworkEventMap> {
  public readonly name: string;

  protected configManager: ConfigManager;
  protected logger: ReturnType<LoggerManager["getLogger"]>;

  private loggerManager: LoggerManager;
  private abortController!: AbortController;
  private retryScheduler!: RetryScheduler;
  private state: ServerState = ServerState.Stopped;

  private socket!: UdpSocket | undefined;
  private address!: string;
  private port!: number;

  /**
   * Creates a new UDP server instance.
   *
   * @param configManager - The configuration manager for retrieving service settings.
   * @param loggerManager - The logger manager for obtaining the application logger.
   * @param name - Optional name to identify this server instance.
   */
  constructor(
    @inject(TYPES.ConfigManager) configManager: ConfigManager,
    @inject(TYPES.LoggerManager) loggerManager: LoggerManager,
    name: string = "udp-server",
  ) {
    super();
    this.configManager = configManager;
    this.loggerManager = loggerManager;
    this.logger = loggerManager.getLogger();
    this.name = name;
  }

  // -------------------------------
  // Public API
  // -------------------------------

  /**
   * Get the listening UDP socket.
   * @returns dgram.Socket
   */
  public getSocket(): UdpSocket | undefined {
    return this.socket;
  }

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
   * @returns The port number.
   */
  public getPort(): number {
    return this.port;
  }

  /**
   * Starts the UDP server and begins listening for datagrams.
   * Uses RetryScheduler for automatic retry on bind failures.
   *
   * @returns Promise that resolves when server is listening.
   * @throws Error if server fails to bind after max retries.
   * @example
   * ```typescript
   * try {
   *   await udpServer.start();
   *   console.log("Server started on port", udpServer.getPort());
   * } catch (err) {
   *   console.error("Failed to start server:", err);
   * }
   * ```
   */
  public async start(): Promise<void> {
    if (this.state !== ServerState.Stopped) return;

    const config = this.configManager.getCoreConfig();
    this.logger = this.loggerManager.getLogger(); // Reload the logger, in case the loggerManager is reloaded.
    this.abortController = new AbortController();
    this.address = config.udp_address;
    this.port = config.udp_port; // Default to 5707.

    this.retryScheduler = new RetryScheduler(() => this.attemptBind(), {
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
      `Initializing ${this.getArrowedName()} UDP listener on ${this.address}:${this.port}`,
    );

    try {
      // Use RetryScheduler.run() as the main retry loop
      await this.retryScheduler.run();
    } catch (err) {
      if (isAbortError(err)) {
        // Cancellation is not a failure.
        this.setState(ServerState.Stopped);
        this.logger.warn(
          `The ${this.getArrowedName()} UDP server start aborted.`,
        );
        return;
      }
      this.setState(ServerState.Error);
      throw err;
    }
  }

  /**
   * Stops the UDP server and closes the socket.
   *
   * @returns Promise that resolves when the server has stopped.
   */
  public async stop(): Promise<void> {
    if (this.state === ServerState.Stopped) return;

    this.logger.info(`Stopping the ${this.getArrowedName()} UDP server...`);
    this.setState(ServerState.Stopped);

    this.abortController.abort();
    this.retryScheduler?.stop();

    if (!this.socket) return;

    this.socket.close();
    this.socket = undefined;
  }

  // -------------------------------
  // Single attempt to bind
  // -------------------------------

  private async attemptBind(): Promise<void> {
    if (this.state === ServerState.Stopped) {
      throw new DOMException("Aborted", "AbortError");
    }

    return new Promise<void>((resolve, reject) => {
      try {
        this.socket = dgram.createSocket("udp4");

        // 1. Define cleanup for the "start-up" phase listeners
        const removeStartupListeners = () => {
          this.socket?.off(NetworkEvent.Listening, onStartupListening);
          this.socket?.off(NetworkEvent.Error, onStartupError);
          this.socket?.off(NetworkEvent.Close, onStartupClose);
        };

        // 2. Define the bridge handlers that link Class Logic to this specific Promise
        const onStartupListening = () => {
          removeStartupListeners();
          this.handleBindSuccess();
          resolve();
        };

        const onStartupError = (err: NodeJS.ErrnoException) => {
          removeStartupListeners();
          // We don't close the socket here because handleBindError might decide
          // to keep it or the retry logic handles it, but usually we close on error.
          this.socket?.close();

          try {
            this.handleBindError(err);
            reject(err);
          } catch (e) {
            reject(e); // Catch if handleBindError throws
          }
        };

        const onStartupClose = () => {
          removeStartupListeners();
          if (this.state !== ServerState.Stopped) {
            this.logger.warn(
              `The ${this.getArrowedName()} UDP socket closed unexpectedly during bind attempt, retrying ...`,
            );
            reject(
              new Error(
                `The ${this.getArrowedName()} UDP socket closed unexpectedly.`,
              ),
            );
          }
        };

        // 3. Attach Listeners
        // Startup listeners (One-time use for the Promise)
        this.socket.once(NetworkEvent.Listening, onStartupListening);
        this.socket.once(NetworkEvent.Error, onStartupError);
        this.socket.once(NetworkEvent.Close, onStartupClose);

        // Runtime listener (Permanent)
        this.socket.on(NetworkEvent.Message, this.handleMessage.bind(this));

        // 4. Bind
        this.socket.bind(this.port, this.address);
      } catch (err) {
        this.setState(ServerState.Error);
        reject(err);
      }
    });
  }

  // --------------------------------------------------------------------------
  // Private Handler Methods
  // --------------------------------------------------------------------------

  /**
   * Handles binding errors: classifies error and updates state.
   *
   * @param err - The error that occurred during bind.
   */
  protected handleBindError(err: NodeJS.ErrnoException): void {
    // If it's a retryable error (like EADDRINUSE), we usually just reject
    // and let the retryScheduler handle it, without setting global Error state yet.
    if (NetworkRetryable.has(err.code ?? "")) {
      return;
    }

    // Critical error
    this.setState(ServerState.Error);
    this.emit(NetworkEvent.Error, {
      error: err,
      peer: undefined, // No peer associated with a bind error
    });
  }

  /**
   * Handles successful binding logic: updates state, logs, and resets retry.
   * Can be overridden by subclasses to add additional behavior.
   */
  protected handleBindSuccess(): void {
    // Update port if ephemeral (configured to listen on port 0).
    const addr = this.socket?.address();
    if (addr && typeof addr === "object") {
      this.port = addr.port;
    }

    this.setState(ServerState.Listening);
    this.retryScheduler.reset();

    this.logger.info(
      `The ${this.getArrowedName()} UDP server listening on <${this.address}:${this.port}>`,
    );
    this.emit(NetworkEvent.Listening);
  }

  /**
   * Handles incoming messages (Runtime logic).
   * Primaryly for subclass override to customize the message handling behaviors.
   * Other classes which instantiate this class should attach their message processor
   * to the emitted `NetworkEvent.Message` event from this instance.
   * Note: This is attached via .on(), so it persists after the Promise resolves.
   *
   * @param msg - The message buffer received.
   * @param rinfo - Remote information about the sender.
   */
  protected handleMessage(msg: Buffer, rinfo: RemoteInfo): void {
    if (!this.socket) return;

    const peer: NetworkPeer = {
      protocol: NetworkProtocol.UDP,
      socket: this.socket,
      address: rinfo.address,
      port: rinfo.port,
    };

    // Update bytes received metric for OpenTelemetry.
    bytesCounter.add(msg.length, {
      protocol: NetworkProtocol.UDP,
      "peer.address": peer.address,
      "peer.port": peer.port,
    });

    this.emit(NetworkEvent.Message, { peer, data: msg });
  }

  /**
   * Returns the name with "<>" of this listener.
   * Primary for logging and metric tagging.
   */
  protected getArrowedName(): string {
    return `<${this.name}>`;
  }

  private setState(state: ServerState): void {
    if (this.state !== state) {
      this.logger.info(
        `${this.getArrowedName()} ${this.port}/UDP state: ${this.state} → ${state}`,
      );
      this.state = state;
    }
  }
}
