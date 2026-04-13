/**
 * UDP client implementation for distributed RPC communication.
 * @module udp-client
 */

import dgram, { Socket as UdpSocket, RemoteInfo } from "dgram";
import { injectable } from "inversify";

import { isAbortError } from "../common/abort-aware";
import { ConfigManager } from "../common/config";
import { LoggerManager } from "../common/logger";
import { RetryScheduler } from "../common/retry";
import { ExecutionState, NetworkProtocol, SECOND } from "../types/basal-protocol";
import { TypedEventEmitter } from "./typed-event-emitter";
import { bytesCounter } from "../metrics/otel-metrics";
import {
  NetworkEvent,
  NetworkEventMap,
  NetworkPeer,
  NetworkRetryable,
} from "./network-events";

/**
 * Configuration options for sending UDP messages.
 */
export interface SendOptions {
  /** Target address to send the message to. Defaults to '192.168.255.255' for broadcast. */
  address?: string;
  /** Target port to send the message to. */
  port: number;
  /** Timeout in milliseconds to wait for a response. Defaults to 5000ms. */
  timeout?: number;
}

/**
 * Response received from a UDP message.
 */
export interface UdpResponse {
  /** The response data buffer. */
  data: Buffer;
  /** Remote information about the sender. */
  peer: NetworkPeer;
}

/**
 * Base UDP client for sending and receiving datagram messages.
 *
 * This class provides the foundation for UDP-based client communication in distributed
 * RPC systems. It handles sending messages and receiving responses, managing client lifecycle,
 * and integrates with OpenTelemetry for observability.
 *
 * Key Features:
 * - Send UDP messages to specific or broadcast addresses
 * - Automatic retry with exponential backoff on send failures
 * - Message tracking and metrics collection
 * - Graceful shutdown with proper resource cleanup
 * - Distributed tracing support
 * - Event-driven architecture using TypedEventEmitter
 * - Response timeout handling
 *
 * @example
 * ```typescript
 * // Using IoC container
 * const udpClient = container.get<UdpClient>(TYPES.UdpClient);
 * await udpClient.start();
 *
 * // Send a message and wait for response
 * const response = await udpClient.sendAndWait(Buffer.from("Hello"), {
 *   port: 5707,
 *   address: "192.168.255.255",
 *   timeout: 5000
 * });
 *
 * console.log("Response from", response.peer.address, ":", response.data);
 *
 * await udpClient.stop();
 * ```
 */
@injectable()
export class UdpClient extends TypedEventEmitter<NetworkEventMap> {
  public readonly name: string;

  protected configManager: ConfigManager;
  protected logger: ReturnType<LoggerManager["getLogger"]>;

  private _abortController!: AbortController;
  private _retryScheduler!: RetryScheduler;
  private _state: ExecutionState = ExecutionState.Stopped;

  private _socket!: UdpSocket | undefined;
  private _port!: number;

  /**
   * Creates a new UDP client instance.
   *
   * @param configManager - The configuration manager for retrieving service settings.
   * @param name - Optional name to identify this client instance.
   */
  constructor(configManager: ConfigManager, name: string = "udp-client") {
    super();
    this.configManager = configManager;
    this.logger = configManager.getLogger();
    this.name = name;
  }

  // -------------------------------
  // Public API
  // -------------------------------

  public getReadySocket(): UdpSocket {
    if (!this._socket || this._state !== ExecutionState.Running) {
      throw new Error(
        `The ${this.getArrowedName()} UDP client is not running. Call start() first.`,
      );
    }
    return this._socket;
  }

  /**
   * Returns the current client state.
   *
   * @returns The current ServerState (Stopped, Starting, Running, etc.).
   */
  public getState(): ExecutionState {
    return this._state;
  }

  /**
   * Returns the port the client is bound to.
   *
   * @returns The port number.
   */
  public getPort(): number {
    return this._port;
  }

  /**
   * Starts the UDP client and binds to an ephemeral port.
   *
   * @returns Promise that resolves when client is ready.
   * @throws Error if client fails to bind.
   */
  public async start(): Promise<void> {
    if (this._state !== ExecutionState.Stopped) return;

    const config = this.configManager.getCoreConfig();
    const retryConfig = config.retry;

    this.logger = this.configManager.getLogger(); // Reload the logger.
    this._abortController = new AbortController();

    this._setState(ExecutionState.Starting);
    this.logger.debug(`Initializing ${this.getArrowedName()} UDP client`);

    this._retryScheduler = new RetryScheduler(() => this._attemptBind(), {
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
        this._setState(ExecutionState.Stopped);
        this.logger.warn(
          `The ${this.getArrowedName()} UDP client start aborted.`,
        );
        return;
      }
      this._setState(ExecutionState.Error);
      throw err;
    }
  }

  /**
   * Stops the UDP client and closes the socket.
   *
   * @returns Promise that resolves when the client has stopped.
   */
  public async stop(): Promise<void> {
    if (this._state === ExecutionState.Stopped) return;

    this.logger.info(`Stopping the ${this.getArrowedName()} UDP client...`);
    this._setState(ExecutionState.Stopped);

    this._abortController.abort();
    this._retryScheduler?.stop();

    if (!this._socket) return;

    this._socket.close();
    this._socket = undefined;
  }

