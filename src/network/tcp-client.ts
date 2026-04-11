/**
 * TCP client implementation for distributed RPC communication.
 * @module tcp-client
 */

import { Socket as TcpSocket, connect, NetConnectOpts } from "net";
import { injectable } from "inversify";
import { Span, SpanStatusCode } from "@opentelemetry/api";

import { isAbortError } from "../common/abort-aware";
import { ConfigManager } from "../common/config";
import { LoggerManager } from "../common/logger";
import { RetryScheduler } from "../common/retry";
import {
  AccessPoint,
  ApiCall,
  ExecutionState,
  NetworkProtocol,
} from "../types/basal-protocol";
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
import { OtelTracer } from "../metrics/otel-tracing";
import { ProviderState, DEFAULT_RESOURCE } from "../provider/provider-info";

/**
 * TCP client for connecting to a remote server.
 *
 * This class provides a robust TCP client implementation for distributed
 * RPC systems. It handles connection lifecycle, data transmission, and
 * integrates with OpenTelemetry for observability.
 *
 * Key Features:
 * - Connect to remote TCP server via AccessPoint
 * - Automatic retry with exponential backoff on connection failures
 * - Connection tracking and metrics collection
 * - Graceful shutdown with proper socket cleanup
 * - Distributed tracing support
 * - Event-driven architecture using TypedEventEmitter
 *
 * @example
 * ```typescript
 * const accessPoint: AccessPoint = {
 *   host: "192.168.1.100",
 *   port: 8080,
 *   protocol: NetworkProtocol.TCP,
 *   authorization: "secret-key",
 *   function: ["rpc-service"]
 * };
 *
 * const tcpClient = new TcpClient(configManager, "my-client", accessPoint);
 * await tcpClient.connect();
 *
 * tcpClient.on(NetworkEvent.Data, ({ peer, data }) => {
 *   console.log("Received:", data.toString());
 * });
 *
 * tcpClient.write(Buffer.from("Hello server"));
 *
 * await tcpClient.disconnect();
 * ```
 */
@injectable()
export class TcpClient extends TypedEventEmitter<NetworkEventMap> {
  public readonly name: string;

  protected configManager: ConfigManager;
  protected logger: ReturnType<LoggerManager["getLogger"]>;

  private _abortController!: AbortController;
  private _retryScheduler!: RetryScheduler;
  private _state: ExecutionState = ExecutionState.Stopped;

  private _accessPoint!: AccessPoint;
  private _connectionSpan?: Span;
  private _connectionStartTime?: number;
  private _socket: TcpSocket | undefined;
  private _tracer: OtelTracer;
  private _writeSpan?: Span;

  /**
   * Creates a new TCP client instance.
   *
   * @param configManager - The configuration manager for retrieving service settings.
   * @param name - Optional name to identify this client instance. Defaults to "tcp-client".
   * @param ap - The AccessPoint containing host and port to connect to.
   * @param options - Optional configuration options for the TCP client.
   */
  constructor(
    configManager: ConfigManager,
    ap: AccessPoint,
    name: string = "tcp-client",
  ) {
    super();
    this.configManager = configManager;
    this.logger = configManager.getLogger();
    this.name = name;
    this._accessPoint = ap;
    this._tracer = OtelTracer.getInstance(
      name,
      new ProviderState(DEFAULT_RESOURCE),
    );
  }

  // -------------------------------
  // Public API
  // -------------------------------

  /**
   * Returns the AccessPoint this client connects to.
   */
  public getAccessPoint(): AccessPoint {
    return this._accessPoint;
  }

  /**
   * Returns the underlying TCP socket.
   *
   * @throws Error if the client is not connected.
   */
  public getSocket(): TcpSocket {
    if (!this._socket || this._state !== ExecutionState.Running) {
      throw new Error(
        `The ${this.getArrowedName()} TCP client is not connected. Call connect() first.`,
      );
    }
    return this._socket;
  }

  /**
   * Returns the current client state.
   */
  public getState(): ExecutionState {
    return this._state;
  }

  /**
   *
   * @returns Promise that resolves with the msgId (correlationId) when the message is sent.
   */
  public async sendMessage(message: ApiCall): Promise<string> {
    let msgId;
    if (message.msgId) {
      msgId = message.msgId;
    } else {
      msgId = generateCorrelationId();
      message.msgId = msgId;
    }
    return this.writeWithId(JSON.stringify(message), msgId);
  }

  /**
   * Updates the AccessPoint for this client.
   *
   * @param ap - The new AccessPoint to connect to.
   */
  public setAccessPoint(ap: AccessPoint): void {
    this._accessPoint = ap;
  }

