import { describe, it, expect } from "vitest";
import {
  AccessPoint,
  BroadcastResponse,
  BasalProtocol,
  NetworkProtocol,
} from "../../types/basal-protocol";

describe("BroadcastResponse", () => {
  describe("structure validation", () => {
    it("should create a valid BroadcastResponse with merged AccessPoint data", () => {
      const mockProtocol: BasalProtocol = {
        protocol_ver: "1.0.0",
        provider: {
          id: "test-id-123",
          name: "test-service",
          desc: "Test service description",
          version: "1.0.0",
        },
      };

      const mockAccessPoint: AccessPoint = {
        authorization: "auth-key-456",
        function: ["register", "report"],
        host: "192.168.1.100",
        port: 8080,
        protocol: NetworkProtocol.TCP,
      };

      const response: BroadcastResponse = {
        manager: {
          ...mockProtocol,
          provider: {
            ...mockProtocol.provider,
            ...mockAccessPoint,
          },
        },
      };

      // Validate the merged structure
      expect(response.manager.protocol_ver).toBe("1.0.0");
      expect(response.manager.provider.id).toBe("test-id-123");
      expect(response.manager.provider.name).toBe("test-service");
      expect(response.manager.provider.desc).toBe("Test service description");
      expect(response.manager.provider.version).toBe("1.0.0");

      // Validate merged AccessPoint properties
      expect(response.manager.provider.authorization).toBe("auth-key-456");
      expect(response.manager.provider.function).toEqual([
        "register",
        "report",
      ]);
      expect(response.manager.provider.host).toBe("192.168.1.100");
      expect(response.manager.provider.port).toBe(8080);
      expect(response.manager.provider.protocol).toBe("TCP");
    });

    it("should maintain type safety with merged provider properties", () => {
      const response: BroadcastResponse = {
        manager: {
          protocol_ver: "2.0.0",
          provider: {
            // Original BasalProtocol properties
            id: "service-123",
            name: "MyService",
            desc: "A service",
            version: "2.0.0",
            // Merged AccessPoint properties
            authorization: "token-abc",
            function: ["api"],
            host: "10.0.0.1",
            port: 9000,
            protocol: NetworkProtocol.UDP,
          },
        },
      };

      expect(response).toBeDefined();
      expect(typeof response.manager.provider.port).toBe("number");
      expect(Array.isArray(response.manager.provider.function)).toBe(true);
    });
  });
});
