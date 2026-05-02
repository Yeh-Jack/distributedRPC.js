/**
 * Dependency injection type symbols.
 * Used as keys for binding and resolving dependencies in the container.
 */
export const TYPES = {
  /** Symbol for BroadcastUdpServer binding */
  BroadcastUdpServer: Symbol.for("BroadcastUdpServer"),
  /** Symbol for ConfigManager binding */
  ConfigManager: Symbol.for("ConfigManager"),
  /** Symbol for DiscoverProcedure binding */
  DiscoverProcedure: Symbol.for("DiscoverProcedure"),
  /** Symbol for IdGenerator binding */
  IdGenerator: Symbol.for("IdGenerator"),
  /** Symbol for Logger binding */
  Logger: Symbol.for("Logger"),
  /** Symbol for no specific binding (placeholder) */
  None: Symbol.for("None"),
  /** Symbol for RegisterProcedure binding */
  RegisterProcedure: Symbol.for("RegisterProcedure"),
  /** Symbol for ReportProcedure binding */
  ReportProcedure: Symbol.for("ReportProcedure"),
  /** Symbol for ServiceManager binding */
  ServiceManager: Symbol.for("ServiceManager"),
  /** Symbol for ServiceProvider binding */
  ServiceProvider: Symbol.for("ServiceProvider"),
  /** Symbol for TcpServer binding */
  TcpServer: Symbol.for("TcpServer"),
  /** Symbol for UdpClient binding */
  UdpClient: Symbol.for("UdpClient"),
  /** Symbol for UdpDiscovery binding */
  UdpDiscovery: Symbol.for("UdpDiscovery"),
  /** Symbol for UdpServer binding */
  UdpServer: Symbol.for("UdpServer"),
};
