/**
 * InversifyJS dependency injection container configuration.
 * @module container
 */

import "reflect-metadata";
import { Container } from "inversify";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";

import { TYPES } from "./di-types";
import { ConfigManager } from "../common/config";
import { ExecutionMetrics } from "../metrics/exec-metrics";
import { instrumentService } from "../aop/exec-time-interceptor";

import { BroadcastUdpServer } from "../network/broadcast-udp-server";
import { ServiceManager } from "../manager/service-manager";
import { ServiceProvider } from "../provider/service-provider";
import { TcpServer } from "../network/tcp-server";
import { UdpClient } from "../network/udp-client";
import { UdpDiscovery } from "../network/udp-discovery";
import { UdpServer } from "../network/udp-server";
import { AppEnv } from "../types/basal-protocol";

export { TYPES };

/**
 * Global InversifyJS container instance.
 * All application dependencies are registered and resolved through this container.
 */
export const container = new Container();

/**
 * Creates a new named TCP server instance.
 * Use this factory function to acquire TCP server instances with specific names.
 *
 * @param configManager - The configuration manager to use for this server
 * @param name - Unique identifier for the server instance
 * @returns A new TcpServer instance with the given name
 * @example
 * ```typescript
 * const tcpServer = createNamedTcpServer(configManager, "my-server");
 * await tcpServer.start();
 * ```
 */
export function createNamedTcpServer(
  configManager: ConfigManager,
  name: string,
): TcpServer {
  return new TcpServer(configManager, name);
}

/**
 * Creates a new named UDP server instance.
 * Use this factory function to acquire UDP server instances with specific names.
 * For broadcast server, use name "broadcast" to get a BroadcastUdpServer.
 *
 * @param name - Unique identifier for the server instance
 * @returns A new UdpServer instance with the given name, or BroadcastUdpServer if name is "broadcast"
 * @example
 * ```typescript
 * const udpServer = createNamedUdpServer("my-server");
 * await udpServer.start();
 * ```
 */
/**
 * Creates a new named UDP server instance.
 * Use this factory function to acquire UDP server instances with specific names.
 * For broadcast server, use name "broadcast" to get a BroadcastUdpServer.
 *
 * @param configManager - The configuration manager to use for this server
 * @param name - Unique identifier for the server instance
 * @returns A new UdpServer instance with the given name, or BroadcastUdpServer if name is "broadcast"
 * @example
 * ```typescript
 * const udpServer = createNamedUdpServer(configManager, "my-server");
 * await udpServer.start();
 * ```
 */
export function createNamedUdpServer(
  configManager: ConfigManager,
  name: string,
  type: Symbol,
): UdpServer | BroadcastUdpServer {
  if (type === TYPES.BroadcastUdpServer) {
    return new BroadcastUdpServer(configManager, name);
  }

  return new UdpServer(configManager, name);
}

/**
 * Create OpenTelemetry exporter instance based on runtime environment.
 * Returns `ConsoleSpanExporter` if it's `development`, otherwise returns
 * `OTLPTraceExporter` instead.
 *
 * @param configManager - The configuration manager to use for determining the environment
 */
export function createOtelExporter(configManager: ConfigManager) {
  if (AppEnv.development === configManager.getAppEnv()) {
    return new ConsoleSpanExporter();
  } else {
    const args = {
      url: "http://localhost:4317",
    };
    return new OTLPTraceExporter(args);
  }
}

export function createServiceManagerDiscover(
  configManager: ConfigManager,
  name: string,
  type: Symbol,
): UdpDiscovery | undefined {
  if (type === TYPES.UdpDiscovery) {
    return new UdpDiscovery(configManager, name);
  }

  return undefined;
}

/**
 * Helper function to access the container within closures.
 * Required because Inversify's resolution context doesn't expose the container directly.
 */
function getContainer(): Container {
  return container;
}

// Bind BroadcastUdpServer
container
  .bind<BroadcastUdpServer>(TYPES.BroadcastUdpServer)
  .to(BroadcastUdpServer);

// Bind TcpServer
container.bind<TcpServer>(TYPES.TcpServer).to(TcpServer);

// Bind UdpServer
container.bind<UdpServer>(TYPES.UdpServer).to(UdpServer);

// Bind UdpClient
container.bind<UdpClient>(TYPES.UdpClient).to(UdpClient);

// Bind UdpDiscovery
container.bind<UdpDiscovery>(TYPES.UdpDiscovery).to(UdpDiscovery);

// Service with DI-compatible instrumentation
container
  .bind<ServiceProvider>(TYPES.ServiceProvider)
  .to(ServiceProvider)
  .onActivation((_ctx, _instance) => {
    // Create a new ServiceProvider instance
    const serviceProvider = new ServiceProvider();

    // Create a new ExecutionMetrics instance for this ServiceProvider
    const metrics = new ExecutionMetrics(serviceProvider.getLogger());
    return instrumentService(serviceProvider, metrics);
  });

container
  .bind<ServiceManager>(TYPES.ServiceManager)
  .to(ServiceManager)
  .onActivation((_ctx, _instance) => {
    // Create a new ServiceManager instance
    const serviceManager = new ServiceManager();

    // Create a new ExecutionMetrics instance for this ServiceManager
    const metrics = new ExecutionMetrics(serviceManager.getLogger());
    return instrumentService(serviceManager, metrics);
  });
