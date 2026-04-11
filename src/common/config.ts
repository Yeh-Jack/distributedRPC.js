import * as fs from "fs";
import * as path from "path";
import yaml from "js-yaml";
import { LogFormat, LoggerManager } from "./logger";
import {
  AppEnv,
  ServiceManagerDiscovery,
  getAppEnv,
  SECOND,
  UNKNOWN_ATTRIBUTE,
} from "../types/basal-protocol";

export const DEFAULT_DISCOVERY_PORT = 5707;
export const DEFAULT_RETRY_MULTIPLIER = 2;

/**
 * Represents the configuration options for the application.
 * Extend this interface to define specific configuration properties
 * required by the application.
 */
export interface AppConfig {}

/**
 * Configuration options for the core distributed RPC service.
 *
 * @property net.tcp.address - TCP binding address. Defaults to "0.0.0.0".
 * @property net.tcp.port - TCP listening port. Defaults to 0 which finds a random available port.
 * @property net.tcp.client.timeout - TCP client connection timeout in milliseconds. Defaults to 10000ms.
 * @property net.tcp.client.keep_alive - Whether to enable TCP keep-alive. Defaults to false.
 * @property net.tcp.client.keep_alive_initial_delay - TCP keep-alive initial delay in milliseconds. Defaults to 0.
 * @property net.sm_port - ServiceManager discovery UDP port. Defaults to 5707.
 * @property net.udp.address - UDP binding address. Defaults to "0.0.0.0".
 * @property net.udp.port - UDP listening port. Defaults to 5707 for discovering ServiceManager.
 * @property retry - Retry configurations.
 * @property service_name - Name of the service. Preferably without spaces.
 */
export interface CoreConfig {
  net: {
    sm_discovery: symbol;
    sm_port: number;
    tcp: {
      address: string;
      port: number;
      client: {
        timeout: number;
        keep_alive: boolean;
        keep_alive_initial_delay: number;
      };
    };
    udp: {
      address: string;
      port: number;
    };
  };
  retry: RetryConfig;
  service_name: string;
  provider_id: string; // Value assigned at ServiceProvider._updateProviderInfo().
}

/**
 * Configuration options for logging.
 *
 * @property format - The logging format (one of 'json' and 'console'). Auto detects based on environment if not specified.
 * @property log_level - The logging level (e.g., 'info', 'debug', 'error'). Defaults to 'info'.
 * @property max_files - The maximum number of log files or duration to retain logs (e.g., '14d' for 14 days). Defaults to '14d'.
 * @property max_size - The maximum size of a log file before rotation (e.g., '20m' for 20 megabytes). Defaults to '20m'.
 */
export interface LogConfig {
  format: string;
  log_level: string;
  max_files: string;
  max_size: string;
}

/**
 * Configuration options for retry jobs.
 *
 * @property backoff.enable - Enable retry backoff or not. Defaults to false.
 * @property backoff.max_delay - Max delay of retry interval. Defaults to 4 minutes.
 * @property backoff.multiplier - Multiplier for increase retry interval. Must be greater than 1, defaults to 2.
 * @property interval - Retry interval in milliseconds. Defaults to 2000 ms.
 * @property max_try - Maximum retry attempts. Defaults to 0 which means infinite retries.
 */
export interface RetryConfig {
  backoff: {
    enable: boolean;
    max_delay: number;
    multiplier: number;
  };
  interval: number;
  max_try?: number;
}

/**
 * Configuration interface for a provider, encapsulating application, core, and logging settings.
 *
 * @typeParam T_App - The type of the application configuration. Defaults to `AppConfig`.
 * @typeParam T_Core - The type of the core configuration. Defaults to `CoreConfig`.
 *
 * @property app - The application-specific configuration.
 * @property core - The core system configuration.
 * @property log - The logging configuration.
 */
export interface ProviderConfig<
  T_App extends AppConfig = AppConfig,
  T_Core extends CoreConfig = CoreConfig,
