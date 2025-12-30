import net from "node:net";
import dgram from "node:dgram";
import EventEmitter from "node:events";
import "dotenv/config";

export class NetworkServer extends EventEmitter {
  constructor(ip, port) {
    super();
    this.ip = ip;

    if (port === -1) {
      if (this.constructor.name === "UDPServer") {
        this.port = Number.parseInt(process.env.UDP_PORT_SM);
      } else if (this.constructor.name === "TCPServer") {
        this.port = Number.parseInt(process.env.TCP_PORT_SM);
      }
    } else {
      this.port = port;
    }
  }

  run() {
    throw new Error("Method not implemented");
  }
  terminate() {
    throw new Error("Method not implemented");
  }
}

export class UDPServer extends NetworkServer {
  run() {
    this.socket = dgram.createSocket("udp4");
    this.socket.on("error", (err) => {
      console.error(`[UDP Error] ${err.stack}`);
      this.socket.close();
    });

    console.log(`[UDP] Server starting on port ${this.port}...`);

    this.socket.on("message", (msg, rinfo) => {
      const udpMessage = msg.toString();
      console.log(
        `[UDP] Recieved message from ${rinfo.address}:${rinfo.port} - "${udpMessage}"`
      );

      // IPv4 only for now
      if (
        udpMessage === process.env.CLIENT_VALIDATION_CODE &&
        rinfo.family === "IPv4"
      ) {
        const response = JSON.stringify({
          tcpPort: process.env.TCP_PORT_SM,
          validation: process.env.SERVER_VALIDATION_CODE,
        });

        this.socket.send(response, rinfo.port, rinfo.address, (err) => {
          if (err) {
            console.error("[UDP] Failed to send TCP info response:", err);
          } else {
            console.log(`[UDP] Sent TCP info response to ${rinfo.address}`);
          }
        });
      }
    });

    this.socket.bind(this.port, () => {
      console.log(`[UDP] Discovery Listener listen on port ${this.port}...`);
    });
  }

  terminate() {
    this.socket.close();
    console.log("[UDP] Server terminated");
  }
}

export class TCPServer extends NetworkServer {
  run() {
    this.server = net.createServer();
    this.server.on("error", (err) => {
      console.error(`[TCP Error] ${err.stack}`);
      this.server.close();
    });

    console.log(`[TCP] Server starting on port ${this.port}...`);

    this.server.on("connection", (socket) => {
      const clientAddr = socket.remoteAddress;
      const clientPort = socket.remotePort;
      console.log(`[TCP] New connection from ${clientAddr}:${clientPort}`);

      socket.on("data", (data) => {
        console.log(
          `[TCP] Received data from ${clientAddr}: ${data.toString().trim()}`
        );
      });

      socket.on("end", () =>
        console.log(`[TCP] Connection from ${clientAddr} ended`)
      );
    });

    this.server.listen(this.port, '0.0.0.0', () => {
      console.log(`[TCP] Server listening on port ${this.port}...`);
    });
  }

  terminate() {
    this.server.close();
    console.log("[TCP] Server terminated");
  }
}
