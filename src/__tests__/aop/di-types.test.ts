import { describe, it, expect } from "vitest";
import { TYPES } from "../../aop/di-types";

describe("TYPES", () => {
  it("should have BroadcastUdpServer symbol", () => {
    expect(TYPES.BroadcastUdpServer).toBe(Symbol.for("BroadcastUdpServer"));
  });

  it("should have ConfigManager symbol", () => {
    expect(TYPES.ConfigManager).toBe(Symbol.for("ConfigManager"));
  });

  it("should have DiscoverProcedure symbol", () => {
    expect(TYPES.DiscoverProcedure).toBe(Symbol.for("DiscoverProcedure"));
  });

  it("should have IdGenerator symbol", () => {
    expect(TYPES.IdGenerator).toBe(Symbol.for("IdGenerator"));
  });

  it("should have Logger symbol", () => {
    expect(TYPES.Logger).toBe(Symbol.for("Logger"));
  });

  it("should have None symbol", () => {
    expect(TYPES.None).toBe(Symbol.for("None"));
  });

  it("should have RegisterProcedure symbol", () => {
    expect(TYPES.RegisterProcedure).toBe(Symbol.for("RegisterProcedure"));
  });

  it("should have ReportProcedure symbol", () => {
    expect(TYPES.ReportProcedure).toBe(Symbol.for("ReportProcedure"));
  });

  it("should have ServiceManager symbol", () => {
    expect(TYPES.ServiceManager).toBe(Symbol.for("ServiceManager"));
  });

  it("should have ServiceProvider symbol", () => {
    expect(TYPES.ServiceProvider).toBe(Symbol.for("ServiceProvider"));
  });

  it("should have TcpServer symbol", () => {
    expect(TYPES.TcpServer).toBe(Symbol.for("TcpServer"));
  });

  it("should have UdpClient symbol", () => {
    expect(TYPES.UdpClient).toBe(Symbol.for("UdpClient"));
  });

  it("should have UdpDiscovery symbol", () => {
    expect(TYPES.UdpDiscovery).toBe(Symbol.for("UdpDiscovery"));
  });

  it("should have UdpServer symbol", () => {
    expect(TYPES.UdpServer).toBe(Symbol.for("UdpServer"));
  });

  it("should have all 14 type symbols", () => {
    const keys = Object.keys(TYPES);
    expect(keys.length).toBe(14);
  });

  it("should all be Symbol.for() symbols", () => {
    for (const key of Object.keys(TYPES)) {
      expect(TYPES[key as keyof typeof TYPES]).toBe(Symbol.for(key));
    }
  });
});
