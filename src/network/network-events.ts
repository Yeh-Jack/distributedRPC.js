/**
 * Network events and types for distributed RPC communication.
 * @module network-events
 */

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
 * Network protocol types supported by the distributed RPC framework.
 */
export enum NetworkProtocol {
  /** Transmission Control Protocol - reliable, connection-oriented communication. */
  TCP = "TCP",
  /** User Datagram Protocol - fast, connectionless communication. */
  UDP = "UDP",
}

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