  /**
   * Sends a UDP message and waits for a response.
   *
   * @param message - The message buffer to send.
   * @param options - Send options including port, address, and timeout.
   * @returns Promise that resolves with the response data and peer info.
   * @throws Error if sending fails or timeout occurs.
   */
  public async sendAndWait(
    message: Buffer | string,
    options: SendOptions,
  ): Promise<UdpResponse> {
    const socket = this.getReadySocket();
    const timeout = options.timeout ?? 5 * SECOND; // Default timeout is 5 seconds.
    message = typeof message === "string" ? Buffer.from(message) : message;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        resolve({} as UdpResponse); // Timeout is not an error.
        // reject(new Error(`UDP request timed out after ${timeout}ms`));
      }, timeout);

      const onMessage = (msg: Buffer, rinfo: RemoteInfo) => {
        cleanup();

        const peer: NetworkPeer = {
          protocol: NetworkProtocol.UDP,
          socket,
          address: rinfo.address,
          port: rinfo.port,
        };
        const response: UdpResponse = { peer, data: msg };

        // Update bytes received metric for OpenTelemetry.
        bytesCounter.add(msg.length, {
          protocol: NetworkProtocol.UDP,
          "peer.address": peer.address,
          "peer.port": peer.port,
        });

        this.emit(NetworkEvent.Message, response);
        resolve(response);
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const onClose = () => {
        cleanup();
        reject(
          new Error(`${this.getArrowedName()} UDP socket closed unexpectedly.`),
        );
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        socket.off(NetworkEvent.Message, onMessage);
        socket.off(NetworkEvent.Error, onError);
        socket.off(NetworkEvent.Close, onClose);
      };

      // Set up temporary listeners for this request
      socket.once(NetworkEvent.Message, onMessage);
      socket.once(NetworkEvent.Error, onError);
      socket.once(NetworkEvent.Close, onClose);

      // Send the message
      this.send(message, options).catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }

  /**
   * Enables or disables broadcast mode on the socket.
   *
   * @param enabled - Whether to enable broadcast.
   * @returns Promise that resolves when broadcast is set.
   */
  public async setBroadcast(enabled: boolean): Promise<void> {
    const socket = this.getReadySocket();
    return new Promise((resolve, reject) => {
      socket.setBroadcast(enabled);
      // setBroadcast is synchronous, just verify socket exists
      this.logger.debug(
        `Broadcast mode for ${this.getArrowedName()} ${enabled ? "enabled" : "disabled"}.`,
      );
      resolve();
    });
  }

  // --------------------------------------------
  // Protected Methods
  // --------------------------------------------

  /**
   * Returns the name with "<>" of this client.
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
    if (NetworkRetryable.has(err.code ?? "")) {
      return;
    }

    this._setState(ExecutionState.Error);
    this.emit(NetworkEvent.Error, {
      error: err,
      peer: undefined,
    });
  }

  /**
   * Handles successful binding logic: updates state and logs.
   */
  protected handleBindSuccess(): void {
    // Update port if ephemeral (bound to port 0).
    const addr = this._socket?.address();
    if (addr && typeof addr === "object") {
      this._port = addr.port;
    }

    this._setState(ExecutionState.Running);

    this.logger.info(
      `The ${this.getArrowedName()} UDP client bound to port <${this._port}>`,
    );
    this.emit(NetworkEvent.Listening);
  }

  /**
   * Sends a UDP message to the specified address and port.
   *
   * @param message - The message buffer to send.
   * @param options - Send options including port, address, and timeout.
   * @returns Promise that resolves when the message is sent.
   * @throws Error if sending fails.
   */
  protected async send(message: Buffer, options: SendOptions): Promise<void> {
    const socket = this.getReadySocket();
    const address = options.address ?? "192.168.255.255";
    const port = options.port;
    const target = `<${address}:${port}>`;

    return new Promise((resolve, reject) => {
      socket.send(message, port, address, (err) => {
        if (err) {
          this.logger.error(
            `Error sending message to ${target}: ${err.message}`,
          );
          reject(err);
        } else {
          // Update bytes sent metric for OpenTelemetry.
          bytesCounter.add(message.length, {
            protocol: NetworkProtocol.UDP,
            "peer.address": address,
            "peer.port": port,
          });

          this.logger.debug(`Sent ${message.length} bytes to ${target}`);
          resolve();
        }
      });
    });
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

        // Bind to ephemeral port (0 = random available port)
        this._socket.bind(0);

        const cleanup = () => {
          this._socket?.off(NetworkEvent.Listening, onListening);
          this._socket?.off(NetworkEvent.Error, onError);
        };

        const onListening = () => {
          cleanup();
          this.handleBindSuccess();
          resolve();
        };

        const onError = (err: NodeJS.ErrnoException) => {
          cleanup();
          this._socket?.close();
          this.handleBindError(err);
          reject(err);
        };

        // Listen on socket construction related events only.
        this._socket.once(NetworkEvent.Listening, onListening);
        this._socket.once(NetworkEvent.Error, onError);
      } catch (err) {
        this._setState(ExecutionState.Error);
        reject(err);
      }
    });
  }

  private _setState(state: ExecutionState): void {
    if (this._state !== state) {
      this.logger.info(
        `${this.getArrowedName()} UDP client state: ${this._state} → ${state}`,
      );
      this._state = state;
    }
  }
}