> {
  app: T_App;
  core: T_Core;
  log: LogConfig;
}

/**
 * Centralized configuration management for distributed RPC applications.
 *
 * This generic class provides a robust configuration management system that loads,
 * validates, and provides access to application configuration from YAML files with
 * automatic fallback to sensible defaults. It's designed to work seamlessly with
 * dependency injection and supports type-safe configuration access.
 *
 * Key Features:
 * - YAML file loading with automatic search paths (config.yml, config/config.yml)
 * - Type-safe generic configuration with TypeScript
 * - Automatic default value fallback for missing configuration
 * - Environment-aware configuration detection
 *
 * @typeParam T_App - The application-specific configuration type extending AppConfig.
 * @typeParam T_Core - The core system configuration type extending CoreConfig.
 *
 * @remarks
 * Subclasses should extend this class to provide type-specific configuration accessors
 * while maintaining type safety. The class automatically handles configuration loading
 * during construction and provides getters for accessing configuration values.
 *
 * @example
 * ```typescript
 * // Extend for type-safe configuration access
 * class OrderServiceConfig extends ConfigManager<AppConfig, CoreConfig> {
 *   getServiceName(): string {
 *     return this.getConfig().core.service_name;
 *   }
 *
 * getTcpPort(): number {
 * return this.getConfig().core.net.tcp.port;
 * }
 * }
 *
 * // Use in services
 * class OrderService {
 *   private config: OrderServiceConfig;
 *
 *   constructor() {
 *     this.config = new OrderServiceConfig();
 *   }
 *
 *   async start() {
 *     const port = this.config.getTcpPort();
 *     // Start service on configured port
 *   }
 * }
 * ```
 */
export class ConfigManager<
  T_App extends AppConfig = AppConfig,
  T_Core extends CoreConfig = CoreConfig,
