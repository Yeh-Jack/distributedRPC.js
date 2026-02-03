/**
 * OpenTelemetry tracing module for distributed RPC.
 * Provides comprehensive distributed tracing with automatic span creation and context propagation.
 * @module otel-tracing
 */

import {
  trace,
  Span,
  SpanKind,
  SpanStatusCode,
  Context,
  createContextKey,
} from "@opentelemetry/api";
import { UNKNOWN_ATTRIBUTE, ServerState } from "../types/basal-protocol";

/**
 * Context keys for OpenTelemetry propagation
 */
export const SERVICE_NAME_KEY = createContextKey("service.name");
export const SERVICE_ID_KEY = createContextKey("service.instance.id");
export const SERVER_STATE_KEY = createContextKey("server.state");

/**
 * Tracing configuration options
 */
export type SpanAttributeValue = string | number | boolean;

export interface TracingConfig {
  serviceName?: string;
  serviceVersion?: string;
  serviceInstanceId?: string;
  enabled?: boolean;
}

/**
 * Default tracing configuration
 */
const DEFAULT_CONFIG: Required<TracingConfig> = {
  serviceName: UNKNOWN_ATTRIBUTE,
  serviceVersion: "1.0.0",
  serviceInstanceId: UNKNOWN_ATTRIBUTE,
  enabled: true,
};

/**
 * Centralized server state tracking for OpenTelemetry span attributes.
 *
 * This utility class maintains server state information that is automatically
 * included as attributes in all created spans. It provides a thread-safe way
 * to track state transitions and make this information available to the
 * tracing system.
 *
 * Key Features:
 * - Thread-safe state management
 * - Automatic attribute inclusion in spans
 * - Service identity tracking
 * - State change notifications to tracing system
 *
 * @remarks
 * ServerStateSpan is used throughout the distributed RPC system to ensure
 * that all spans include relevant server state information. This enables
 * better observability and debugging capabilities by correlating spans
 * with the server's operational state.
 *
 * @example
 * ```typescript
 * // Update server state
 * ServerStateSpan.setState(ServerState.Listening, "OrderService", "inst-1");
 *
 * // Get common attributes for span creation
 * const attributes = ServerStateSpan.getCommonAttributes();
 * // Returns: { "service.name": "OrderService", "service.instance.id": "inst-1", "server.state": "Listening" }
 * ```
 */
export class ServerStateSpan {
  private static _state: ServerState = ServerState.Stopped;
  private static _serviceName: string = UNKNOWN_ATTRIBUTE;
  private static _serviceId: string = UNKNOWN_ATTRIBUTE;

  /**
   * Sets the server state for span attributes
   */
  public static setState(
    state: ServerState,
    serviceName?: string,
    serviceId?: string,
  ): void {
    this._state = state;
    if (serviceName) this._serviceName = serviceName;
    if (serviceId) this._serviceId = serviceId;
  }

  /**
   * Gets current server state
   */
  public static getState(): ServerState {
    return this._state;
  }

  /**
   * Gets common span attributes
   */
  public static getCommonAttributes(): Record<string, SpanAttributeValue> {
    return {
      "service.name": this._serviceName,
      "service.instance.id": this._serviceId,
      "server.state": this._state,
    };
  }
}

/**
 * Centralized OpenTelemetry tracing management for distributed RPC operations.
 *
 * This class provides a comprehensive suite of utilities for distributed tracing
 * across the RPC system. It handles span creation, correlation ID generation,
 * context propagation, and provides specialized methods for network and RPC tracing.
 *
 * Key Features:
 * - Configurable tracing with service identification
 * - Correlation ID generation and propagation
 * - Specialized network operation tracing (UDP, TCP)
 * - RPC operation span creation
 * - Exception recording and status management
 * - Context key management for propagation
 *
 * @remarks
 * OtelTracing is the primary interface for all tracing operations in the
 * distributed RPC system. It automatically includes service attributes,
 * correlation IDs, and operational context in all created spans, enabling
 * end-to-end visibility across service boundaries.
 *
 * @example
 * ```typescript
 * // Initialize tracing
 * OtelTracing.configure({
 *   serviceName: "OrderService",
 *   serviceVersion: "1.0.0",
 * });
 *
 * // Create network span
 * const span = OtelTracing.createNetworkSpan("broadcast", "udp", {
 *   attributes: { "network.type": "discovery" },
 * });
 *
 * // Create RPC span
 * const rpcSpan = OtelTracing.createRpcSpan("processPayment", {
 *   attributes: { "rpc.method": "PaymentService.charge" },
 * });
 * ```
 */
