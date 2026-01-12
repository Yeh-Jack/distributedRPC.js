import { metrics } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { ServiceManager } from "./service-manager";

export const PROTOCOL_VERSION = "1.0.0";
export const PROVIDER_VERSION = "1.0.0";

const provider = new MeterProvider({
  resource: resourceFromAttributes({
    "service.name": new ServiceManager().getServiceName(),
    "service.version": PROVIDER_VERSION,
    "protocol.version": PROTOCOL_VERSION,
    "service.instance.id": process.pid.toString(),
    "deployment.environment": "production",
  }),
});

metrics.setGlobalMeterProvider(provider);
