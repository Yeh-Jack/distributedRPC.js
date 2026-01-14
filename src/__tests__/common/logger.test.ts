import fs from "fs";
import path from "path";
import { describe, it, expect, beforeEach } from "vitest";
import { ConfigManager } from "../../common/config";
import { LoggerManager } from "../../common/logger";
import { UNKNOWN_SERVICE_NAME } from "../../types/basal-protocol";

describe("Logger", () => {
  let logger: ReturnType<typeof LoggerManager.prototype.getLogger>;
  const logDirPath = path.join(process.cwd(), "logs");

  const removeLogDir = () => {
    if (fs.existsSync(logDirPath)) {
      fs.rmSync(logDirPath, { recursive: true, force: true });
    }
  };

  beforeEach(() => {
    (LoggerManager as any).instance = undefined; // Clear singleton instance for clean tests.
  });

  it("should create singleton instance", () => {
    const instance1 = LoggerManager.getInstance();
    const instance2 = LoggerManager.getInstance();

    expect(instance1).toBe(instance2);
  });

  it("should initialize to console format with correct name", () => {
    const configManager = ConfigManager.getInstance();
    const log = configManager.getConfig().log;
    log.format = "console";
    logger = LoggerManager.getInstance().getLogger();
    expect(logger).toBeDefined();

    // Verify the number of transports : 1 String console + 1 DailyRotateFile
    const transports = logger.transports;
    expect(transports).toHaveLength(2);
    expect(configManager.getCoreConfig().service_name).toBe(
      UNKNOWN_SERVICE_NAME
    );
  });

  it("should initialize to JSON format with correct name", async () => {
    const configManager = ConfigManager.getInstance();
    const log = configManager.getConfig().log;
    log.format = "json";
    logger = LoggerManager.getInstance().getLogger();
    expect(logger).toBeDefined();

    // Verify the number of transports : 1 JSON console + 1 DailyRotateFile
    const transports = logger.transports;
    expect(transports).toHaveLength(2);
    expect(configManager.getCoreConfig().service_name).toBe(
      UNKNOWN_SERVICE_NAME
    );
    configManager.reload();
  });

  it("should create the logs directory if it is missing", () => {
    removeLogDir();
    expect(fs.existsSync(logDirPath)).toBe(false); // Ensure it's gone.

    logger = LoggerManager.getInstance().getLogger();
    expect(fs.existsSync(logDirPath)).toBe(true);
  });

  it("should throw error if the logger is undefined", () => {
    const instance = LoggerManager.getInstance();
    (instance as any).logger = undefined; // Clear logger for this test.
    expect(() => LoggerManager.getInstance().getLogger()).toThrow(Error);

    instance.reload(); // Reinitialize for other tests.
    logger = LoggerManager.getInstance().getLogger();
    expect(logger).toBeDefined();
  });

  it("should log messages without throwing errors", () => {
    logger = LoggerManager.getInstance().getLogger();
    expect(() => logger.debug("debug message")).not.toThrow();
    expect(() => logger.info("info message")).not.toThrow();
    expect(() => logger.warn("warn message")).not.toThrow();
    expect(() => logger.error("error message")).not.toThrow();
  });

  it("should handle messages with special characters", () => {
    logger = LoggerManager.getInstance().getLogger();
    expect(() =>
      logger.info('Message with "quotes" and \n newlines')
    ).not.toThrow();
    expect(() => logger.warn("Message with 'single quotes'")).not.toThrow();
    expect(() =>
      logger.error("Message with special chars: ñáéíóú")
    ).not.toThrow();
  });

  it("should handle empty messages", () => {
    logger = LoggerManager.getInstance().getLogger();
    expect(() => logger.info("")).not.toThrow();
  });
});
