import "reflect-metadata";
import { Container } from "inversify";

import { ExecutionMetrics } from "../metrics/exec-metrics";
import { withExecutionTime } from "../aop/exec-time-interceptor";
import { ServiceManager } from "../manager/service-manager";

export const TYPES = {
  ServiceManager: Symbol.for("ServiceManager"),
};

export const container = new Container();

// Metrics singleton
container.bind(ExecutionMetrics).toSelf().inSingletonScope();

// Service with AOP
container
  .bind<ServiceManager>(TYPES.ServiceManager)
  .to(ServiceManager)
  .onActivation((ctx, instance) => {
    const metrics = ctx.container.get(ExecutionMetrics);
    return withExecutionTime(instance, metrics);
  });
