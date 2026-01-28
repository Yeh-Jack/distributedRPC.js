import { describe, it, expect, vi, beforeEach } from "vitest";
import { getHostIP } from "../../network/network-events";
import * as os from "os";

// Mock the os module
vi.mock("os", () => ({
  default: {
    networkInterfaces: vi.fn(),
  },
  networkInterfaces: vi.fn(),
}));

const mockOs = vi.mocked(os);

describe("getHostIP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear any environment variable
    delete process.env.HOST_IP;
  });

  describe("environment variable override", () => {
    it("should return HOST_IP environment variable when set", () => {
      process.env.HOST_IP = "192.168.1.100";

      const result = getHostIP();

      expect(result).toBe("192.168.1.100");
      expect(mockOs.networkInterfaces).not.toHaveBeenCalled();
    });

    it("should prioritize HOST_IP over network interfaces", () => {
      process.env.HOST_IP = "10.0.0.1";
      mockOs.networkInterfaces.mockReturnValue({
        eth0: [
          {
            address: "192.168.1.100",
            netmask: "255.255.255.0",
            family: "IPv4",
            mac: "aa:bb:cc:dd:ee:ff",
            internal: false,
            cidr: "192.168.1.100/24",
          },
        ],
      });

      const result = getHostIP();

      expect(result).toBe("10.0.0.1");
      expect(mockOs.networkInterfaces).not.toHaveBeenCalled();
    });
  });

  describe("network interface detection", () => {
    it("should return first external IPv4 address from network interfaces", () => {
      mockOs.networkInterfaces.mockReturnValue({
        lo: [
          {
            address: "127.0.0.1",
            netmask: "255.0.0.0",
            family: "IPv4",
            mac: "00:00:00:00:00:00",
            internal: true,
            cidr: "127.0.0.1/8",
          },
        ],
        eth0: [
          {
            address: "192.168.1.100",
            netmask: "255.255.255.0",
            family: "IPv4",
            mac: "aa:bb:cc:dd:ee:ff",
            internal: false,
            cidr: "192.168.1.100/24",
          },
        ],
      });

      const result = getHostIP();

      expect(result).toBe("192.168.1.100");
      expect(mockOs.networkInterfaces).toHaveBeenCalledTimes(1);
    });

    it("should skip internal IPv4 addresses", () => {
      mockOs.networkInterfaces.mockReturnValue({
        lo: [
          {
            address: "127.0.0.1",
            netmask: "255.0.0.0",
            family: "IPv4",
            mac: "00:00:00:00:00:00",
            internal: true,
            cidr: "127.0.0.1/8",
          },
        ],
        eth0: [
          {
            address: "10.0.0.100",
            netmask: "255.255.255.0",
            family: "IPv4",
            mac: "aa:bb:cc:dd:ee:ff",
            internal: false,
            cidr: "10.0.0.100/24",
          },
        ],
      });

      const result = getHostIP();

      expect(result).toBe("10.0.0.100");
    });

    it("should skip non-IPv4 addresses", () => {
      mockOs.networkInterfaces.mockReturnValue({
        eth0: [
          {
            address: "fe80::1",
            netmask: "ffff:ffff:ffff:ffff::",
            family: "IPv6",
            mac: "aa:bb:cc:dd:ee:ff",
            internal: false,
            scopeid: 0,
            cidr: "fe80::1/64",
          },
          {
            address: "192.168.1.100",
            netmask: "255.255.255.0",
            family: "IPv4",
            mac: "aa:bb:cc:dd:ee:ff",
            internal: false,
            cidr: "192.168.1.100/24",
          },
        ],
      });

      const result = getHostIP();

      expect(result).toBe("192.168.1.100");
    });

    it("should return 127.0.0.1 when no valid interfaces found", () => {
      mockOs.networkInterfaces.mockReturnValue({
        lo: [
          {
            address: "127.0.0.1",
            netmask: "255.0.0.0",
            family: "IPv4",
            mac: "00:00:00:00:00:00",
            internal: true,
            cidr: "127.0.0.1/8",
          },
        ],
      });

      const result = getHostIP();

      expect(result).toBe("127.0.0.1");
    });

    it("should return 127.0.0.1 when networkInterfaces returns null", () => {
      mockOs.networkInterfaces.mockReturnValue(null as any);

      const result = getHostIP();

      expect(result).toBe("127.0.0.1");
    });

    it("should return 127.0.0.1 when networkInterfaces returns undefined", () => {
      mockOs.networkInterfaces.mockReturnValue(undefined as any);

      const result = getHostIP();

      expect(result).toBe("127.0.0.1");
    });

    it("should handle empty interface arrays", () => {
      mockOs.networkInterfaces.mockReturnValue({
        eth0: [],
        wlan0: [],
      });

      const result = getHostIP();

      expect(result).toBe("127.0.0.1");
    });

    it("should handle interfaces without IPv4 addresses", () => {
      mockOs.networkInterfaces.mockReturnValue({
        eth0: [
          {
            address: "fe80::1",
            netmask: "ffff:ffff:ffff:ffff::",
            family: "IPv6",
            mac: "aa:bb:cc:dd:ee:ff",
            internal: false,
            scopeid: 0,
            cidr: "fe80::1/64",
          },
        ],
      });

      const result = getHostIP();

      expect(result).toBe("127.0.0.1");
    });
  });
});
