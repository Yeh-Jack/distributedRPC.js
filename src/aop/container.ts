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
import { DefaultIdGenerator } from "../common/id-generator";
import { ExecutionMetrics } from "../metrics/exec-metrics";
import { instrumentService } from "../aop/exec-time-interceptor";

import { BroadcastUdpServer } from "../network/broadcast-udp-server";
import { ServiceProvider } from "../provider/service-provider";
import { TcpServer } from "../network/tcp-server";
import { UdpDiscovery } from "../network/udp-discovery";
import { UdpServer } from "../network/udp-server";
import { AppEnv, IdGenerator } from "../types/basal-protocol";
import {
  DiscoverProcedure,
  RegisterProcedure,
  ReportProcedure,
} from "../procedure";

export { TYPES };

/**
 * Global InversifyJS container instance.
 * All application dependencies are registered and resolved through this container.
 * Singletons are pre-bound for DiscoverProcedure, RegisterProcedure, and ReportProcedure.
 */
export const container = new Container();

// Bind IdGenerator as singleton using DefaultIdGenerator
container
  .bind<IdGenerator>(TYPES.IdGenerator)
  .to(DefaultIdGenerator)
  .inSingletonScope();

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

/**
 * Binds a service class to the container and returns a ready-to-use instance.
 * The instance is activated via onActivation which reloads configuration and
 * instruments the service with execution time metrics.
 *
 * @param serviceClass - The service class constructor to bind and instantiate.
 * @returns Promise resolving to the activated service instance.
 */
export async function createProvider<T extends ServiceProvider>(
  serviceClass: new (...args: any[]) => T,
): Promise<T> {
  container
    .bind<T>(serviceClass)
    .to(serviceClass)
    .onActivation(async (_ctx, _instance) => {
      await _instance.reload();
      const metrics = new ExecutionMetrics(_instance.getLogger());
      return instrumentService(_instance, metrics);
    });
  return container.getAsync<T>(serviceClass);
}

/**
 * Factory for creating UdpDiscovery instances bound to the DI container.
 *
 * @param configManager - The configuration manager for server settings.
 * @param name - Unique identifier for the discovery instance.
 * @param type - The DI binding type symbol (only UdpDiscovery is supported).
 * @returns A new UdpDiscovery instance if type matches, otherwise undefined.
 */
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

// Bind procedure classes as singletons
container
  .bind<DiscoverProcedure>(TYPES.DiscoverProcedure)
  .to(DiscoverProcedure)
  .inSingletonScope();

container
  .bind<RegisterProcedure>(TYPES.RegisterProcedure)
  .to(RegisterProcedure)
  .inSingletonScope();

container
  .bind<ReportProcedure>(TYPES.ReportProcedure)
  .to(ReportProcedure)
  .inSingletonScope();
