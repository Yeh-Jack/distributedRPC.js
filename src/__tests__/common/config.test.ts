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
    vi.clearAllMocks();
  });

  it("should create instance with provided service name", () => {
    const configManager1 = new ConfigManager();
    const configManager2 = new ConfigManager();

    configManager1.getCoreConfig().service_name = "test1";
    configManager2.getCoreConfig().service_name = "test2";

    expect(configManager1).not.toBe(configManager2);
    expect(configManager1.getCoreConfig().service_name).toBe("test1");
    expect(configManager2.getCoreConfig().service_name).toBe("test2");
  });

  it("should load default configuration", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    const configManager = new ConfigManager();
    configManager.getCoreConfig().service_name = defaultSvcName;
    validateDefaultConfig(configManager, defaultSvcName);
  });

  it("should trigger catch block when file reading fails (e.g., EACCES)", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const configManager = new ConfigManager();
    configManager.getCoreConfig().service_name = defaultSvcName;
    expect(errorSpy).toHaveBeenCalled();
    validateDefaultConfig(configManager, defaultSvcName);
  });

  it("should trigger catch block when YAML is malformed", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("invalid: yaml: : logic");

    const spy = vi.spyOn(yaml, "load").mockImplementation(() => {
      throw new Error("YAMLException: bad indentation");
    });

    const configManager = new ConfigManager();
    configManager.getCoreConfig().service_name = defaultSvcName;
    validateDefaultConfig(configManager, defaultSvcName);
    spy.mockRestore();
  });

  it("should update configuration values when reload is called", () => {
    const configManager = new ConfigManager();

    const svcName = "mocked-svc";
    const address = "localhost";
    const port = 8080;
    const updatedYaml = `
core:
  service_name: ${svcName}
  udp_address: ${address}
  udp_port: ${port}
`;

    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValueOnce(updatedYaml);

    configManager.reload();

    const coreConfig = configManager.getCoreConfig();
    expect(coreConfig.service_name).toBe(svcName);
    expect(coreConfig.udp_address).toBe(address);
    expect(coreConfig.udp_port).toBe(port);

    vi.restoreAllMocks();
  });
});
