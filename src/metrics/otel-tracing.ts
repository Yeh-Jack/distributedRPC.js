/**
 * OpenTelemetry tracing module for distributed RPC.
 * Provides comprehensive distributed tracing with automatic span creation and context propagation.
 * @module otel-tracing
 */
import {
  Context,
  Span,
  SpanKind,
  SpanStatusCode,
  context,
  createContextKey,
  trace,
} from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import {
  // BatchSpanProcessor,
  NodeTracerProvider,
  SimpleSpanProcessor,
  ConsoleSpanExporter,
} from "@opentelemetry/sdk-trace-node";
// import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";

import { createOtelExporter } from "../aop/container";
import { NetworkProtocol } from "../network/network-events";
import { ExecutionState, UNKNOWN_ATTRIBUTE } from "../types/basal-protocol";

export enum NetworkDirection {
  In = "inbound",
  Out = "outbound",
}

export interface NetworkSpanOptions {
  message?: string;
  address?: string;
  port?: number;
  protocol?: NetworkProtocol;
  direction?: NetworkDirection;
  attributes?: Record<string, SpanAttributeValue>;
  parent?: Span | Context;
}

export interface SpanOptions {
  kind?: SpanKind;
  attributes?: Record<string, SpanAttributeValue>;
  parent?: Span | Context;
  startTime?: number;
}

export interface TracingConfig {
  enabled: boolean;
  [ATTR_SERVICE_NAME]: string;
  [ATTR_SERVICE_INSTANCE]: string;
  [ATTR_SERVICE_VERSION]: string;
}

/**
 * Tracing configuration options
 */
export type SpanAttributeValue = string | number | boolean;

/**
 * Context keys for OpenTelemetry propagation
 */
export const SERVICE_NAME_KEY = createContextKey("service.name");
export const SERVICE_ID_KEY = createContextKey("service.instance");
export const SERVER_STATE_KEY = createContextKey("server.state");

/**
 * Default tracing configuration
 */
