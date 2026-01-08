import path from "path";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { ConfigManager } from "./config";

export class LoggerManager {
  private static instance: LoggerManager;
  private logger: winston.Logger | null = null;
  private configManager: ConfigManager;

  private constructor() {
    this.configManager = ConfigManager.getInstance();

    // Create logs directory if it doesn't exist
    const logDir = path.join(process.cwd(), "logs");
    if (!require("fs").existsSync(logDir)) {
      require("fs").mkdirSync(logDir, { recursive: true });
    }
    this.reload();
  }

  public async reload(): Promise<void> {
    const coreConfig = this.configManager.getCoreConfig();
    const logConfig = this.configManager.getConfig().log;
    this.logger = winston.createLogger({
      level: logConfig.log_level,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        // Console transport for development
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          ),
        }),

        // Daily rotate file transport
        new DailyRotateFile({
          filename: path.join("logs", `${coreConfig.service_name}-%DATE%.log`),
          datePattern: "YYYY-MM-DD",
          zippedArchive: true,
          maxFiles: logConfig.max_files,
          maxSize: logConfig.max_size,
        }),
      ],
    });
  }

  public static getInstance(): LoggerManager {
    if (!LoggerManager.instance) {
      LoggerManager.instance = new LoggerManager();
    }
    return LoggerManager.instance;
  }

  public getLogger(): winston.Logger {
    return this.logger;
  }
}
