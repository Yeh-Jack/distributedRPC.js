import yaml from "js-yaml";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConfigManager, DEFAULT_DISCOVERY_PORT } from "../../common/config";

vi.mock("fs", () => {
  const actualExistsSync = vi.fn();
  const actualReadFileSync = vi.fn();
  return {
    existsSync: actualExistsSync,
    readFileSync: actualReadFileSync,
    mkdirSync: vi.fn(),
    default: {
      existsSync: actualExistsSync,
      readFileSync: actualReadFileSync,
      mkdirSync: vi.fn(),
    },
  };
});

import * as fs from "fs";

function validateDefaultConfig(configManager: ConfigManager, svcName: string) {
  const appConfig = configManager.getAppConfig();
  expect(appConfig).toBeDefined();
  expect(appConfig).toEqual({});

  const coreConfig = configManager.getCoreConfig();
  expect(coreConfig.service_name).toBe(svcName);
  expect(coreConfig.net.udp.address).toBe("0.0.0.0");
  expect(coreConfig.net.udp.port).toBe(DEFAULT_DISCOVERY_PORT);
  expect(coreConfig.retry.interval).toBe(2000);
  expect(coreConfig.retry.max_retries).toBe(0);
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
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const configManager = new ConfigManager();
    configManager.getCoreConfig().service_name = defaultSvcName;
    validateDefaultConfig(configManager, defaultSvcName);
  });

  it("should trigger catch block when file reading fails (e.g., EACCES)", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    const configManager = new ConfigManager();
    configManager.getCoreConfig().service_name = defaultSvcName;
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

  it("should update configuration values when reload is called", async () => {
    const svcName = "mocked-svc";
    const address = "localhost";
    const port = 8080;
    const updatedYaml = `core:
  service_name: ${svcName}
  net:
    udp:
      address: ${address}
      port: ${port}
`;

    // Create config manager with file not existing (uses default)
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const configManager = new ConfigManager();
    configManager.getCoreConfig().service_name = defaultSvcName;

    // Verify default values first
    let coreConfig = configManager.getCoreConfig();
    expect(coreConfig.service_name).toBe(defaultSvcName);
    expect(coreConfig.net.udp.address).toBe("0.0.0.0");
    expect(coreConfig.net.udp.port).toBe(DEFAULT_DISCOVERY_PORT);

    // Reset mocks and set up for reload - file exists with updated YAML
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(updatedYaml);

    await configManager.reload();

    // Verify updated values
    coreConfig = configManager.getCoreConfig();
    expect(coreConfig.service_name).toBe(svcName);
    expect(coreConfig.net.udp.address).toBe(address);
    expect(coreConfig.net.udp.port).toBe(port);
  });
});
