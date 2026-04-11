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
  Tracer,
  context,
  trace,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ConsoleSpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";

import { NetworkDirection } from "../network/network-events";
import { AppEnv, NetworkProtocol, getAppEnv } from "../types/basal-protocol";
import {
  ProviderState,
  DEFAULT_RESOURCE,
  ProviderAttributeValue,
} from "../provider/provider-info";

/**
 * Tracer configuration options
 */
export interface NetworkSpanOptions {
  message?: string;
  address?: string;
  port?: number;
  protocol?: NetworkProtocol;
  direction?: NetworkDirection;
  attributes?: Record<string, ProviderAttributeValue>;
  parent?: Span | Context;
}

export interface SpanOptions {
  kind?: SpanKind;
  attributes?: Record<string, ProviderAttributeValue>;
  parent?: Span | Context;
  startTime?: number;
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
 * OtelTracing.getInstance(providerId, { enabled: true, serviceName: "OrderService", serviceVersion: "1.0.0" }, configManager);
 *
 * // Create network span
 * const span = OtelTracing.getInstance(providerId).createNetworkSpan("broadcast", {
 * attributes: { "network.type": "discovery" },
 * });
 *
 * // Create RPC span
 * const rpcSpan = OtelTracing.getInstance(providerId).createSpan("processPayment", {
 * attributes: { "rpc.method": "PaymentService.charge" },
 * });
 * ```
 */
export class OtelTracer {
  private static _instances: Map<string, OtelTracer> = new Map();

  public static getInstance(
    providerId: string,
    provider?: ProviderState,
  ): OtelTracer {
    let tracer = OtelTracer._instances.get(providerId);
    if (!tracer) {
      tracer = new OtelTracer(provider || new ProviderState(DEFAULT_RESOURCE));
      OtelTracer._instances.set(providerId, tracer);
    }
    return tracer;
  }

  private _providerState!: ProviderState;
  private _tracerProvider?: NodeTracerProvider;
  private _tracer?: Tracer;

  public constructor(provider: ProviderState) {
    this.configure(provider);
  }

  public configure(provider: ProviderState): void {
    this.setProviderState(provider);
    const { enabled, ...rest } = provider.getProvider();
    if (!enabled) {
      return;
    }

    try {
      const resource = resourceFromAttributes({ ...rest });
      // Use ConsoleSpanExporter for 'development' environment, otherwise use OTLPTraceExporter.
      const exporter =
        AppEnv.development === getAppEnv()
          ? new ConsoleSpanExporter()
          : new OTLPTraceExporter({ url: "http://localhost:4317" });

      const spanProcessor = new SimpleSpanProcessor(exporter);
      const tracerProvider = new NodeTracerProvider({
        resource: resource,
        spanProcessors: [spanProcessor],
      });
      this.setTracerProvider(tracerProvider);
    } catch (error) {
      console.error("Failed to initialize OpenTelemetry tracing:", error);
    }
  }

  public createSpan(name: string, options: SpanOptions = {}): Span {
    const { enabled } = this._providerState.getProvider();
    if (!enabled || !this._tracer) {
      return trace.getTracer("disabled").startSpan(name);
    }

    const spanAttr = this._providerState.getCommonAttributes();
    const attributes: Record<string, ProviderAttributeValue> = {
      ...spanAttr,
      ...options?.attributes,
    };

    const spanOptions: SpanOptions = {
      kind: options.kind || SpanKind.INTERNAL,
      ...options,
    };
    spanOptions.attributes = attributes;
    spanOptions.startTime = Date.now();

    return this._tracer.startSpan(name, spanOptions);
  }

  /**
   * Creates a span for network operations
   */
  public createNetworkSpan(
    operation: string,
    options: NetworkSpanOptions = {},
  ): Span {
    let peer: Record<string, ProviderAttributeValue> = {};
    if (options.address) {
      const dest = `${options.address}:${options.port}`;
      if (options.direction === NetworkDirection.In) {
        peer["network.peer.source"] = dest;
      } else {
        peer["network.peer.target"] = dest;
      }
      peer["network.peer.address"] = options.address;
      peer["network.peer.port"] = options.port || 0;
    }

    const spanOptions: SpanOptions = {
      kind: SpanKind.SERVER,
      attributes: {
        "network.operation": operation,
        "network.protocol": options.protocol || NetworkProtocol.TCP,
        "network.direction": options.direction || NetworkDirection.In,
        ...peer,
        ...options?.attributes,
      },
      parent: options.parent,
    };
    return this.createSpan(`network.${operation}`, spanOptions);
  }

  /**
   * Creates a span for UDP broadcast discovery
   */
  public createBroadcastSpan(
    operation: string,
    options: NetworkSpanOptions = {},
  ): Span {
    options.protocol = NetworkProtocol.UDP;
    return this.createNetworkSpan(`broadcast.${operation}`, options);
  }

  public getProviderIdentity(): string {
    return this._providerState.getProviderIdentity();
  }

  /**
   * Gets the ProviderState instance.
   */
  public getProviderState(): ProviderState {
    return this._providerState;
  }

  /**
   * Records an exception on a span
   */
  public recordException(
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

  public setProviderState(provider: ProviderState): void {
    this._providerState = provider;
  }

  private setTracerProvider(provider: NodeTracerProvider): void {
    this._tracerProvider = provider;
    this._tracer = provider.getTracer("distributed-rpc");
  }

  public async shutdown(): Promise<void> {
    if (this._tracerProvider) {
      await this._tracerProvider.shutdown();
      this._tracerProvider = undefined;
      this._tracer = undefined;
    }
  }
}