export const ATTR_PROTOCOL_VERSION = "protocol.version";
export const ATTR_SERVICE_INSTANCE = "service.instance";
export const ATTR_SERVICE_STATE = "service.state";
const DEFAULT_CONFIG: Required<TracingConfig> = {
  enabled: false,
  [ATTR_SERVICE_NAME]: UNKNOWN_ATTRIBUTE,
  [ATTR_SERVICE_INSTANCE]: UNKNOWN_ATTRIBUTE,
  [ATTR_SERVICE_VERSION]: UNKNOWN_ATTRIBUTE,
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
 * // Returns: { "service.name": "OrderService", "service.instance": "inst-1", "server.state": "Listening" }
 * ```
 */
export class ServerStateSpan {
  private static _state: ExecutionState = ExecutionState.Stopped;
  private static _serviceName: string = UNKNOWN_ATTRIBUTE;
  private static _serviceId: string = UNKNOWN_ATTRIBUTE;

  /**
   * Sets the server state for span attributes
   */
  public static setState(
    state: ExecutionState,
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
  public static getState(): ExecutionState {
    return this._state;
  }

  /**
   * Gets common span attributes
   */
  public static getCommonAttributes(): Record<string, SpanAttributeValue> {
    return {
      [ATTR_SERVICE_NAME]: this._serviceName,
      [ATTR_SERVICE_INSTANCE]: this._serviceId,
      [ATTR_SERVICE_STATE]: this._state,
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
      ExecutionState.Stopped,
      this._config[ATTR_SERVICE_NAME],
      this._config[ATTR_SERVICE_INSTANCE],
    );
  }

  /**
   * Gets the configured service name
   */
  public static getServiceName(): string {
    return this._config[ATTR_SERVICE_NAME];
  }

  /**
   * Gets the configured service instance ID
   */
  public static getServiceInstance(): string {
    return this._config[ATTR_SERVICE_INSTANCE];
  }

  /**
   * Creates a new span with standard attributes
   */
  public static createSpan(name: string, options: SpanOptions = {}): Span {
    if (!this._config.enabled) {
      return trace.getTracer("disabled").startSpan(name);
    }

    const tracer = trace.getTracer("distributed-rpc");
    const spanOptions: SpanOptions = {
      ...options,
      kind: options.kind || SpanKind.INTERNAL,
    };

    const attributes: Record<string, SpanAttributeValue> = {
      ...options.attributes,
      [ATTR_SERVICE_NAME]: this._config[ATTR_SERVICE_NAME],
      [ATTR_SERVICE_INSTANCE]: this._config[ATTR_SERVICE_INSTANCE],
      [ATTR_SERVICE_VERSION]: this._config[ATTR_SERVICE_VERSION],
      ...ServerStateSpan.getCommonAttributes(),
    };
    spanOptions.attributes = attributes;
    spanOptions.startTime = Date.now();

    return tracer.startSpan(name, spanOptions);
  }

  /**
   * Creates a span for network operations
   */
  public static createNetworkSpan(
    operation: string,
    options: NetworkSpanOptions = {},
  ): Span {
    const spanOptions: SpanOptions = {
      kind: SpanKind.SERVER,
      attributes: {
        "network.operation": operation,
        "network.protocol": options.protocol || NetworkProtocol.TCP,
        "network.direction": options.direction || NetworkDirection.In,
        ...(options.address && { "network.peer.address": options.address }),
        ...(options.port && { "network.peer.port": options.port }),
        ...options.attributes,
      },
      parent: options.parent,
    };
    return this.createSpan(`network.${operation}`, spanOptions);
  }

  /**
   * Creates a span for UDP broadcast discovery
   */
  public static createBroadcastSpan(
    operation: string,
    options: NetworkSpanOptions = {},
  ): Span {
    const attributes: Record<string, SpanAttributeValue> =
      options.attributes || {};
    attributes["network.broadcast.type"] = operation;
    options.attributes = attributes;
    options.protocol = NetworkProtocol.UDP;

    // const attributes: Record<string, SpanAttributeValue> = {
    //   "network.broadcast.type": operation,
    //   "network.protocol": NetworkProtocol.UDP,
    // };

    // if (options.message) {
    //   attributes["network.broadcast.message"] = options.message;
    // }

    // if (options.attributes) {
    //   Object.entries(options.attributes).forEach(([key, value]) => {
    //     if (value !== undefined) {
    //       attributes[key] = value;
    //     }
    //   });
    // }

    return this.createNetworkSpan(`broadcast.${operation}`, options);
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
    state: ExecutionState,
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
  private static _tracers: Map<string, NodeTracerProvider> = new Map();

  /**
   * Initializes OpenTelemetry tracing with configuration
   */
  public static initialize(
    config: TracingConfig = DEFAULT_CONFIG,
  ): NodeTracerProvider | undefined {
    config = { ...DEFAULT_CONFIG, ...config }; // Replenish with default config.
    let tracer: NodeTracerProvider | undefined;
    if (config.enabled) {
      OtelTracing.configure(config);
      tracer = OtelTracer.getTracer(config);
      if (tracer) {
        return tracer;
      }

      try {
        // 1. Define the Resource which identifies the service emitting the telemetry.
        const resource = resourceFromAttributes({
          [ATTR_SERVICE_NAME]: config[ATTR_SERVICE_NAME],
          [ATTR_SERVICE_VERSION]: config[ATTR_SERVICE_VERSION],
          [ATTR_SERVICE_INSTANCE]: config[ATTR_SERVICE_INSTANCE],
        });

        // 2. Configure the Exporter
        const exporter = createOtelExporter();

        // 3. Initialize the Tracer Provider with the resource and processors.
        /*
         * SimpleSpanProcessor sends spans as they happen (good for debugging)
         * BatchSpanProcessor is better for production performance
         */
        const spanProcessor = new SimpleSpanProcessor(exporter);
        tracer = new NodeTracerProvider({
          resource: resource,
          spanProcessors: [spanProcessor],
        });

        // 4. Register the provider globally
        // This allows you to use trace.getTracer() anywhere in your app
        tracer.register();

        const svcId =
          config[ATTR_SERVICE_NAME] + "-" + config[ATTR_SERVICE_INSTANCE];
        OtelTracer._tracers.set(svcId, tracer);
      } catch (error) {
        console.error("Failed to initialize OpenTelemetry tracer:", error);
      }
    }

    return tracer;
  }

  /**
   * Checks if tracing is initialized
   */
  public static getTracer(
    config: TracingConfig = DEFAULT_CONFIG,
  ): NodeTracerProvider | undefined {
    config = { ...DEFAULT_CONFIG, ...config }; // Replenish with default config.
    const svcId =
      config[ATTR_SERVICE_NAME] + "-" + config[ATTR_SERVICE_INSTANCE];
    return OtelTracer._tracers.get(svcId);
  }
}