  /**
   * Connects to the remote TCP server.
   *
   * @returns Promise that resolves when connected.
   * @throws Error if connection fails.
   */
  public async start(): Promise<void> {
    const refueseStates = [ExecutionState.Running, ExecutionState.Starting];
    if (refueseStates.includes(this.getState())) return;

    const config = this.configManager.getCoreConfig();
    const retryConfig = config.retry;

    const connectionId = generateCorrelationId();
    this.logger = this.configManager.getLogger();
    this._abortController = new AbortController();

    this._setState(ExecutionState.Starting);
    this.logger.debug(`Initializing ${this.getArrowedName()} TCP client`);

    // Create _connectionSpan to trace the whole life-cycle of the connection.
    this._connectionSpan = this._tracer.createNetworkSpan("connect", {
      address: this._accessPoint.address,
      port: this._accessPoint.port,
      protocol: NetworkProtocol.TCP,
      direction: NetworkDirection.Out,
      attributes: {
        "client.name": this.name,
        "correlation.id": connectionId,
      },
    });

    this._retryScheduler = new RetryScheduler(() => this._attemptConnect(), {
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
      await this._retryScheduler.run();
    } catch (err) {
      this._connectionSpan?.recordException(err as Error);
      this._connectionSpan?.setStatus({
        code: SpanStatusCode.ERROR,
        message: (err as Error).message,
      });
      this._connectionSpan?.end();
      this._connectionSpan = undefined;

      if (isAbortError(err)) {
        this._setState(ExecutionState.Stopped);
        this.logger.warn(
          `The ${this.getArrowedName()} TCP client connection aborted.`,
        );
        return;
      }
      this._setState(ExecutionState.Error);
      throw err;
    }
  }

  /**
   * Disconnects from the remote TCP server.
   *
   * @returns Promise that resolves when disconnected.
   */
  public async stop(): Promise<void> {
    const refueseStates = [ExecutionState.Stopped];
    if (refueseStates.includes(this.getState())) return;

    this.logger.info(
      `Disconnecting the ${this.getArrowedName()} TCP client...`,
    );
    this._setState(ExecutionState.Stopped);

    this._abortController.abort();
    this._retryScheduler?.stop();

    if (!this._socket) return;

    // Finish the _connectionSpan.
    this._connectionSpan?.end();
    this._connectionSpan = undefined;

    this._socket.destroy();
    this._socket = undefined;
  }

  /**
   * Send data with an automatic generated message ID.
   *
   * @param data
   * @returns Promise that resolves with the msgId (correlationId) when data is written.
   */
  public async write(data: Buffer | string): Promise<string> {
    const msgId = generateCorrelationId();
    return this.writeWithId(data, msgId);
  }

  /**
   * Writes data to the connected server.
   *
   * @param data - The data buffer to write.
   * @returns Promise that resolves with the msgId (correlationId) when data is written.
   */
  public async writeWithId(
    data: Buffer | string,
    msgId: string,
  ): Promise<string> {
    const socket = this.getSocket();
    data = typeof data === "string" ? Buffer.from(data) : data;

    this._writeSpan = this._tracer.createNetworkSpan("write", {
      address: this._accessPoint.address,
      port: this._accessPoint.port,
      protocol: NetworkProtocol.TCP,
      direction: NetworkDirection.Out,
      parent: this._connectionSpan,
      attributes: {
        "client.name": this.name,
        "correlation.id": msgId,
        "write.size": data.length,
      },
    });

    return new Promise((resolve, reject) => {
      socket.write(data, (err) => {
        if (err) {
          this._writeSpan?.recordException(err);
          this._writeSpan?.setStatus({
            code: SpanStatusCode.ERROR,
            message: err.message,
          });
          this._writeSpan?.end();
          this._writeSpan = undefined;

          this.logger.error(
            `Error writing to ${this.getArrowedName()}: ${err.message}`,
          );
          reject(err);
        } else {
          bytesCounter.add(data.length, {
            protocol: NetworkProtocol.TCP,
            direction: NetworkDirection.Out,
          });

          tcpDataTransferSize.record(data.length, {
            transfer_type: "request",
            direction: NetworkDirection.Out,
          });

          this._writeSpan?.end();
          this._writeSpan = undefined;

          this.logger.debug(
            `Wrote ${data.length} bytes to ${this.getArrowedName()}`,
          );
          resolve(msgId);
        }
      });
    });
  }

  // --------------------------------------------
  // Protected Methods
  // --------------------------------------------

  /**
   * Returns the name with "<>" brackets for logging and metrics.
   */
  protected getArrowedName(): string {
    return `<${this.name}>`;
  }

  /**
   * Handles socket close.
   */
  protected handleClose(hasError: boolean): void {
    if (this._connectionStartTime) {
      const duration = Date.now() - this._connectionStartTime;
      tcpConnectionDuration.record(duration);
      this._connectionStartTime = undefined;
    }

    activeConnections.add(-1, { direction: NetworkDirection.Out });

    if (!hasError && this._state === ExecutionState.Running) {
      this.logger.info(`The ${this.getArrowedName()} TCP client disconnected`);
    }

    this.emit(NetworkEvent.Close, { peer: undefined, hadError: hasError });
  }

  /**
   * Handles connection errors.
   */
  protected handleConnectionError(err: NodeJS.ErrnoException): void {
    if (NetworkRetryable.has(err.code ?? "")) {
      return;
    }

    this._connectionSpan?.recordException(err);
    this._connectionSpan?.setStatus({
      code: SpanStatusCode.ERROR,
      message: err.message,
    });

    tcpConnectionsFailed.add(1, {
      "error.type": err.code ?? "unknown",
      "peer.address": this._accessPoint.address,
      "peer.port": this._accessPoint.port,
    });

    this._setState(ExecutionState.Error);
    this.emit(NetworkEvent.Error, {
      error: err,
      peer: undefined,
    });
  }

  /**
   * Handles successful connection.
   */
  protected handleConnectSuccess(): void {
    if (!this._socket) {
      throw new Error("Socket is not initialized yet.");
    }

    this._connectionStartTime = Date.now();
    this._setState(ExecutionState.Running);
    activeConnections.add(1, { direction: NetworkDirection.Out });

    const peer: NetworkPeer = {
      protocol: NetworkProtocol.TCP,
      socket: this._socket,
      address: this._accessPoint.address,
      port: this._accessPoint.port,
    };

    this.logger.info(
      `The ${this.getArrowedName()} TCP client connected to <${this._accessPoint.address}:${this._accessPoint.port}>`,
    );
    this.emit(NetworkEvent.Connection, { peer });
  }

  /**
   * Handles incoming data from the server.
   */
  protected handleData(data: Buffer): void {
    const readSpan = this._tracer.createNetworkSpan("read", {
      address: this._accessPoint.address,
      port: this._accessPoint.port,
      protocol: NetworkProtocol.TCP,
      direction: NetworkDirection.In,
      parent: this._connectionSpan,
      attributes: {
        "client.name": this.name,
        "read.size": data.length,
      },
    });

    bytesCounter.add(data.length, {
      protocol: NetworkProtocol.TCP,
      direction: NetworkDirection.In,
    });

    tcpDataTransferSize.record(data.length, {
      transfer_type: "response",
      direction: NetworkDirection.In,
    });

    const peer: NetworkPeer = {
      protocol: NetworkProtocol.TCP,
      socket: this._socket!,
      address: this._accessPoint.address,
      port: this._accessPoint.port,
    };

    this.logger.debug(
      `Received ${data.length} bytes from ${this.getArrowedName()}`,
    );

    readSpan.end();

    this.emit(NetworkEvent.Data, { peer, data });
  }

  /**
   * Handles socket errors.
   */
  protected handleError(err: Error): void {
    this.logger.error(
      `Socket error on ${this.getArrowedName()}: ${err.message}`,
    );

    tcpConnectionsFailed.add(1, {
      "error.type": err.name ?? "unknown",
      "peer.address": this._accessPoint.address,
      "peer.port": this._accessPoint.port,
    });

    this._setState(ExecutionState.Error);
    this.emit(NetworkEvent.Error, {
      error: err,
      peer: undefined,
    });
  }

  // --------------------------------------------
  // Private Methods
  // --------------------------------------------

  private async _attemptConnect(): Promise<void> {
    if (this._state === ExecutionState.Stopped) {
      throw new DOMException("Aborted", "AbortError");
    }

    return new Promise<void>((resolve, reject) => {
      try {
        const { address: host, port } = this._accessPoint;
        const tcpConfig = this.configManager.getCoreConfig().net.tcp.client;
        const connectOptions: NetConnectOpts = {
          host,
          port,
          timeout: tcpConfig.timeout,
          keepAlive: tcpConfig.keep_alive,
          keepAliveInitialDelay: tcpConfig.keep_alive_initial_delay,
        };

        this._socket = connect(connectOptions);

        const cleanup = () => {
          this._socket?.off(NetworkEvent.Connect, onConnect);
          this._socket?.off(NetworkEvent.Error, onError);
        };

        const onConnect = () => {
          cleanup();
          this.handleConnectSuccess();
          this._setupSocketListeners();
          resolve();
        };

        const onError = (err: NodeJS.ErrnoException) => {
          cleanup();
          this._socket?.destroy();
          this.handleConnectionError(err);
          reject(err);
        };

        this._socket.once(NetworkEvent.Connect, onConnect);
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
        `${this.getArrowedName()} TCP client state: ${this._state} → ${state}`,
      );
      this._state = state;
    }
  }

  private _setupSocketListeners(): void {
    if (!this._socket) return;

    this._socket.on(NetworkEvent.Data, (data: Buffer) => {
      this.handleData(data);
    });

    this._socket.on(NetworkEvent.Close, (hadError: boolean) => {
      this.handleClose(hadError);
    });

    this._socket.on(NetworkEvent.Error, (err: Error) => {
      this.handleError(err);
    });
  }
}
