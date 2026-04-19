/**
 * Dependency injection type symbols.
 * Used as keys for binding and resolving dependencies in the container.
 */
export const TYPES = {
  BroadcastUdpServer: Symbol.for("BroadcastUdpServer"),
  ConfigManager: Symbol.for("ConfigManager"),
  DiscoverProcedure: Symbol.for("DiscoverProcedure"),
  IdGenerator: Symbol.for("IdGenerator"),
  Logger: Symbol.for("Logger"),
  None: Symbol.for("None"),
  RegisterProcedure: Symbol.for("RegisterProcedure"),
  ReportProcedure: Symbol.for("ReportProcedure"),
  ServiceManager: Symbol.for("ServiceManager"),
  ServiceProvider: Symbol.for("ServiceProvider"),
  TcpServer: Symbol.for("TcpServer"),
  UdpClient: Symbol.for("UdpClient"),
  UdpDiscovery: Symbol.for("UdpDiscovery"),
  UdpServer: Symbol.for("UdpServer"),
};
