import dgram, { Socket as UdpSocket, RemoteInfo } from "dgram";
import { Logger } from "winston";

import { isAbortError } from "../common/abort-aware";
import { ConfigManager } from "../common/config";
import { LoggerManager } from "../common/logger";
import { RetryScheduler } from "../common/retry";
import { TypedEventEmitter } from "./typed-event-emitter";
import { bytesCounter, listenerState } from "../metrics/otel-metrics";
import {
  NetworkEvent,
  NetworkEventMap,
  NetworkPeer,
  NetworkProtocol,
  ServerState,
} from "./network-events";

const RETRYABLE_ERRORS = new Set(["EADDRINUSE", "EADDRNOTAVAIL", "ENETDOWN"]);

export class UdpServer extends TypedEventEmitter<NetworkEventMap> {
  private configManager: ConfigManager = ConfigManager.getInstance();
  private logger: Logger = LoggerManager.getInstance().getLogger();

  private abortController!: AbortController;
  private retryScheduler!: RetryScheduler;
  private socket: UdpSocket | null = null;

  private state: ServerState = ServerState.Stopped;
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
    this.address = config.udp_address;
    this.port = config.udp_port; // Default to 5707.
    this.abortController = new AbortController();

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
      `Initializing UDP listener "${this.listenerName}" on ${this.address}:${this.port}`
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

        const cleanup = () => {
          this.socket?.off(NetworkEvent.Listening, onListening);
          this.socket?.off(NetworkEvent.Error, onError);
          this.socket?.off(NetworkEvent.Close, onClose);
          this.socket?.off(NetworkEvent.Message, onMessage);
        };

        const onListening = () => {
          cleanup();

          // Update port if ephemeral (listen port is 0).
          const addr = this.socket!.address();
          if (typeof addr === "object") {
            this.port = addr.port;
          }

          this.setState(ServerState.Listening);
          this.retryScheduler.reset();
          this.logger.info(
            `UDP server listening on ${this.address}:${this.port}`
          );
          this.emit(NetworkEvent.Listening);
          resolve();
        };

        const onError = (err: NodeJS.ErrnoException) => {
          cleanup();
          this.socket?.close();

          if (RETRYABLE_ERRORS.has(err.code ?? "")) {
            reject(err);
          } else {
            this.setState(ServerState.Error);
            this.emit(NetworkEvent.Error, {
              error: err,
              peer: undefined as any,
            });
            reject(err);
          }
        };

        const onClose = () => {
          cleanup();
          if (this.state !== ServerState.Stopped) {
            this.logger.warn("UDP socket closed unexpectedly, retrying ...");
            reject(new Error("UDP socket closed unexpectedly."));
          }
        };

        const onMessage = (msg: Buffer, rinfo: RemoteInfo) => {
          const peer: NetworkPeer = {
            protocol: NetworkProtocol.UDP,
            socket: this.socket!,
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
        };

        this.socket.once(NetworkEvent.Listening, onListening);
        this.socket.once(NetworkEvent.Error, onError);
        this.socket.once(NetworkEvent.Close, onClose);
        this.socket.on(NetworkEvent.Message, onMessage);

        this.socket.bind(this.port, this.address);
      } catch (err) {
        this.setState(ServerState.Error);
        reject(err);
      }
    });
  }

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
