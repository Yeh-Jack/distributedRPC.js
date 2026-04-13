import { AppConfig, ConfigManager, CoreConfig } from "../common/config";
import {
  AccessPoint,
  AckType,
  ApiSpec,
  BasalProtocol,
  NO_RESPONSE,
} from "../types/basal-protocol";

// Response message format from ServiceManager.
export interface BroadcastResponse260321 extends ServiceManagerAppConfig260321 {
  manager: BasalProtocol & {
    // Based on the BasalProtocol format with AccessPoint information merged into provider.
    provider: BasalProtocol["provider"] & AccessPoint;
  };
}

export interface RedisInfo260321 {
  address: string;
  port: number;
  credential: string;
}

export interface ServiceManagerAppConfig260321 extends AppConfig {
  redis?: RedisInfo260321;
}

export interface SpecServiceManager260321 {
  protocol_ver: "260321"; // Prevent other value from implementing.
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

export class ServiceManagerConfig extends ConfigManager<
  ServiceManagerAppConfig260321,
  CoreConfig
> {}
