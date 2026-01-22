import fs from "fs";
import path from "path";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConfigManager } from "../../common/config";
import { LoggerManager } from "../../common/logger";
import { UNKNOWN_ATTRIBUTE } from "../../types/basal-protocol";

describe("Logger", () => {
  let logger: ReturnType<LoggerManager["getLogger"]>;
  const logDirPath = path.join(process.cwd(), "logs");

  const removeLogDir = () => {
    if (fs.existsSync(logDirPath)) {
      fs.rmSync(logDirPath, { recursive: true, force: true });
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    removeLogDir();
  });

  it("should create unique instances with different ConfigManagers", () => {
    const configManager1 = new ConfigManager();
    const configManager2 = new ConfigManager();

    const loggerManager1 = new LoggerManager(configManager1);
    const loggerManager2 = new LoggerManager(configManager2);

    expect(loggerManager1).not.toBe(loggerManager2);
    expect(loggerManager1.getLogger()).not.toBe(loggerManager2.getLogger());
  });

  it("should initialize to console format with correct name", () => {
    const configManager = new ConfigManager();
    const log = configManager.getConfig().log;
    log.format = "console";
    const loggerManager = new LoggerManager(configManager);
    logger = loggerManager.getLogger();
    expect(logger).toBeDefined();

    const transports = logger.transports;
    expect(transports).toHaveLength(2);
    expect(configManager.getCoreConfig().service_name).toBeDefined();
  });

  it("should initialize to JSON format with correct name", async () => {
    const configManager = new ConfigManager();
    const log = configManager.getConfig().log;
    log.format = "json";
    const loggerManager = new LoggerManager(configManager);
    logger = loggerManager.getLogger();
    expect(logger).toBeDefined();

    const transports = logger.transports;
    expect(transports).toHaveLength(2);
    expect(configManager.getCoreConfig().service_name).toBeDefined();
    configManager.reload();
  });

  it("should create the logs directory if it is missing", () => {
    removeLogDir();
    expect(fs.existsSync(logDirPath)).toBe(false);

    const configManager = new ConfigManager();
    const loggerManager = new LoggerManager(configManager);
    logger = loggerManager.getLogger();
    expect(fs.existsSync(logDirPath)).toBe(true);
  });

  it("should throw error if the logger is undefined", () => {
    const configManager = new ConfigManager();
    const loggerManager = new LoggerManager(configManager);
    (loggerManager as any).logger = undefined;
    expect(() => loggerManager.getLogger()).toThrow(Error);

    loggerManager.reload();
    logger = loggerManager.getLogger();
    expect(logger).toBeDefined();
  });

  it("should log messages without throwing errors", () => {
    const configManager = new ConfigManager();
    const loggerManager = new LoggerManager(configManager);
    logger = loggerManager.getLogger();
    expect(() => logger.debug("debug message")).not.toThrow();
    expect(() => logger.info("info message")).not.toThrow();
    expect(() => logger.warn("warn message")).not.toThrow();
    expect(() => logger.error("error message")).not.toThrow();
  });

  it("should handle messages with special characters", () => {
    const configManager = new ConfigManager();
    const loggerManager = new LoggerManager(configManager);
    logger = loggerManager.getLogger();
    expect(() =>
      logger.info('Message with "quotes" and \n newlines')
    ).not.toThrow();
    expect(() => logger.warn("Message with 'single quotes'")).not.toThrow();
    expect(() =>
      logger.error("Message with special chars: ñáéíóú")
    ).not.toThrow();
  });

  it("should handle empty messages", () => {
    const configManager = new ConfigManager();
    const loggerManager = new LoggerManager(configManager);
    logger = loggerManager.getLogger();
    expect(() => logger.info("")).not.toThrow();
  });
});
