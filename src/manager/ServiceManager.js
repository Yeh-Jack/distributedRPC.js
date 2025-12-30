import os from "node:os";
import { UDPServer, TCPServer } from "../network/NetworkServer.js";

export class ServiceManager {
  constructor(udpPort = -1, tcpPort = -1) {
    this.ip = this.getLocalIP();
    this.TCPRegister = new TCPServer(this.ip, tcpPort);
    this.UDPListener = new UDPServer(this.ip, udpPort);

    this.UDPListener.run();
    this.TCPRegister.run();
  }

  getLocalIP = () => {
    const interfaces = os.networkInterfaces();
    const results = [];

    for (const [, ifaceList] of Object.entries(interfaces)) {
      for (const iface of ifaceList) {
        if (iface["family"] === "IPv4" && iface["internal"] === false) {
          results.push(iface["address"]);
        }
      }
    }

    return results;
  };
}
