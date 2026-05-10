import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SECOND,
  MINUTE,
  HOUR,
  DAY,
  WEEK,
  DEFAULT_ENCODE,
  FOLLOW_UP,
  MAX_HEADER_LEN,
  NO_RESPONSE,
  PROBE_MESSAGE,
  UNKNOWN_ATTRIBUTE,
  AccessPoint,
  AckType,
  AckValue,
  ApiCall,
  ApiCounter,
  ApiSpec,
  AppEnv,
  BasalProtocol,
  ExecutionState,
  IdGenerator,
  MeterType,
  NetworkProtocol,
  PeerIdentity,
  ProviderConnectInfo,
  RegisterInfo,
  ReportData,
  ResponseArgs,
  RestCall,
  ServiceManagerDiscovery,
  SocketAddress,
  getAppEnv,
} from "../../types/basal-protocol";

describe("Time unit constants", () => {
  it("SECOND should be 1000ms", () => {
    expect(SECOND).toBe(1000);
  });

  it("MINUTE should be 60 seconds", () => {
    expect(MINUTE).toBe(60 * 1000);
  });

  it("HOUR should be 60 minutes", () => {
    expect(HOUR).toBe(60 * 60 * 1000);
  });

  it("DAY should be 24 hours", () => {
    expect(DAY).toBe(24 * 60 * 60 * 1000);
  });

  it("WEEK should be 7 days", () => {
    expect(WEEK).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("String constants", () => {
  it("DEFAULT_ENCODE should be utf-8", () => {
    expect(DEFAULT_ENCODE).toBe("utf-8");
  });

  it("FOLLOW_UP should be arrow separator", () => {
    expect(FOLLOW_UP).toBe("  --> ");
  });

  it("MAX_HEADER_LEN should be 64", () => {
    expect(MAX_HEADER_LEN).toBe(64);
  });

  it("NO_RESPONSE should be None", () => {
    expect(NO_RESPONSE).toBe("None");
  });

  it("PROBE_MESSAGE should be bonjour message", () => {
    expect(PROBE_MESSAGE).toBe("Bonjour and EnjoIT.");
  });

  it("UNKNOWN_ATTRIBUTE should be Unknown", () => {
    expect(UNKNOWN_ATTRIBUTE).toBe("Unknown");
  });
});

describe("AckType enum", () => {
  it("should have None, Single, Double values", () => {
    expect(AckType.None).toBe("None");
    expect(AckType.Single).toBe("Single");
    expect(AckType.Double).toBe("Double");
  });
});

describe("AckValue enum", () => {
  it("should have Ack, Error, InvalidReqData, None values", () => {
    expect(AckValue.Ack).toBe("Ack");
    expect(AckValue.Error).toBe("Error");
    expect(AckValue.InvalidReqData).toBe("InvalidReqData");
    expect(AckValue.None).toBe("None");
  });
});

describe("AppEnv enum", () => {
  it("should have development, production, staging, test values", () => {
    expect(AppEnv.development).toBe("development");
    expect(AppEnv.production).toBe("production");
    expect(AppEnv.staging).toBe("staging");
    expect(AppEnv.test).toBe("test");
  });
});

describe("ExecutionState enum", () => {
  it("should have all expected states", () => {
    expect(ExecutionState.Error).toBe("Error");
    expect(ExecutionState.Halt).toBe("Halt");
    expect(ExecutionState.Halting).toBe("Halting");
    expect(ExecutionState.Initializing).toBe("Initializing");
    expect(ExecutionState.Listening).toBe("Listening");
    expect(ExecutionState.Retrying).toBe("Retrying");
    expect(ExecutionState.Running).toBe("Running");
    expect(ExecutionState.Starting).toBe("Starting");
    expect(ExecutionState.Stopping).toBe("Stopping");
    expect(ExecutionState.Stopped).toBe("Stopped");
  });
});

describe("MeterType enum", () => {
  it("should have Application, Network, Host values", () => {
    expect(MeterType.Application).toBe("application");
    expect(MeterType.Network).toBe("network");
    expect(MeterType.Host).toBe("host");
  });
});

describe("NetworkProtocol enum", () => {
  it("should have TCP and UDP values", () => {
    expect(NetworkProtocol.TCP).toBe("TCP");
    expect(NetworkProtocol.UDP).toBe("UDP");
  });
});

describe("ServiceManagerDiscovery", () => {
  it("should have None and UDP symbols", () => {
    expect(ServiceManagerDiscovery.None).toBe(Symbol.for("None"));
    expect(ServiceManagerDiscovery.UDP).toBe(Symbol.for("UdpDiscovery"));
  });
});

describe("AccessPoint interface", () => {
  it("should extend SocketAddress and add authorization and api", () => {
    const accessPoint: AccessPoint = {
      address: "127.0.0.1",
      port: 3000,
      protocol: NetworkProtocol.TCP,
      authorization: "secret-key",
      api: ["register", "report"],
    };

    expect(accessPoint.address).toBe("127.0.0.1");
    expect(accessPoint.port).toBe(3000);
    expect(accessPoint.protocol).toBe(NetworkProtocol.TCP);
    expect(accessPoint.authorization).toBe("secret-key");
    expect(accessPoint.api).toEqual(["register", "report"]);
  });
});

describe("ApiCall interface", () => {
  it("should have peer, api, args, msgId, and optional promise", () => {
    const apiCall: ApiCall = {
      peer: { service: "TestService", instance: "inst-1" },
      api: "register",
      args: { key: "value" },
      msgId: "msg-123",
    };

    expect(apiCall.peer.service).toBe("TestService");
    expect(apiCall.api).toBe("register");
    expect(apiCall.args).toEqual({ key: "value" });
    expect(apiCall.msgId).toBe("msg-123");
  });

  it("should allow optional promise with resolve and reject", () => {
    const apiCall: ApiCall = {
      peer: { service: "TestService", instance: "inst-1" },
      api: "asyncCall",
      args: {},
      msgId: "msg-456",
      promise: {
        resolve: vi.fn(),
        reject: vi.fn(),
      },
    };

    expect(apiCall.promise).toBeDefined();
    expect(typeof apiCall.promise!.resolve).toBe("function");
    expect(typeof apiCall.promise!.reject).toBe("function");
  });
});

describe("ApiCounter interface", () => {
  it("should have success, invalidRequest, failedOnProcess, and optional total", () => {
    const counter: ApiCounter = {
      success: 10,
      invalidRequest: 2,
      failedOnProcess: 1,
      total: 13,
    };

    expect(counter.success).toBe(10);
    expect(counter.invalidRequest).toBe(2);
    expect(counter.failedOnProcess).toBe(1);
    expect(counter.total).toBe(13);
  });

  it("should allow optional total to be undefined", () => {
    const counter: ApiCounter = {
      success: 5,
      invalidRequest: 1,
      failedOnProcess: 0,
    };

    expect(counter.total).toBeUndefined();
  });
});

describe("ApiSpec interface", () => {
  it("should have request, response, and ack properties", () => {
    const spec: ApiSpec = {
      request: "RegisterRequest",
      response: "RegisterResponse",
      ack: AckType.Single,
    };

    expect(spec.request).toBe("RegisterRequest");
    expect(spec.response).toBe("RegisterResponse");
    expect(spec.ack).toBe(AckType.Single);
  });
});

describe("BasalProtocol interface", () => {
  it("should have protocol_ver, apis, and provider", () => {
    const protocol: BasalProtocol = {
      protocol_ver: "1.0.0",
      apis: {
        register: { request: "", response: "", ack: AckType.Single },
      },
      provider: {
        id: "provider-1",
        name: "TestProvider",
        desc: "A test provider",
        version: "1.0.0",
      },
    };

    expect(protocol.protocol_ver).toBe("1.0.0");
    expect(protocol.apis).toHaveProperty("register");
    expect(protocol.provider.id).toBe("provider-1");
    expect(protocol.provider.name).toBe("TestProvider");
  });
});

describe("IdGenerator interface", () => {
  it("should have generate and shortId methods", () => {
    const generator: IdGenerator = {
      generate: () => "uuid-v4-format",
      shortId: () => "16-byte-id",
    };

    expect(typeof generator.generate).toBe("function");
    expect(typeof generator.shortId).toBe("function");
    expect(generator.generate()).toBe("uuid-v4-format");
    expect(generator.shortId()).toBe("16-byte-id");
  });
});

describe("PeerIdentity interface", () => {
  it("should have service and instance", () => {
    const peer: PeerIdentity = {
      service: "MyService",
      instance: "instance-abc",
    };

    expect(peer.service).toBe("MyService");
    expect(peer.instance).toBe("instance-abc");
  });
});

describe("ProviderConnectInfo type", () => {
  it("should be AccessPoint combined with BasalProtocol provider", () => {
    const info: ProviderConnectInfo = {
      address: "127.0.0.1",
      port: 3000,
      protocol: NetworkProtocol.TCP,
      authorization: "key",
      api: ["api1"],
      id: "prov-1",
      name: "Provider",
      desc: "Desc",
      version: "1.0.0",
    };

    expect(info.address).toBe("127.0.0.1");
    expect(info.id).toBe("prov-1");
    expect(info.name).toBe("Provider");
  });
});

describe("RegisterInfo interface", () => {
  it("should extend BasalProtocol with provider extension", () => {
    const info: RegisterInfo = {
      protocol_ver: "1.0.0",
      apis: {},
      provider: {
        id: "prov-1",
        name: "Provider",
        desc: "Desc",
        version: "1.0.0",
        address: "127.0.0.1",
        port: 3000,
        protocol: NetworkProtocol.TCP,
        authorization: "auth",
        api: ["register"],
      },
    };

    expect(info.protocol_ver).toBe("1.0.0");
    expect(info.provider.id).toBe("prov-1");
    expect((info.provider as any).address).toBe("127.0.0.1");
  });
});

describe("ReportData interface", () => {
  it("should have all required system metrics fields", () => {
    const data: ReportData = {
      timestamp: Date.now(),
      state: ExecutionState.Running,
      ramUsed: 512,
      ramFree: 1024,
      cpuLoad: 45,
      netTx: "1.00 MB",
      netTxBytes: 1048576,
      netRx: "2.00 MB",
      netRxBytes: 2097152,
    };

    expect(data.timestamp).toBeDefined();
    expect(data.state).toBe(ExecutionState.Running);
    expect(data.ramUsed).toBe(512);
    expect(data.ramFree).toBe(1024);
    expect(data.cpuLoad).toBe(45);
    expect(data.netTx).toBe("1.00 MB");
    expect(data.netRx).toBe("2.00 MB");
  });

  it("should allow optional apiCounter", () => {
    const apiCounter = new Map<string, Omit<ApiCounter, "total">>();
    const data: ReportData = {
      timestamp: Date.now(),
      state: ExecutionState.Running,
      ramUsed: 256,
      ramFree: 2048,
      cpuLoad: 30,
      netTx: "512 KB",
      netTxBytes: 524288,
      netRx: "1.00 MB",
      netRxBytes: 1048576,
      apiCounter: apiCounter,
    };

    expect(data.apiCounter).toBe(apiCounter);
  });
});

describe("ResponseArgs interface", () => {
  it("should have apiSpec, data, errType, request, and target", () => {
    const args: ResponseArgs = {
      apiSpec: { request: "Req", response: "Res", ack: AckType.None },
      data: Buffer.from("response data"),
      errType: AckValue.None,
      request: { peer: { service: "", instance: "" }, api: "test", args: {} },
      target: {},
    };

    expect(args.apiSpec.request).toBe("Req");
    expect(Buffer.isBuffer(args.data)).toBe(true);
    expect(args.errType).toBe(AckValue.None);
  });
});

describe("RestCall interface", () => {
  it("should extend ApiCall with method, authType, and authorization", () => {
    const restCall: RestCall = {
      peer: { service: "RestService", instance: "inst-1" },
      api: "users/123",
      args: { name: "John" },
      msgId: "msg-789",
      method: "PUT",
      authType: "Bearer",
      authorization: "token-xyz",
    };

    expect(restCall.api).toBe("users/123");
    expect(restCall.method).toBe("PUT");
    expect(restCall.authType).toBe("Bearer");
    expect(restCall.authorization).toBe("token-xyz");
  });
});

describe("SocketAddress interface", () => {
  it("should have address, port, and protocol", () => {
    const addr: SocketAddress = {
      address: "192.168.1.100",
      port: 8080,
      protocol: NetworkProtocol.TCP,
    };

    expect(addr.address).toBe("192.168.1.100");
    expect(addr.port).toBe(8080);
    expect(addr.protocol).toBe(NetworkProtocol.TCP);
  });
});

describe("getAppEnv", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("should return development by default", () => {
    delete process.env.NODE_ENV;
    expect(getAppEnv()).toBe(AppEnv.development);
  });

  it("should return development when NODE_ENV is undefined", () => {
    process.env.NODE_ENV = undefined as any;
    expect(getAppEnv()).toBe(AppEnv.development);
  });

  it("should return development when NODE_ENV is invalid", () => {
    process.env.NODE_ENV = "local";
    expect(getAppEnv()).toBe(AppEnv.development);
  });

  it("should return development when NODE_ENV is development", () => {
    process.env.NODE_ENV = "development";
    expect(getAppEnv()).toBe(AppEnv.development);
  });

  it("should return production when NODE_ENV is production", () => {
    process.env.NODE_ENV = "production";
    expect(getAppEnv()).toBe(AppEnv.production);
  });

  it("should return staging when NODE_ENV is staging", () => {
    process.env.NODE_ENV = "staging";
    expect(getAppEnv()).toBe(AppEnv.staging);
  });

  it("should return test when NODE_ENV is test", () => {
    process.env.NODE_ENV = "test";
    expect(getAppEnv()).toBe(AppEnv.test);
  });
});
