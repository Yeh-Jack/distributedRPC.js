import { createServer, Server, Socket as TcpSocket } from "net";

import { isAbortError } from "../common/abort-aware";
import { ConfigManager } from "../common/config";
import { LoggerManager } from "../common/logger";
import { RetryScheduler } from "../common/retry";
import { ServerState } from "../types/basal-protocol";
import { TypedEventEmitter } from "./typed-event-emitter";
import {
  activeConnections,
  bytesCounter,
  listenerState,
} from "../metrics/otel-metrics";
import {
  NetworkEvent,
  NetworkEventMap,
  NetworkPeer,
  NetworkProtocol,
  NetworkRetryable,
} from "./network-events";

export class TcpServer extends TypedEventEmitter<NetworkEventMap> {
  private configManager: ConfigManager = ConfigManager.getInstance();
  private logger: ReturnType<typeof LoggerManager.prototype.getLogger> =
    LoggerManager.getInstance().getLogger();

  private abortController!: AbortController;
  private retryScheduler!: RetryScheduler;
  private server: Server | null = null;

  private state: ServerState = ServerState.Stopped;
  private address!: string;
  private port!: number;

  private sockets: Set<TcpSocket> = new Set(); // For tracking active sockets.

  constructor(private readonly listenerName: string) {
    super();
    // Prevent process crash if 'error' is emitted and no one is listening
    this.on(ServerState.Error, (err) => {
      this.logger.error(
        `[${this.listenerName}] Internal Error: ${
          err.error?.message || err.error
        }`,
      );
    });
  }

  // -------------------------------
  // Public API
  // -------------------------------

  public getState(): ServerState {
    return this.state;
  }

  public getPort(): number {
    return this.port; // dynamically assigned if configured port = 0
  }

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

    this.logger.info(
      `Initializing TCP listener "${this.listenerName}" on ${this.address}:${this.port}`,
    );

    try {
      // Use RetryScheduler.run() as the main retry loop
      await this.retryScheduler.run();
    } catch (err) {
      if (isAbortError(err)) {
        // Cancellation is not a failure.
        this.setState(ServerState.Stopped);
        this.logger.info("TCP server start aborted.");
        return;
      }
      this.setState(ServerState.Error);
      throw err;
    }
  }

  public async stop(): Promise<void> {
    if (this.state === ServerState.Stopped) return;

    this.logger.info("Stopping TCP server...");
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
          this.logger.warn("Server close error (ignoring)", { error: err });
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
    this.logger.info("TCP Server stopped.");
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
            `TCP server listening on ${this.address}:${this.port}`,
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
            this.logger.warn("Server closed unexpectedly, retrying ...");
            reject(new Error("Server closed unexpectedly."));
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

  private setState(state: ServerState) {
    if (this.state !== state) {
      // Update server state metric for OpenTelemetry.
      // ObservableGauge is an async instrument and cannot be updated directly; store the latest
      // state on the gauge object for the observable callback to report.
      (listenerState as any).latestState = state;
      this.logger.info(`TCP server state: ${this.state} → ${state}`);
      this.state = state;
    }
  }
}