> {
  protected config: ProviderConfig<T_App, T_Core>;
  private _initName: string;
  private _loggerManager: LoggerManager;

  /**
   * Public constructor for initializing and load the configuration.
   *
   * @remarks
   * Supports dependency injection via InversifyJS.
   */
  public constructor(providerName?: string) {
    this._initName = providerName || UNKNOWN_ATTRIBUTE;
    this.config = this._loadConfig();
    this._loggerManager = new LoggerManager(this);
  }

  /**
   * Retrieves the application-specific configuration object.
   *
   * @returns {T_App} The configuration settings for the application.
   */
  public getAppConfig(): T_App {
    return this.getConfig().app;
  }

  public getAppEnv(): AppEnv {
    return getAppEnv();
  }

  /**
   * Retrieves the core configuration object from the overall configuration.
   *
   * @returns {T_Core} The core configuration section.
   */
  public getCoreConfig(): T_Core {
    return this.getConfig().core;
  }

  /**
   * Retrieves the current provider configuration.
   *
   * @returns The current configuration object of type `ProviderConfig<T_App, T_Core>`.
   */
  public getConfig(): ProviderConfig<T_App, T_Core> {
    return this.config;
  }

  /**
   * Retrieves the LoggerManager instance for this configuration.
   *
   * @returns {LoggerManager} The LoggerManager instance.
   */
  public getLoggerManager(): LoggerManager {
    return this._loggerManager;
  }

  /**
   * Retrieves the logger instance for this configuration.
   *
   * @returns {Logger} The logger instance.
   */
  public getLogger() {
    return this._loggerManager.getLogger();
  }

  /**
   * Get provider Id of this ServiceProvider.
   *
   * @returns {string} The provider Id.
   */
  public getProviderId(): string {
    return this.getCoreConfig().provider_id;
  }

  /**
   * Reloads the configuration by re-invoking the configuration loading logic.
   *
   * @remarks
   * This method updates the current configuration by calling `loadConfig()` and assigning its result to `this.config`.
   *
   * @returns A promise that resolves when the configuration has been reloaded.
   */
  public async reload(): Promise<void> {
    this.config = this._loadConfig();
    this._loggerManager.reload();
  }

  // --------------------------------------------
  // Protected Methods
  // --------------------------------------------

  protected getDefaultAppConfig(): T_App {
    return {} as T_App;
  }

  protected getDefaultCoreConfig(): T_Core {
    const NIC_ADDRESS = "0.0.0.0"; // Bind on all NICs.
    return {
      net: {
        sm_discovery: ServiceManagerDiscovery.UDP,
        sm_port: DEFAULT_DISCOVERY_PORT,
        tcp: {
          address: NIC_ADDRESS,
          port: 0, // Random allocated.
          client: {
            timeout: 10 * SECOND,
            keep_alive: true,
            keep_alive_initial_delay: 0,
          },
        },
        udp: {
          address: NIC_ADDRESS,
          port: DEFAULT_DISCOVERY_PORT,
        },
      },
      retry: {
        interval: 2 * SECOND,
        max_try: 0, // Infinity.
        backoff: {
          max_delay: 4 * 60 * SECOND, // 4 minutes.
          multiplier: DEFAULT_RETRY_MULTIPLIER,
        },
      },
      service_name: this._initName,
    } as T_Core;
  }

  // --------------------------------------------
  // Private Methods
  // --------------------------------------------

  private _getDefaultConfig(): ProviderConfig<T_App, T_Core> {
    return {
      app: this.getDefaultAppConfig(),
      core: this.getDefaultCoreConfig(),
      log: this._getDefaultLogConfig(),
    };
  }

  private _getDefaultLogConfig(): LogConfig {
    const logFormat =
      AppEnv.production === getAppEnv() ? LogFormat.JSON : LogFormat.CONSOLE;
    return {
      format: logFormat,
      log_level: "info",
      max_files: "14d",
      max_size: "20m",
    };
  }

  /**
   * Loads the provider configuration from a YAML file.
   *
   * The method searches for a `config.yml` file in the current working directory.
   * If not found, it looks inside a `config` subdirectory. If the configuration file
   * is not found in either location, it falls back to default configuration values.
   *
   * The configuration file is parsed as YAML and merged with default values to ensure
   * all required fields are present. If any error occurs during loading or parsing,
   * the default configuration is returned and an error is logged.
   *
   * @returns {ProviderConfig<T_App, T_Core>} The loaded and merged provider configuration.
   */
  private _loadConfig(): ProviderConfig<T_App, T_Core> {
    // The config file should be in the working directory or inside of the 'config' folder.
    const configFileName = "config.yml";
    let configPath = path.join(process.cwd(), configFileName);

    try {
      if (!fs.existsSync(configPath)) {
        configPath = path.join(process.cwd(), "config", configFileName);
        if (!fs.existsSync(configPath)) {
          console.debug("Config file not found, use default value instead.");
          return this._getDefaultConfig();
        }
      }

      const yamlContent = fs.readFileSync(configPath, "utf8");
      // Use unknown as intermediate to safely cast to Partial
      const parsed = (yaml.load(yamlContent) || {}) as Partial<
        ProviderConfig<T_App, T_Core>
      >;
      return this._mergeWithDefaults(parsed);
    } catch (error) {
      console.error("Error loading config, using defaults:", error);
      return this._getDefaultConfig();
    }
  }

  /**
   * Merges the provided partial configuration with the default configuration.
   *
   * - Performs a shallow merge for the `app` property.
   * - Performs a deep merge for the `core` and `log` properties.
   *
   * @param parsed - A partial provider configuration object to merge with defaults.
   * @returns A complete provider configuration object with defaults applied where necessary.
   */
  private _mergeWithDefaults(
    parsed: Partial<ProviderConfig<T_App, T_Core>>,
  ): ProviderConfig<T_App, T_Core> {
    const defaults = this._getDefaultConfig();
    return {
      // Shallow merge for app, deep merge for core and log.
      app: { ...defaults.app, ...parsed.app },
      core: { ...defaults.core, ...parsed.core },
      log: { ...defaults.log, ...parsed.log },
    };
  }
}