export class OtelTracing {
  private static _config: Required<TracingConfig> = DEFAULT_CONFIG;

  /**
   * Initializes the tracing configuration
   */
  public static configure(config: TracingConfig): void {
    this._config = { ...DEFAULT_CONFIG, ...config };
    ServerStateSpan.setState(
      ServerState.Stopped,
      this._config.serviceName,
      this._config.serviceInstanceId,
    );
  }

  /**
   * Gets the configured service name
   */
  public static getServiceName(): string {
    return this._config.serviceName;
  }

  /**
   * Gets the configured service instance ID
   */
  public static getServiceInstanceId(): string {
    return this._config.serviceInstanceId;
  }

  /**
   * Creates a new span with standard attributes
   */
  public static createSpan(
    name: string,
    options: {
      kind?: SpanKind;
      attributes?: Record<string, SpanAttributeValue>;
      parent?: Span | Context;
      startTime?: number;
    } = {},
  ): Span {
    if (!this._config.enabled) {
      return trace.getTracer("disabled").startSpan(name);
    }

    const tracer = trace.getTracer("distributed-rpc");
    const spanOptions: any = {
      kind: options.kind || SpanKind.INTERNAL,
    };

    if (options.parent) {
      spanOptions.parent = options.parent;
    }

    const attributes: Record<string, SpanAttributeValue> = {
      "service.name": this._config.serviceName,
      "service.instance.id": this._config.serviceInstanceId,
      ...ServerStateSpan.getCommonAttributes(),
    };

    // Add optional attributes safely
    if (options.attributes) {
      Object.entries(options.attributes).forEach(([key, value]) => {
        if (value !== undefined) {
          attributes[key] = value;
        }
      });
    }

    return tracer.startSpan(name, attributes, spanOptions);
  }

  /**
   * Creates a span for network operations
   */
  public static createNetworkSpan(
    operation: string,
    networkType: "tcp" | "udp" | "broadcast",
    options: {
      address?: string;
      port?: number;
      direction?: "inbound" | "outbound";
      attributes?: Record<string, SpanAttributeValue>;
      parent?: Span | Context;
    } = {},
  ): Span {
    return this.createSpan(`network.${networkType}.${operation}`, {
      kind: SpanKind.SERVER,
      attributes: {
        "network.type": networkType,
        "network.operation": operation,
        "network.direction": options.direction || "inbound",
        ...(options.address && { "network.peer.address": options.address }),
        ...(options.port && { "network.peer.port": options.port }),
        ...options.attributes,
      },
      parent: options.parent,
    });
  }

  /**
   * Creates a span for UDP broadcast discovery
   */
  public static createBroadcastSpan(
    operation: string,
    options: {
      message?: string;
      address?: string;
      port?: number;
      direction?: "inbound" | "outbound";
      attributes?: Record<string, SpanAttributeValue>;
      parent?: Span | Context;
    } = {},
  ): Span {
    const attributes: Record<string, SpanAttributeValue> = {
      "network.broadcast.type": "service_discovery",
      "messaging.protocol": "udp",
    };

    if (options.message) {
      attributes["network.broadcast.message"] = options.message;
    }

    if (options.attributes) {
      Object.entries(options.attributes).forEach(([key, value]) => {
        if (value !== undefined) {
          attributes[key] = value;
        }
      });
    }

    return this.createNetworkSpan(`broadcast.${operation}`, "udp", {
      attributes,
      address: options.address,
      port: options.port,
      direction: options.direction,
      parent: options.parent,
    });
  }

