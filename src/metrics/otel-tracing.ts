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
 * Options for creating network-related spans with protocol and direction metadata.
 */
export interface NetworkSpanOptions {
  /** Optional descriptive message for the span. */
  message?: string;
  /** Target or source address for the network operation. */
  address?: string;
  /** Target or source port for the network operation. */
  port?: number;
  /** Network protocol being used (TCP or UDP). */
  protocol?: NetworkProtocol;
  /** Direction of the network traffic (inbound or outbound). */
  direction?: NetworkDirection;
  /** Additional attributes to attach to the span. */
  attributes?: Record<string, ProviderAttributeValue>;
  /** Parent span or context for trace propagation. */
  parent?: Span | Context;
}

/**
 * Options for creating general-purpose spans with kind and timing configuration.
 */
export interface SpanOptions {
  /** The kind of span (e.g., INTERNAL, SERVER, CLIENT). Defaults to INTERNAL. */
  kind?: SpanKind;
  /** Additional attributes to attach to the span. */
  attributes?: Record<string, ProviderAttributeValue>;
  /** Parent span or context for trace propagation. */
  parent?: Span | Context;
  /** Explicit start time for the span in milliseconds since epoch. */
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

  /**
   * Gets or creates a singleton OtelTracer instance for the given provider ID.
   *
   * @param providerId - Unique identifier for the provider creating the tracer.
   * @param provider - Optional ProviderState instance for configuration.
   * @returns The singleton OtelTracer instance.
   */
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
   * Creates a span for network operations with TCP/UDP protocol metadata.
   *
   * @param operation - The network operation name (e.g., "connect", "write", "read").
   * @param options - Network span options including address, port, protocol, and direction.
   * @returns A new Span instance for the network operation.
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
   * Creates a span for UDP broadcast discovery operations.
   * Sets protocol to UDP and prefixes operation name with "broadcast.".
   *
   * @param operation - The broadcast operation name.
   * @param options - Network span options for the broadcast.
   * @returns A new Span instance for the broadcast operation.
   */
  public createBroadcastSpan(
    operation: string,
    options: NetworkSpanOptions = {},
  ): Span {
    options.protocol = NetworkProtocol.UDP;
    return this.createNetworkSpan(`broadcast.${operation}`, options);
  }

  /**
   * Gets the provider identity string from the provider state.
   *
   * @returns The provider identity identifier.
   */
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
   * Records an exception on a span and sets the span status to ERROR.
   *
   * @param span - The span to record the exception on.
   * @param error - The error/exception to record.
   * @param attributes - Optional additional attributes to set on the status.
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

  /**
   * Sets the provider state for this tracer.
   *
   * @param provider - The ProviderState instance to use.
   */
  public setProviderState(provider: ProviderState): void {
    this._providerState = provider;
  }

  private setTracerProvider(provider: NodeTracerProvider): void {
    this._tracerProvider = provider;
    this._tracer = provider.getTracer("distributed-rpc");
  }

  /**
   * Shuts down the tracer provider, flushing any pending spans.
   * After shutdown, the tracer will be disabled.
   *
   * @returns Promise that resolves when shutdown is complete.
   */
  public async shutdown(): Promise<void> {
    if (this._tracerProvider) {
      await this._tracerProvider.shutdown();
      this._tracerProvider = undefined;
      this._tracer = undefined;
    }
  }
}
