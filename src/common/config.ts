import * as fs from "fs";
import * as path from "path";
import yaml from "js-yaml";

export interface AppConfig {}

export interface CoreConfig {
  retry_interval: number; // Network retry interval in ms, default to 5000.
  retry_max: number; // Max retry thresholde, default to 0 which means infinity.
  service_name: string; // Service name without space is preferred.
  tcp_address: string; // TCP binding address, default to 0.0.0.0.
  tcp_port: number; // TCP listen port, default to 0.
  udp_address: string; // UDP binding address, default to 0.0.0.0.
  udp_port: number; // UDP listen port, default to 5707.
}

export interface LogConfig {
  log_level: string; // Default to info.
  max_files: string; // Default to 14d.
  max_size: string; // Default to 20m.
}

export interface ProviderConfig<
  T_App extends AppConfig = AppConfig,
  T_Core extends CoreConfig = CoreConfig
> {
  app: T_App;
  core: T_Core;
  log: LogConfig;
}

/**
 * T_App and T_Core allow subclasses to provide specialized interface shapes.
 */
export class ConfigManager<
  T_App extends AppConfig = AppConfig,
  T_Core extends CoreConfig = CoreConfig
> {
  protected config: ProviderConfig<T_App, T_Core>;
  private static instance: ConfigManager<any, any>;
  private svcName: string;

  protected constructor(svcName: string) {
    this.svcName = svcName; // Assigned once and then "locked".
    this.config = this.loadConfig();
  }

  public async reload(): Promise<void> {
    this.config = this.loadConfig();
  }

  // Note: Singleton pattern with generics can be tricky.
  // Subclasses will usually need to implement their own getInstance.
  public static getInstance(svcName: string = "UnknownService"): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager(svcName);
    }
    return ConfigManager.instance;
  }

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
    return {
      log_level: "info",
      max_files: "14d",
      max_size: "20m",
    };
  }

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

  public getConfig(): ProviderConfig<T_App, T_Core> {
    return this.config;
  }

  public getAppConfig(): T_App {
    return this.config.app;
  }

  public getCoreConfig(): T_Core {
    return this.config.core;
  }
}
