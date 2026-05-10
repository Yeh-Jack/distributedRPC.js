import { AppConfig, ConfigManager, CoreConfig } from "../common/config";
import {
  AccessPoint,
  AckType,
  ApiSpec,
  BasalProtocol,
  NO_RESPONSE,
} from "../types/basal-protocol";

/**
 * Response message received from ServiceManager during service discovery.
 * Contains the manager's protocol configuration merged with access point information.
 */
export interface BroadcastResponse260321 extends ServiceManagerAppConfig260321 {
  manager: BasalProtocol & {
    provider: BasalProtocol["provider"] & AccessPoint;
  };
}

/**
 * Redis connection configuration for distributed RPC.
 */
export interface RedisInfo260321 {
  address: string;
  port: number;
  credential: string;
}

/**
 * Application configuration extending base AppConfig with Redis support.
 */
export interface ServiceManagerAppConfig260321 extends AppConfig {
  redis?: RedisInfo260321;
}

/**
 * API specification for ServiceManager protocol version 260321.
 * Defines reception, register, and report API interfaces.
 */
export interface SpecServiceManager260321 {
  protocol_ver: "260321";
  apis: {
    reception: ApiSpec & {
      response: "BroadcastResponse260321";
      ack: AckType.None;
    };
    register: ApiSpec & {
      request: "RegisterInfo";
      ack: AckType.Single;
    };
    report: ApiSpec & {
      request: "ReportData";
      response: typeof NO_RESPONSE;
      ack: AckType.None;
    };
  };
}

/**
 * Singleton specification object for ServiceManager protocol version 260321.
 */
export const SPEC_SVC_MGR_260321: SpecServiceManager260321 = {
  protocol_ver: "260321",
  apis: {
    reception: {
      request: "string",
      response: "BroadcastResponse260321",
      ack: AckType.None,
    },
    register: {
      request: "RegisterInfo",
      response: NO_RESPONSE,
      ack: AckType.Single,
    },
    report: {
      request: "ReportData",
      response: NO_RESPONSE,
      ack: AckType.None,
    },
  },
};

/**
 * Configuration manager specialized for ServiceManager with protocol version 260321.
 * Extends ConfigManager with AppConfig260321 and CoreConfig type parameters.
 */
export class ServiceManagerConfig extends ConfigManager<
  ServiceManagerAppConfig260321,
  CoreConfig
> {}
