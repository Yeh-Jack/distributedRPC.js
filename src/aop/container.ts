/**
 * InversifyJS dependency injection container configuration.
 * @module container
 */

import "reflect-metadata";
import { Container } from "inversify";
import { Logger } from "winston";

import { TYPES } from "./di-types";
import { ConfigManager } from "../common/config";
import { LoggerManager } from "../common/logger";
import { ExecutionMetrics } from "../metrics/exec-metrics";
import { withExecutionTime } from "../aop/exec-time-interceptor";
import { ServiceManager } from "../manager/service-manager";
import { TcpServer } from "../network/tcp-server";
import { UdpServer } from "../network/udp-server";

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
 * @param name - Unique identifier for the server instance
 * @returns A new TcpServer instance with the given name
 * @example
 * ```typescript
 * const tcpServer = createNamedTcpServer("my-server");
 * await tcpServer.start();
 * ```
 */
export function createNamedTcpServer(name: string): TcpServer {
  const configManager = container.get<ConfigManager>(TYPES.ConfigManager);
  const loggerManager = container.get<LoggerManager>(TYPES.LoggerManager);
  return new TcpServer(configManager, loggerManager, name);
}

/**
 * Creates a new named UDP server instance.
 * Use this factory function to acquire UDP server instances with specific names.
 * 
 * @param name - Unique identifier for the server instance
 * @returns A new UdpServer instance with the given name
 * @example
 * ```typescript
 * const udpServer = createNamedUdpServer("my-server");
 * await udpServer.start();
 * ```
 */
export function createNamedUdpServer(name: string): UdpServer {
  const configManager = container.get<ConfigManager>(TYPES.ConfigManager);
  const loggerManager = container.get<LoggerManager>(TYPES.LoggerManager);
  return new UdpServer(configManager, loggerManager, name);
}

/**
 * Helper function to access the container within closures.
 * Required because Inversify's resolution context doesn't expose the container directly.
 */
function getContainer(): Container {
  return container;
}

// Bind ConfigManager
container.bind<ConfigManager>(TYPES.ConfigManager).to(ConfigManager).inSingletonScope();

// Bind LoggerManager with dependency on ConfigManager
container.bind<LoggerManager>(TYPES.LoggerManager).to(LoggerManager).inSingletonScope();

// Bind Logger (retrieved from LoggerManager)
container.bind<Logger>(TYPES.Logger).toDynamicValue((ctx) => {
  const container = getContainer();
  const loggerManager = container.get<LoggerManager>(TYPES.LoggerManager);
  return loggerManager.getLogger();
});

// Metrics singleton
container.bind(ExecutionMetrics).toSelf().inSingletonScope();

// Bind TcpServer
container.bind<TcpServer>(TYPES.TcpServer).to(TcpServer);

// Bind UdpServer
container.bind<UdpServer>(TYPES.UdpServer).to(UdpServer);

// Service with AOP
container
  .bind<ServiceManager>(TYPES.ServiceManager)
  .to(ServiceManager)
  .onActivation((_ctx, instance) => {
    const container = getContainer();
    const metrics = container.get(ExecutionMetrics);
    return withExecutionTime(instance, metrics);
  });
