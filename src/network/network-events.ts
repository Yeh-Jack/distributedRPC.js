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

/**
 * Calculates the broadcast address(es) for one or more network interfaces.
 *
 * @param ifaceName - The name of a specific network interface to get the broadcast address for.
 *                    If undefined, broadcasts addresses are calculated for all available interfaces.
 * @returns An array of broadcast IP addresses in dotted decimal notation (e.g., "192.168.1.255").
 *          Returns an empty array if no network interfaces are available.
 * @throws {Error} If the specified interface name does not exist.
 *
 * @remarks
 * - Only IPv4 addresses are considered; IPv6 addresses are skipped.
 * - Internal loopback addresses (e.g., 127.0.0.1) are excluded.
 * - The broadcast address is calculated using bitwise OR between the network address
 *   and the inverted subnet mask.
 *
 * @example
 * // Get broadcast address for all interfaces
 * const allBroadcasts = getBroadcastAddress(undefined);
 *
 * @example
 * // Get broadcast address for a specific interface
 * const ethBroadcast = getBroadcastAddress("eth0");
 */
export function getAvailableBroadcastAddresses(ifaceName?: string): string[] {
  const ifaces = getNIC(ifaceName);
  if (!ifaces) return [];

  const broadcast: string[] = [];
  for (const name of Object.keys(ifaces)) {
    if (ifaces[name]) {
      for (const nic of ifaces[name]) {
        // Skip internal (i.e. 127.0.0.1) and non-ipv4 addresses
        if (nic.family === "IPv4" && !nic.internal) {
          const addrParts = nic.address.split(".").map(Number);
          const maskParts = nic.netmask.split(".").map(Number);

          // bitwise OR between address and inverted mask
          const broadcastParts = addrParts.map((part, i) => {
            // (~maskParts[i] & 0xff) gives the inverted mask byte (0-255)
            return part | (~maskParts[i] & 0xff);
          });

          const ip = broadcastParts.join(".");
          broadcast.push(ip);
        }
      }
    }
  }
  return broadcast;
}

/**
 * Gets a single broadcast address for network communication.
 *
 * Retrieves the broadcast address from the `BROADCAST` environment variable (set by `scripts/get-host-cidr.sh`).
 * If the environment variable is not set, calculates the broadcast address from available network interfaces.
 *
 * @param ifaceName - Optional network interface name to get the broadcast address for.
 *                    If not provided, uses all available interfaces.
 * @returns The broadcast address as a string (e.g., "192.168.1.255"), or `null` if no broadcast address is found.
 *
 * @example
 * // Get broadcast address from environment variable
 * const addr = getBroadcastAddress();
 * // Returns: "192.168.1.255"
 *
 * @example
 * // Get broadcast address for specific interface
 * const addr = getBroadcastAddress("eth0");
 */
export function getBroadcastAddress(ifaceName?: string): string | null {
  const envBroadcast = process.env.BROADCAST;
  if (envBroadcast) {
    return envBroadcast;
  }

  const broadcasts = getAvailableBroadcastAddresses(ifaceName);
  if (broadcasts.length > 0) {
    return broadcasts[0];
  } else {
    return null;
  }
}

export function getHostIP(): string {
  /* Get IP from environment variables or network interfaces.
   * This is useful if the application is running in a container.
   *
   * Environment variables (set by scripts/get-host-cidr.sh):
   * - HOST_CIDR: IP in CIDR format (e.g., "192.168.1.100/24")
   * - HOST_IP: IP address only (e.g., "192.168.1.100")
   *
   * Usage:
   * source scripts/get-host-cidr.sh > .env
   * docker-compose up -d
   */
  const envHostIP = process.env.HOST_IP;
  if (envHostIP) {
    return envHostIP;
  }

  const envHostCIDR = process.env.HOST_CIDR;
  if (envHostCIDR) {
    const parts = envHostCIDR.split("/");
    if (parts.length > 1) {
      return parts[0];
    }
    return envHostCIDR;
  }

  return getLocalIPv4Address(process.env.IFACE) || "127.0.0.1";
}

/**
 * Finds the IPv4 address from a specific network interface or the first non-internal interface.
 *
 * @param ifaceName - Optional specific interface name (e.g., "eth0", "ens0").
 *                    If provided, returns IP from that interface only.
 *                    If the specified interface has no IPv4 or doesn't exist, returns null.
 *                    If undefined, returns first non-internal IPv4 address from all interfaces.
 * @returns The IPv4 address or null if not found
 */
function getLocalIPv4Address(ifaceName?: string): string | null {
  const ifaces = getNIC(ifaceName);
  if (!ifaces) return null;

  for (const name of Object.keys(ifaces)) {
    if (ifaces[name]) {
      for (const nic of ifaces[name]) {
        if (nic.family === "IPv4" && !nic.internal) {
          return nic.address;
        }
      }
    }
  }
  return null;
}

function getNIC(ifaceName?: string) {
  const interfaces = os.networkInterfaces();
  if (!interfaces) return interfaces;

  // Get the specific interface.
  const iface =
    typeof ifaceName === "string"
      ? Object.fromEntries(
          Object.entries(interfaces).filter(([nic]) => nic === ifaceName),
        )
      : interfaces;
  if (!iface) {
    throw new Error(`Network interface <${ifaceName}> doesn't exist.`);
  }
  return iface;
}
