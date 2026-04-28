import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ProviderState,
  ProviderInfo,
  DEFAULT_RESOURCE,
  ATTR_DEPLOY_ENV,
  ATTR_PROTOCOL_VERSION,
  ATTR_PROVIDER_IDENTITY,
  ATTR_SERVICE_INSTANCE,
  ATTR_SERVICE_STATE,
} from "../../provider/provider-info";
import { ExecutionState, UNKNOWN_ATTRIBUTE } from "../../types/basal-protocol";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

describe("ProviderState", () => {
  let mockProviderInfo: ProviderInfo;
  let providerState: ProviderState;

  beforeEach(() => {
    mockProviderInfo = {
      enabled: true,
      [ATTR_SERVICE_NAME]: "TestService",
      [ATTR_SERVICE_INSTANCE]: "inst-001",
      [ATTR_SERVICE_VERSION]: "1.0.0",
      [ATTR_PROTOCOL_VERSION]: "1.0.0",
      [ATTR_DEPLOY_ENV]: "development",
    };

    providerState = new ProviderState(mockProviderInfo);
  });

  describe("constructor", () => {
    it("should create ProviderState with provider info", () => {
      expect(providerState).toBeInstanceOf(ProviderState);
    });

    it("should set initial state to Stopped", () => {
      expect(providerState.getState()).toBe(ExecutionState.Stopped);
    });
  });

  describe("getProvider", () => {
    it("should return the provider info", () => {
      const result = providerState.getProvider();
      expect(result).toEqual(mockProviderInfo);
    });
  });

  describe("setProvider", () => {
    it("should update the provider info", () => {
      const newProviderInfo: ProviderInfo = {
        ...mockProviderInfo,
        [ATTR_SERVICE_NAME]: "NewService",
      };

      providerState.setProvider(newProviderInfo);

      expect(providerState.getProvider()[ATTR_SERVICE_NAME]).toBe("NewService");
    });
  });

  describe("getState", () => {
    it("should return current state", () => {
      expect(providerState.getState()).toBe(ExecutionState.Stopped);

      providerState.setState(ExecutionState.Running);

      expect(providerState.getState()).toBe(ExecutionState.Running);
    });
  });

  describe("setState", () => {
    it("should update the state", () => {
      providerState.setState(ExecutionState.Initializing);
      expect(providerState.getState()).toBe(ExecutionState.Initializing);

      providerState.setState(ExecutionState.Running);
      expect(providerState.getState()).toBe(ExecutionState.Running);
    });

    it("should allow setting to all ExecutionState values", () => {
      const states = [
        ExecutionState.Error,
        ExecutionState.Halt,
        ExecutionState.Halting,
        ExecutionState.Initializing,
        ExecutionState.Listening,
        ExecutionState.Retrying,
        ExecutionState.Running,
        ExecutionState.Starting,
        ExecutionState.Stopping,
        ExecutionState.Stopped,
      ];

      states.forEach((state) => {
        providerState.setState(state);
        expect(providerState.getState()).toBe(state);
      });
    });
  });

  describe("getProviderIdentity", () => {
    it("should return identity in service-instance format", () => {
      const identity = providerState.getProviderIdentity();
      expect(identity).toBe("TestService-inst-001");
    });

    it("should update when provider changes", () => {
      const newProviderInfo: ProviderInfo = {
        ...mockProviderInfo,
        [ATTR_SERVICE_NAME]: "UpdatedService",
        [ATTR_SERVICE_INSTANCE]: "inst-999",
      };

      providerState.setProvider(newProviderInfo);

      expect(providerState.getProviderIdentity()).toBe(
        "UpdatedService-inst-999",
      );
    });
  });

  describe("getCommonAttributes", () => {
    it("should return provider identity and state", () => {
      const attributes = providerState.getCommonAttributes();

      expect(attributes[ATTR_PROVIDER_IDENTITY]).toBe("TestService-inst-001");
      expect(attributes[ATTR_SERVICE_STATE]).toBe(ExecutionState.Stopped);
    });

    it("should reflect current state in attributes", () => {
      providerState.setState(ExecutionState.Running);

      const attributes = providerState.getCommonAttributes();

      expect(attributes[ATTR_SERVICE_STATE]).toBe(ExecutionState.Running);
    });
  });
});

describe("DEFAULT_RESOURCE", () => {
  it("should have all required attributes", () => {
    expect(DEFAULT_RESOURCE.enabled).toBe(false);
    expect(DEFAULT_RESOURCE[ATTR_SERVICE_NAME]).toBe(UNKNOWN_ATTRIBUTE);
    expect(DEFAULT_RESOURCE[ATTR_SERVICE_INSTANCE]).toBe(UNKNOWN_ATTRIBUTE);
    expect(DEFAULT_RESOURCE[ATTR_SERVICE_VERSION]).toBe(UNKNOWN_ATTRIBUTE);
    expect(DEFAULT_RESOURCE[ATTR_PROTOCOL_VERSION]).toBe(UNKNOWN_ATTRIBUTE);
    expect(DEFAULT_RESOURCE[ATTR_DEPLOY_ENV]).toBe(UNKNOWN_ATTRIBUTE);
  });

  it("should be read-only", () => {
    expect(Object.isFrozen(DEFAULT_RESOURCE)).toBe(true);
  });
});

describe("ProviderInfo interface", () => {
  it("should accept valid provider info", () => {
    const info: ProviderInfo = {
      enabled: true,
      [ATTR_SERVICE_NAME]: "MyService",
      [ATTR_SERVICE_INSTANCE]: "instance-1",
      [ATTR_SERVICE_VERSION]: "2.0.0",
      [ATTR_PROTOCOL_VERSION]: "1.0.0",
      [ATTR_DEPLOY_ENV]: "production",
    };

    expect(info[ATTR_SERVICE_NAME]).toBe("MyService");
  });

  it("should accept string, number, and boolean values", () => {
    const info: ProviderInfo = {
      enabled: false,
      [ATTR_SERVICE_NAME]: "TestService",
      [ATTR_SERVICE_INSTANCE]: "inst-1",
      [ATTR_SERVICE_VERSION]: "1.0.0",
      [ATTR_PROTOCOL_VERSION]: "1.0.0",
      [ATTR_DEPLOY_ENV]: "test",
    };

    expect(typeof info.enabled).toBe("boolean");
    expect(typeof info[ATTR_SERVICE_NAME]).toBe("string");
  });
});

describe("ProviderAttributeValue type", () => {
  it("should accept string values", () => {
    const value: any = "test-string";
    expect(typeof value).toBe("string");
  });

  it("should accept number values", () => {
    const value: any = 42;
    expect(typeof value).toBe("number");
  });

  it("should accept boolean values", () => {
    const value: any = true;
    expect(typeof value).toBe("boolean");
  });
});

describe("constant exports", () => {
  it("should export ATTR_DEPLOY_ENV", () => {
    expect(ATTR_DEPLOY_ENV).toBe("deployment.environment");
  });

  it("should export ATTR_PROTOCOL_VERSION", () => {
    expect(ATTR_PROTOCOL_VERSION).toBe("protocol.version");
  });

  it("should export ATTR_PROVIDER_IDENTITY", () => {
    expect(ATTR_PROVIDER_IDENTITY).toBe("provider.identity");
  });

  it("should export ATTR_SERVICE_INSTANCE", () => {
    expect(ATTR_SERVICE_INSTANCE).toBe("service.instance");
  });

  it("should export ATTR_SERVICE_STATE", () => {
    expect(ATTR_SERVICE_STATE).toBe("service.state");
  });
});
