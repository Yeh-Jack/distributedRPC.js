import dgram, { Socket as UdpSocket, RemoteInfo } from "dgram";

import { isAbortError } from "../common/abort-aware";
import { ConfigManager } from "../common/config";
import { LoggerManager } from "../common/logger";
import { RetryScheduler } from "../common/retry";
import { ServerState } from "../types/basal-protocol";
import { TypedEventEmitter } from "./typed-event-emitter";
import { bytesCounter, listenerState } from "../metrics/otel-metrics";
import {
  NetworkEvent,
  NetworkEventMap,
  NetworkPeer,
  NetworkProtocol,
  NetworkRetryable,
} from "./network-events";

export class UdpServer extends TypedEventEmitter<NetworkEventMap> {
  private configManager: ConfigManager = ConfigManager.getInstance();
  private logger: ReturnType<typeof LoggerManager.prototype.getLogger> =
    LoggerManager.getInstance().getLogger();

  private abortController!: AbortController;
  private retryScheduler!: RetryScheduler;
  private state: ServerState = ServerState.Stopped;

  private socket: UdpSocket | null = null;
  private address!: string;
  private port!: number;

  constructor(private readonly listenerName: string) {
    super();
  }

  // -------------------------------
  // Public API
  // -------------------------------

  public getState(): ServerState {
    return this.state;
  }

  public getPort(): number {
    return this.port;
  }

  public async start(): Promise<void> {
    if (this.state !== ServerState.Stopped) return;

    const config = this.configManager.getCoreConfig();
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

    this.logger.info(
      `Initializing UDP listener "${this.listenerName}" on ${this.address}:${this.port}`,
    );

    try {
      // Use RetryScheduler.run() as the main retry loop
      await this.retryScheduler.run();
    } catch (err) {
      if (isAbortError(err)) {
        // Cancellation is not a failure.
        this.setState(ServerState.Stopped);
        this.logger.info("UDP server start aborted.");
        return;
      }
      this.setState(ServerState.Error);
      throw err;
    }
  }

  public async stop(): Promise<void> {
    if (this.state === ServerState.Stopped) return;

    this.logger.info("Stopping UDP server...");
    this.setState(ServerState.Stopped);

    this.abortController.abort();
    this.retryScheduler?.stop();

    if (!this.socket) return;

    this.socket.close();
    this.socket = null;
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
              "UDP socket closed unexpectedly during bind attempt, retrying ...",
            );
            reject(new Error("UDP socket closed unexpectedly."));
          }
        };

        // 3. Attach Listeners
        // Startup listeners (One-time use for the Promise)
        this.socket.once(NetworkEvent.Listening, onStartupListening);
        this.socket.once(NetworkEvent.Error, onStartupError);
        this.socket.once(NetworkEvent.Close, onStartupClose);

        // Runtime listener (Permanent)
        this.socket.on(NetworkEvent.Message, this.handleMessage);

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
   */
  private handleBindError = (err: NodeJS.ErrnoException): void => {
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
  };

  /**
   * Handles successful binding logic: updates state, logs, and resets retry.
   */
  private handleBindSuccess = (): void => {
    // Update port if ephemeral (listen port is 0).
    const addr = this.socket?.address();
    if (addr && typeof addr === "object") {
      this.port = addr.port;
    }

    this.setState(ServerState.Listening);
    this.retryScheduler.reset();

    this.logger.info(`UDP server listening on ${this.address}:${this.port}`);
    this.emit(NetworkEvent.Listening);
  };

  /**
   * Handles incoming messages (Runtime logic).
   * Note: This is attached via .on(), so it persists after the Promise resolves.
   */
  private handleMessage = (msg: Buffer, rinfo: RemoteInfo): void => {
    if (!this.socket) return;

    const peer: NetworkPeer = {
      protocol: NetworkProtocol.UDP,
      socket: this.socket,
      address: rinfo.address,
      port: rinfo.port,
    };

    // Update bytes received metric for OpenTelemetry.
    // Assuming 'bytesCounter' is available in scope or via 'this.metrics...'
    bytesCounter.add(msg.length, {
      protocol: NetworkProtocol.UDP,
      "peer.address": peer.address,
      "peer.port": peer.port,
    });

    this.emit(NetworkEvent.Message, { peer, data: msg });
  };

  private setState(state: ServerState) {
    if (this.state !== state) {
      // Update server state metric for OpenTelemetry.
      // ObservableGauge is an async instrument and cannot be updated directly; store the latest
      // state on the gauge object for the observable callback to report.
      (listenerState as any).latestState = state;
      this.logger.info(`UDP server state: ${this.state} → ${state}`);
      this.state = state;
    }
  }
}
