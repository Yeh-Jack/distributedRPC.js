import fs from "fs";
import yaml from "js-yaml";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConfigManager } from "../../common/config";

// Tell Vitest to mock the entire 'fs' module.
vi.mock("fs");

function validateDefaultConfig(configManager: ConfigManager, svcName: string) {
  const appConfig = configManager.getAppConfig();
  expect(appConfig).toBeDefined();
  expect(appConfig).toEqual({});

  const coreConfig = configManager.getCoreConfig();
  expect(coreConfig.service_name).toBe(svcName);
  expect(coreConfig.udp_address).toBe("0.0.0.0");
  expect(coreConfig.udp_port).toBe(5707);
  expect(coreConfig.retry_interval).toBe(5000);
  expect(coreConfig.retry_max).toBe(0);
}

describe("ConfigManager", () => {
  const defaultSvcName = "test-service";

  beforeEach(() => {
    vi.clearAllMocks(); // Clear any existing console spies.
    (ConfigManager as any).instance = undefined; // Clear singleton instance for clean tests.
  });

  it("should create singleton instance", () => {
    const instance1 = ConfigManager.getInstance("test1");
    const instance2 = ConfigManager.getInstance("test2");

    expect(instance1).toBe(instance2);
  });

  it("should load default configuration", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false); // Emulate no config file.

    const configManager = ConfigManager.getInstance(defaultSvcName);
    validateDefaultConfig(configManager, defaultSvcName);
  });

  it("should trigger catch block when file reading fails (e.g., EACCES)", () => {
    // 1. Pretend the file exists so it passes the early checks
    vi.mocked(fs.existsSync).mockReturnValue(true);

    // 2. Force readFileSync to throw a System Error
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    // 3. Spy on console.error to verify the catch block logic
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Returns default config due to the error.
    const configManager = ConfigManager.getInstance(defaultSvcName);
    expect(errorSpy).toHaveBeenCalled();
    validateDefaultConfig(configManager, defaultSvcName);
  });

  it("should trigger catch block when YAML is malformed", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("invalid: yaml: : logic");

    // Create the spy and mock the 'load' implementation.
    const spy = vi.spyOn(yaml, "load").mockImplementation(() => {
      throw new Error("YAMLException: bad indentation");
    });

    const configManager = ConfigManager.getInstance(defaultSvcName);
    validateDefaultConfig(configManager, defaultSvcName);
    spy.mockRestore();
  });

  it("should update configuration values when reload is called", () => {
    const configManager = ConfigManager.getInstance(defaultSvcName);

    // Mock file system to simulate config change
    const svcName = "mocked-svc";
    const address = "localhost";
    const port = 8080;
    const updatedYaml = `
core:
  service_name: ${svcName}
  udp_address: ${address}
  udp_port: ${port}
`;

    vi.spyOn(fs, "existsSync").mockReturnValue(true); // Assuming your load logic checks if file exists
    vi.spyOn(fs, "readFileSync").mockReturnValueOnce(updatedYaml); // Called during reload()

    configManager.reload();

    const coreConfig = configManager.getCoreConfig();
    expect(coreConfig.service_name).toBe(svcName);
    expect(coreConfig.udp_address).toBe(address);
    expect(coreConfig.udp_port).toBe(port);

    // Restore original
    vi.restoreAllMocks();
  });
});
