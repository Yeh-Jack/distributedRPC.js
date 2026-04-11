/**
 * UDP server implementation for distributed RPC communication.
 * @module udp-server
 */

import dgram, { Socket as UdpSocket, RemoteInfo } from "dgram";
import { injectable } from "inversify";

import { isAbortError } from "../common/abort-aware";
import { ConfigManager } from "../common/config";
import { LoggerManager } from "../common/logger";
import { RetryScheduler } from "../common/retry";
import { ExecutionState, NetworkProtocol } from "../types/basal-protocol";
import { TypedEventEmitter } from "./typed-event-emitter";
import { bytesCounter } from "../metrics/otel-metrics";
import {
  NetworkEvent,
  NetworkEventMap,
  NetworkPeer,
  NetworkRetryable,
} from "./network-events";

/**
 * Base UDP server for handling incoming datagram messages.
 *
 * This class provides the foundation for UDP-based communication in distributed
 * RPC systems. It handles incoming datagram messages, manages server lifecycle, and
 * integrates with OpenTelemetry for observability.
 *
 * Key Features:
 * - Automatic retry with exponential backoff on bind failures
 * - Message tracking and metrics collection
 * - Graceful shutdown with proper resource cleanup
 * - Distributed tracing support
 * - Event-driven architecture using TypedEventEmitter
 *
 * @remarks
 * This class serves as a base for specialized UDP servers like BroadcastUdpServer.
 * It provides common functionality while allowing subclasses to override message
 * handling behavior through the handleMessage() method.
 *
 * @example
 * ```typescript
 * // Using IoC container
 * const udpServer = container.get<UdpServer>(TYPES.UdpServer);
 *
 * // Listen for server events
 * udpServer.on(NetworkEvent.Listening, () => {
 *   console.log("UDP server listening on port", udpServer.getPort());
 * });
 *
 * udpServer.on(NetworkEvent.Message, ({ peer, data }) => {
 *   console.log("Received from", peer.address, ":", data);
 * });
 *
 * await udpServer.start();
 * ```
 */
@injectable()
export class UdpServer extends TypedEventEmitter<NetworkEventMap> {
  public readonly name: string;

  protected configManager: ConfigManager;
  protected logger: ReturnType<LoggerManager["getLogger"]>;

  private _abortController!: AbortController;
  private _retryScheduler!: RetryScheduler;
  private _state: ExecutionState = ExecutionState.Stopped;

  private _socket!: UdpSocket | undefined;
  private _address!: string;
  private _port!: number;

  /**
   * Creates a new UDP server instance.
   *
   * @param configManager - The configuration manager for retrieving service settings.
   * @param name - Optional name to identify this server instance.
   */
  constructor(configManager: ConfigManager, name: string = "udp-server") {
    super();
    this.configManager = configManager;
    this.logger = configManager.getLogger();
    this.name = name;
  }

  // -------------------------------
  // Public API
  // -------------------------------

  /**
   * Get the listening UDP socket.
   * @returns dgram.Socket
   */
  public getReadySocket(): UdpSocket {
    if (!this._socket || this._state !== ExecutionState.Listening) {
      throw new Error(
        `The ${this.getArrowedName()} UDP server is not listening. Call start() first.`,
      );
    }
    return this._socket;
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
   * Returns the port the server is listening on.
   *
   * @returns The port number.
   */
  public getPort(): number {
    return this._port;
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
    if (this._state !== ExecutionState.Stopped) return;

    const config = this.configManager.getCoreConfig();
    const udpConfig = config.net.udp;
    const retryConfig = config.retry;

    this.logger = this.configManager.getLogger(); // Reload the logger.
    this._abortController = new AbortController();
    this._address = udpConfig.address;
    this._port = udpConfig.port; // Default to 5707.

    this._setState(ExecutionState.Starting);
    this.logger.debug(
      `Initializing ${this.getArrowedName()} UDP listener on ${this._address}:${this._port}`,
    );

    this._retryScheduler = new RetryScheduler(() => this._attemptBind(), {
      interval: retryConfig.interval,
      max_try: retryConfig.max_try,
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
          `The ${this.getArrowedName()} UDP server start aborted.`,
        );
        return;
      }
      this._setState(ExecutionState.Error);
      throw err;
    }
  }

  /**
   * Stops the UDP server and closes the socket.
   *
   * @returns Promise that resolves when the server has stopped.
   */
  public async stop(): Promise<void> {
    if (this._state === ExecutionState.Stopped) return;

    this.logger.info(`Stopping the ${this.getArrowedName()} UDP server...`);
    this._setState(ExecutionState.Stopped);

    this._abortController.abort();
    this._retryScheduler?.stop();

    if (!this._socket) return;

    this._socket.close();
    this._socket = undefined;
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
    this._setState(ExecutionState.Error);
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
    const addr = this._socket?.address();
    if (addr && typeof addr === "object") {
      this._port = addr.port;
    }

    this._setState(ExecutionState.Listening);
    this._retryScheduler.reset();

    this.logger.info(
      `The ${this.getArrowedName()} UDP server listening on <${this._address}:${this._port}>`,
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
    if (!this._socket) return;

    const peer: NetworkPeer = {
      protocol: NetworkProtocol.UDP,
      socket: this._socket,
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

  // --------------------------------------------
  // Private Methods
  // --------------------------------------------

  private async _attemptBind(): Promise<void> {
    if (this._state === ExecutionState.Stopped) {
      throw new DOMException("Aborted", "AbortError");
    }

    return new Promise<void>((resolve, reject) => {
      try {
        this._socket = dgram.createSocket("udp4");

        // 1. Define cleanup for the "start-up" phase listeners
        const removeStartupListeners = () => {
          this._socket?.off(NetworkEvent.Listening, onStartupListening);
          this._socket?.off(NetworkEvent.Error, onStartupError);
          this._socket?.off(NetworkEvent.Close, onStartupClose);
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
          this._socket?.close();

          try {
            this.handleBindError(err);
            reject(err);
          } catch (e) {
            reject(e); // Catch if handleBindError throws
          }
        };

        const onStartupClose = () => {
          removeStartupListeners();
          if (this._state !== ExecutionState.Stopped) {
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
        this._socket.once(NetworkEvent.Listening, onStartupListening);
        this._socket.once(NetworkEvent.Error, onStartupError);
        this._socket.once(NetworkEvent.Close, onStartupClose);

        // Runtime listener (Permanent)
        this._socket.on(NetworkEvent.Message, this.handleMessage.bind(this));

        // 4. Bind
        this._socket.bind(this._port, this._address);
      } catch (err) {
        this._setState(ExecutionState.Error);
        reject(err);
      }
    });
  }

  private _setState(state: ExecutionState): void {
    if (this._state !== state) {
      this.logger.info(
        `${this.getArrowedName()} ${this._port}/UDP state: ${this._state} → ${state}`,
      );
      this._state = state;
    }
  }
}
