/**
 * Dependency injection type symbols.
 * Used as keys for binding and resolving dependencies in the container.
 */
export const TYPES = {
  /** ConfigManager service identifier. */
  ConfigManager: Symbol.for("ConfigManager"),
  /** LoggerManager service identifier. */
  LoggerManager: Symbol.for("LoggerManager"),
  /** Logger (Winston) instance identifier. */
  Logger: Symbol.for("Logger"),
  /** ServiceManager service identifier. */
  ServiceManager: Symbol.for("ServiceManager"),
  /** TcpServer service identifier. */
  TcpServer: Symbol.for("TcpServer"),
  /** UdpServer service identifier. */
  UdpServer: Symbol.for("UdpServer"),
};
