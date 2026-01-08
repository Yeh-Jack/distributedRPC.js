import { Socket as TcpSocket } from "net";
import { Socket as UdpSocket } from "dgram";

export enum NetworkProtocol {
  TCP = "TCP",
  UDP = "UDP",
}

export enum NetworkEvent {
  Listening = "listening",
  Connection = "connection",
  Data = "data",
  Message = "message",
  Close = "close",
  Error = "error",
}

export enum ServerState {
  Stopped = "Stopped",
  Starting = "Starting",
  Listening = "Listening",
  Retrying = "Retrying",
  Error = "Error",
}

export type NetworkPeer =
  | {
      protocol: NetworkProtocol.TCP;
      socket: TcpSocket;
      address: string;
      port: number;
    }
  | {
      protocol: NetworkProtocol.UDP;
      socket: UdpSocket;
      address: string;
      port: number;
    };

export interface NetworkEventMap {
  [NetworkEvent.Listening]: () => void;
  [NetworkEvent.Connection]: (peer: NetworkPeer) => void;
  [NetworkEvent.Data]: (peer: NetworkPeer, data: Buffer) => void;
  [NetworkEvent.Message]: (peer: NetworkPeer, data: Buffer) => void;
  [NetworkEvent.Close]: (peer: NetworkPeer, hadError?: boolean) => void;
  [NetworkEvent.Error]: (error: Error, peer?: NetworkPeer) => void;
}

export interface NetworkMetrics {
  protocol: NetworkProtocol;
  state: string;
  listening: boolean;
  startTime?: number;
  retryAttempts: number;
  activeConnections?: number; // TCP only
}
