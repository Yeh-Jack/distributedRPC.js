/**
 * Broadcast UDP server implementation for service discovery.
 * Extends UdpServer to add broadcast-specific functionality.
 * @module broadcast-udp-server
 */

import { Socket as UdpSocket, RemoteInfo } from "dgram";
import { inject, injectable } from "inversify";

import { ConfigManager } from "../common/config";
import { LoggerManager } from "../common/logger";
import { TYPES } from "../aop/di-types";
import { UdpServer } from "../network/udp-server";
import {
  BroadcastResponse,
  ServerState,
  PROBE_MESSAGE,
} from "../types/basal-protocol";

@injectable()
export class BroadcastUdpServer extends UdpServer {
  private managerInfo: BroadcastResponse | undefined = undefined;
  private responseBuffer!: Buffer;

  constructor(
    @inject(TYPES.ConfigManager) configManager: ConfigManager,
    @inject(TYPES.LoggerManager) loggerManager: LoggerManager,
    name: string = "broadcast-udp-server",
  ) {
    super(configManager, loggerManager, name);
  }

  /**
   * Set ServiceManager information for response message to the sender of broadcast message.
   * This method should be called after the UDP server established immediately or before sendig
   * the first response message.
   *
   * @param info The information of the ServiceManager.
   */
  public setManagerInfo(info: BroadcastResponse) {
    this.managerInfo = info;
  }

  public override async start(): Promise<void> {
    await super.start();
    if (!this.managerInfo) {
      this.logger.warn(
        "ServiceManager information is not configured before starting the broadcast server.",
      );
      await this.stop(); // Stop the broadcast server to prevent cascade errors.
      throw new Error(
        `Information missing for the ${this.getArrowedName()} broadcast server.`,
      );
    }

    // Flaten managerInfo to message Buffer.
    this.responseBuffer = Buffer.from(JSON.stringify(this.managerInfo));
  }

  public override async stop(): Promise<void> {
    await super.stop();
    this.managerInfo = undefined;
    this.responseBuffer = Buffer.from("");
  }

  protected override handleMessage(msg: Buffer, rinfo: RemoteInfo): void {
    // Filter illegal message first.
    if (msg.toString() !== PROBE_MESSAGE) return;

    // Safe check.
    const state = this.getState();
    const socket: UdpSocket | undefined = this.getSocket();
    if (!socket || state !== ServerState.Listening) {
      const messge = `The ${this.getArrowedName()} broadcast server not running.`;
      this.logger.error(messge);
      throw new Error(messge);
    }

    // Doing things for the accepted message.
    const sender = `<${rinfo.address}:${rinfo.port}>`;
    this.logger.debug(`Received broadcast from ${sender}`);
    super.handleMessage(msg, rinfo);

    // Direct reply to the sender
    socket.send(this.responseBuffer, rinfo.port, rinfo.address, (err) => {
      if (err) {
        this.logger.error(`Error sending response to ${sender}: ${err}`);
      } else {
        this.logger.debug(
          `Responded ${this.responseBuffer.length} bytes to ${sender}`,
        );
      }
    });
  }
}
