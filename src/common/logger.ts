import fs from "fs";
import path from "path";
import DailyRotateFile from "winston-daily-rotate-file";
import { createLogger, format, transports, Logger } from "winston";
import { inject, injectable } from "inversify";
import { ConfigManager } from "./config";
import { TYPES } from "../aop/di-types";
import { UNKNOWN_ATTRIBUTE } from "../types/basal-protocol";

const { combine, timestamp, printf, json, errors, colorize } = format;

export enum LogFormat {
  JSON = "json",
  CONSOLE = "console",
}

/**
 * Singleton manager for application-wide logging.
 *
 * The `LoggerManager` class provides a centralized way to configure and retrieve a logger instance
 * for the application. It supports dynamic reloading of logger configuration, log file rotation,
 * and multiple log formats (console and JSON).
 *
 * - Supports dependency injection via InversifyJS.
 * - Automatically creates a `logs` directory if it does not exist.
 * - Supports console and file transports, with daily log rotation for files.
 * - Allows dynamic reloading of logger configuration via the `reload()` method.
 *
 * @example
 * ```typescript
 * @injectable()
 * class MyService {
 *   constructor(
 *     @inject(TYPES.Logger) private logger: Logger,
 *     private configManager: ConfigManager
 *   ) {}
 * }
 * ```
 */
@injectable()
export class LoggerManager {
  private _logger!: Logger;
  private _configManager: ConfigManager;

  /**
   * Creates a LoggerManager instance with the injected ConfigManager.
   *
   * @param configManager - The configuration manager for retrieving log settings.
   */
  public constructor(
    @inject(TYPES.ConfigManager) configManager: ConfigManager,
  ) {
    this._configManager = configManager;

    // Create logs directory if it doesn't exist
    const logDir = path.join(process.cwd(), "logs");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.reload();
  }

  /**
   * Returns the current instance of the logger.
   *
   * @throws {Error} If the logger has not been initialized.
   *                 Ensure that `reload()` has been called before invoking this method.
   * @returns {Logger} The initialized logger instance.
   */
  public getLogger(): Logger {
    if (!this._logger) {
      throw new Error(
        "The Logger is not initialized yet. Call reload() first.",
      );
    }
    return this._logger;
  }

  /**
   * Reloads the logger configuration and reinitializes the logger instance.
   *
   * This method updates the logger's transports and formats based on the latest configuration
   * retrieved from the configuration manager. It supports both console and file transports,
   * with options for colorized console output and daily rotated file logs in JSON format.
   * The logger is configured to include stack traces for errors and to use the appropriate
   * log level, format, and metadata as specified in the configuration.
   *
   * @returns {Promise<void>} A promise that resolves when the logger has been reloaded.
   */
  public async reload(): Promise<void> {
    const jsonCombine = combine(
      timestamp(), // Use default ISO format for machine parsing
      json(),
    );

    const logConfig = this._configManager.getConfig().log;
    const logFormat = logConfig?.format || LogFormat.CONSOLE;
    const activeTransports: any[] = [];
    if (logFormat === LogFormat.CONSOLE) {
      const consoleLayout = printf(
        ({ timestamp, level, message, stack, svcName: metaSvc }) => {
          const logMessage = stack ? `${message}\n${stack}` : message;
          return `[${timestamp}] [${
            metaSvc || svcName || UNKNOWN_ATTRIBUTE
          }] [${level}] ${logMessage}`;
        },
      );

      activeTransports.push(
        // CONSOLE Transport: String format. Colorized for dev readability in terminal.
        new transports.Console({
          format: combine(
            colorize({ all: true }),
            timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
            consoleLayout,
          ),
        }),
      );
    } else {
      activeTransports.push(
        // CONSOLE Transport: JSON format. This might be a File transport or a specialized OTEL collector.
        new transports.Console({
          format: jsonCombine,
        }),
      );
    }

    // Add File Transport for daily rotated logs.
    const coreConfig = this._configManager.getCoreConfig();
    const svcName = coreConfig.service_name;
    activeTransports.push(
      new DailyRotateFile({
        filename: path.join("logs", `${svcName}-%DATE%.log`),
        datePattern: "YYYY-MM-DD",
        zippedArchive: true,
        maxFiles: logConfig.max_files,
        maxSize: logConfig.max_size,
        format: jsonCombine, // File logs usually benefit from JSON for easier post-analysis.
      }),
    );

    this._logger = createLogger({
      level: logConfig.log_level,
      defaultMeta: { svcName: svcName || UNKNOWN_ATTRIBUTE },
      format: errors({ stack: true }), // Ensure all formats get the stack trace
      transports: activeTransports,
    });
  }

  public close(): void {
    this._logger.close();
  }
}