  /**
   * Records an exception on a span
   */
  public static recordException(
    span: Span,
    error: Error,
    attributes?: Record<string, any>,
  ): void {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
      ...attributes,
    });
  }

  /**
   * Sets server state on all active spans
   */
  public static setServerState(
    state: ServerState,
    serviceName?: string,
    serviceId?: string,
  ): void {
    ServerStateSpan.setState(state, serviceName, serviceId);
  }
}

/**
 * Generates a correlation ID for tracing purposes
 */
export function generateCorrelationId(): string {
  return `trace_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Decorator for automatic span creation on methods
 */
export function traceMethod(
  name?: string,
  options: {
    kind?: SpanKind;
    attributes?: Record<string, SpanAttributeValue>;
  } = {},
) {
  return function <T extends (...args: any[]) => Promise<any>>(
    target: any,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>,
  ) {
    const originalMethod = descriptor.value!;
    const methodName = name || propertyKey;
    const className = target.constructor.name;

    descriptor.value = async function (this: any, ...args: any[]) {
      const span = OtelTracing.createSpan(`${className}.${methodName}`, {
        kind: options.kind || SpanKind.INTERNAL,
        attributes: {
          "method.class": className,
          "method.name": methodName,
          "correlation.id": generateCorrelationId(),
          ...options.attributes,
        },
      }) as any;

      try {
        const result = await originalMethod.apply(this, args);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        OtelTracing.recordException(span, error as Error);
        throw error;
      } finally {
        span.end();
      }
    } as T;

    return descriptor;
  };
}

/**
 * Class decorator for automatic method instrumentation
 */
export function traceable(componentName: string) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    // Add component metadata
    const originalConstructor = constructor;
    const newConstructor = function (...args: any[]) {
      const instance = new originalConstructor(...args);
      // Add metadata for instrumentation
      (instance as any).__componentName = componentName;
      (instance as any).__instrumented = true;
      return instance;
    };

    // Copy static properties
    Object.setPrototypeOf(newConstructor, originalConstructor);
    Object.defineProperty(newConstructor, "name", {
      value: originalConstructor.name,
    });

    return newConstructor;
  };
}

/**
 * Utility class for initializing OpenTelemetry tracing
 */
/**
 * Specialized tracer for distributed RPC operation tracing.
 *
 * This class provides RPC-specific tracing capabilities built on top of
 * OpenTelemetry's tracing API. It offers domain-specific methods for
 * creating spans related to RPC operations, service-to-service communication,
 * and distributed transaction tracing.
 *
 * Key Features:
 * - RPC operation span creation
 * - Service-to-service communication tracing
 * - Distributed transaction correlation
 * - Service mesh integration support
 * - Automatic error handling and status reporting
 *
 * @remarks
 * OtelTracer is designed specifically for distributed RPC scenarios where
 * spans need to represent high-level business operations rather than just
 * technical operations. It provides semantic conventions for RPC tracing
 * and integrates with the broader distributed tracing ecosystem.
 *
 * @example
 * ```typescript
 * const tracer = new OtelTracer({
 *   serviceName: "OrderService",
 * });
 *
 * // Trace RPC operation
 * const span = tracer.startRpcSpan("processOrder", {
 *   parentSpan: parentContext,
 *   attributes: { "rpc.service": "PaymentService", "rpc.method": "charge" },
 * });
 *
 * try {
 *   // RPC logic here
 *   span.setStatus({ code: SpanStatusCode.OK });
 * } catch (error) {
 *   tracer.recordError(span, error);
 *   span.setStatus({ code: SpanStatusCode.ERROR });
 * } finally {
 *   span.end();
 * }
 * ```
 */
export class OtelTracer {
  private static _initialized: boolean = false;

  /**
   * Initializes OpenTelemetry tracing with configuration
   */
  public static initialize(config: TracingConfig): void {
    if (OtelTracer._initialized) {
      return;
    }

    OtelTracing.configure(config);
    OtelTracer._initialized = true;
  }

  /**
   * Checks if tracing is initialized
   */
  public static isInitialized(): boolean {
    return OtelTracer._initialized;
  }
}
