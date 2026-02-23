/**
 * Dependency injection type symbols.
 * Used as keys for binding and resolving dependencies in the container.
 */
export const TYPES = {
  BroadcastUdpServer: Symbol.for("BroadcastUdpServer"),
  ConfigManager: Symbol.for("ConfigManager"),
  LoggerManager: Symbol.for("LoggerManager"),
  Logger: Symbol.for("Logger"),
  None: Symbol.for("None"),
  ServiceManager: Symbol.for("ServiceManager"),
  ServiceProvider: Symbol.for("ServiceProvider"),
  TcpServer: Symbol.for("TcpServer"),
  UdpClient: Symbol.for("UdpClient"),
  UdpDiscovery: Symbol.for("UdpDiscovery"),
  UdpServer: Symbol.for("UdpServer"),
};
