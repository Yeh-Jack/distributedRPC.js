/**
 * Dependency injection type symbols.
 * Used as keys for binding and resolving dependencies in the container.
 */
export const TYPES = {
  BroadcastUdpServer: Symbol.for("BroadcastUdpServer"),
  ConfigManager: Symbol.for("ConfigManager"),
  LoggerManager: Symbol.for("LoggerManager"),
  Logger: Symbol.for("Logger"),
  ServiceManager: Symbol.for("ServiceManager"),
  TcpServer: Symbol.for("TcpServer"),
  UdpServer: Symbol.for("UdpServer"),
};
