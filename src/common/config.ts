import * as fs from "fs";
import * as path from "path";
import yaml from "js-yaml";
import { LogFormat } from "./logger";
import { UNKNOWN_SERVICE_NAME } from "../types/basal-protocol";

/**
 * Represents the configuration options for the application.
 * Extend this interface to define specific configuration properties
 * required by the application.
 */
export interface AppConfig {}

/**
 * Configuration options for the core distributed RPC service.
 *
 * @property retry_interval - Network retry interval in milliseconds. Defaults to 5000 ms.
 * @property retry_max - Maximum number of retry attempts. Defaults to 0, which means infinite retries.
 * @property service_name - Name of the service. Preferably without spaces.
 * @property tcp_address - TCP binding address. Defaults to "0.0.0.0".
 * @property tcp_port - TCP listening port. Defaults to 0 which finds a random available port.
 * @property udp_address - UDP binding address. Defaults to "0.0.0.0".
 * @property udp_port - UDP listening port. Defaults to 5707.
 */
export interface CoreConfig {
  retry_interval: number;
  retry_max: number;
  service_name: string;
  tcp_address: string;
  tcp_port: number;
  udp_address: string;
  udp_port: number;
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
  T_Core extends CoreConfig = CoreConfig
> {
  app: T_App;
  core: T_Core;
  log: LogConfig;
}

/**
 * Manages application, core and logging configuration settings, supporting loading from YAML files,
 * providing default values, and singleton access. This generic class is intended to be
 * extended for specific application and core configuration types.
 *
 * @typeParam T_App - The type representing the application-specific configuration.
 * @typeParam T_Core - The type representing the core configuration.
 *
 * @remarks
 * - Loads configuration from `config.yml` in the working directory or `config/config.yml`.
 * - Falls back to default values if the configuration file is missing or invalid.
 * - Implements a singleton pattern; subclasses should override `getInstance` for type safety.
 *
 * @example
 * ```typescript
 * class MyConfigManager extends ConfigManager<MyAppConfig, MyCoreConfig> {
 *   // Custom implementation...
 * }
 * const config = MyConfigManager.getInstance("my-service");
 * ```
 */
export class ConfigManager<
  T_App extends AppConfig = AppConfig,
  T_Core extends CoreConfig = CoreConfig
> {
  protected config: ProviderConfig<T_App, T_Core>;
  private static instance: ConfigManager<any, any>;
  private svcName: string;

  /**
   * Protected constructor for initializing the configuration with a specific service name.
   *
   * @param svcName - The name of the service. This value is assigned once and cannot be changed.
   *
   * @remarks
   * The constructor also loads the configuration for the service upon instantiation.
   * Intended to be used by subclasses.
   */
  protected constructor(svcName: string) {
    this.svcName = svcName; // Assigned once and then "locked".
    this.config = this.loadConfig();
  }

  /**
   * Retrieves the application-specific configuration object.
   *
   * @returns {T_App} The configuration settings for the application.
   */
  public getAppConfig(): T_App {
    return this.getConfig().app;
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
   * Returns the singleton instance of the `ConfigManager` class.
   * If the instance does not exist, it creates a new one with the provided service name.
   *
   * @param svcName - The name of the service to associate with the configuration manager. Defaults to `UNKNOWN_SERVICE_NAME`.
   * @returns The singleton instance of `ConfigManager`.
   */
  public static getInstance(
    svcName: string = UNKNOWN_SERVICE_NAME
  ): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager(svcName);
    }
    return ConfigManager.instance;
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
    this.config = this.loadConfig();
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
  private loadConfig(): ProviderConfig<T_App, T_Core> {
    // The config file should be in the working directory or inside of the 'config' folder.
    const configFileName = "config.yml";
    let configPath = path.join(process.cwd(), configFileName);

    try {
      if (!fs.existsSync(configPath)) {
        configPath = path.join(process.cwd(), "config", configFileName);
        if (!fs.existsSync(configPath)) {
          console.debug("Config file not found, use default value instead.");
          return this.getDefaultConfig();
        }
      }

      const yamlContent = fs.readFileSync(configPath, "utf8");
      // Use unknown as intermediate to safely cast to Partial
      const parsed = (yaml.load(yamlContent) || {}) as Partial<
        ProviderConfig<T_App, T_Core>
      >;
      return this.mergeWithDefaults(parsed);
    } catch (error) {
      console.error("Error loading config, using defaults:", error);
      return this.getDefaultConfig();
    }
  }

  private getDefaultConfig(): ProviderConfig<T_App, T_Core> {
    return {
      app: this.getDefaultAppConfig(),
      core: this.getDefaultCoreConfig(),
      log: this.getDefaultLogConfig(),
    };
  }

  protected getDefaultAppConfig(): T_App {
    return {} as T_App;
  }

  protected getDefaultCoreConfig(): T_Core {
    const NIC_ADDRESS = "0.0.0.0";
    return {
      retry_interval: 5000,
      retry_max: 0,
      service_name: this.svcName,
      tcp_address: NIC_ADDRESS,
      tcp_port: 0,
      udp_address: NIC_ADDRESS,
      udp_port: 5707,
    } as T_Core;
  }

  private getDefaultLogConfig(): LogConfig {
    const logFormat =
      process.env.NODE_ENV === "production"
        ? LogFormat.JSON
        : LogFormat.CONSOLE;
    return {
      format: logFormat,
      log_level: "info",
      max_files: "14d",
      max_size: "20m",
    };
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
  private mergeWithDefaults(
    parsed: Partial<ProviderConfig<T_App, T_Core>>
  ): ProviderConfig<T_App, T_Core> {
    const defaults = this.getDefaultConfig();
    return {
      // Shallow merge for app, deep merge for core and log.
      app: { ...defaults.app, ...parsed.app },
      core: { ...defaults.core, ...parsed.core },
      log: { ...defaults.log, ...parsed.log },
    };
  }
}
