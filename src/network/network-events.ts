/**
 * Network events and types for distributed RPC communication.
 * @module network-events
 */

import * as os from "os";
import { Socket as TcpSocket } from "net";
import { Socket as UdpSocket } from "dgram";

/**
 * Set of network error codes that are considered retryable.
 * Operations encountering these errors should be retried rather than treated as fatal.
 */
export const NetworkRetryable = new Set([
  "EADDRINUSE",
  "EADDRNOTAVAIL",
  "ENETDOWN",
]);

/**
 * Network events emitted by servers and connections.
 */
export enum NetworkEvent {
  /** Server is listening for connections (TCP/UDP bind complete). */
  Listening = "listening",
  /** New client connection established (TCP only). */
  Connection = "connection",
  /** Data received from peer (TCP). */
  Data = "data",
  /** Message received from peer (UDP). */
  Message = "message",
  /** Connection closed or peer disconnected. */
  Close = "close",
  /** Error occurred during network operation. */
  Error = "error",
  /** Server stopped (custom event). */
  Stop = "stop",
}

/**
 * Network protocol types supported by the distributed RPC framework.
 */
export enum NetworkProtocol {
  /** Transmission Control Protocol - reliable, connection-oriented communication. */
  TCP = "TCP",
  /** User Datagram Protocol - fast, connectionless communication. */
  UDP = "UDP",
}

/**
 * Represents a network peer (client or remote endpoint).
 * Type discriminator based on protocol (TCP or UDP).
 */
export type NetworkPeer =
  | {
      /** TCP protocol connection. */
      protocol: NetworkProtocol.TCP;
      /** TCP socket instance. */
      socket: TcpSocket;
      /** Remote IP address. */
      address: string;
      /** Remote port number. */
      port: number;
    }
  | {
      /** UDP protocol connection. */
      protocol: NetworkProtocol.UDP;
      /** UDP socket instance. */
      socket: UdpSocket;
      /** Remote IP address. */
      address: string;
      /** Remote port number. */
      port: number;
    };

/**
 * Event map for TypedEventEmitter, mapping event names to their callback signatures.
 */
export interface NetworkEventMap {
  /** Server started listening. */
  [NetworkEvent.Listening]: () => void;
  /** New client connection (TCP). */
  [NetworkEvent.Connection]: (peer: NetworkPeer) => void;
  /** Data received (TCP). */
  [NetworkEvent.Data]: (peer: NetworkPeer, data: Buffer) => void;
  /** Message received (UDP). */
  [NetworkEvent.Message]: (peer: NetworkPeer, data: Buffer) => void;
  /** Connection closed. */
  [NetworkEvent.Close]: (peer: NetworkPeer, hadError?: boolean) => void;
  /** Error occurred. */
  [NetworkEvent.Error]: (error: Error, peer?: NetworkPeer) => void;
}

/**
 * Network statistics and metrics for monitoring.
 */
export interface NetworkMetrics {
  /** Protocol type (TCP or UDP). */
  protocol: NetworkProtocol;
  /** Current server state. */
  state: string;
  /** Whether server is actively listening. */
  listening: boolean;
  /** Timestamp when server started. */
  startTime?: number;
  /** Number of retry attempts made. */
  retryAttempts: number;
  /** Current active connections (TCP only). */
  activeConnections?: number;
}

export function getHostIP(): string {
  /* Get IP from the explicitily assigned environment variable.
   * This is useful if the appliation is running in a container.
   *
   * You can run the container as :
   * # Get the first Host IP from all IP addresses of the host (Linux command)
   * HOST_IP=$(hostname -I | awk '{print $1}')
   * docker run -e HOST_IP=$HOST_IP -p 3000:3000 my-node-app
   */
  const envHostIP = process.env.HOST_IP;
  if (envHostIP) return envHostIP;

  // Get local IP from network interfaces
  return getLocalIPv4Address() || "127.0.0.1";
}

/**
 * Finds the first non-internal IPv4 address from network interfaces.
 *
 * @returns The IPv4 address or null if not found
 */
function getLocalIPv4Address(): string | null {
  const interfaces = os.networkInterfaces();
  if (!interfaces) return null;

  for (const name of Object.keys(interfaces)) {
    if (interfaces[name]) {
      for (const iface of interfaces[name]) {
        // Skip internal (i.e. 127.0.0.1) and non-ipv4 addresses
        if (iface.family === "IPv4" && !iface.internal) {
          return iface.address;
        }
      }
    }
  }
  return null;
}
