# distributedRPC.js - Project Documentation

## Overview

**distributedRPC.js** is a distributed Remote Procedure Call (RPC) framework for Node.js that enables zero-config service discovery, inter-service communication, and centralized management through a UDP/TCP network architecture.

### Core Capabilities

- **Zero-Configuration Service Discovery**: Services find each other via UDP broadcast without manual configuration
- **Multi-Role Services**: Each service instance can act as client, server, and response handler simultaneously
- **Horizontal Scalability**: Multiple service instances share workload via consumer groups (planned Redis integration)
- **OpenTelemetry Observability**: Built-in metrics, tracing, and structured logging
- **Dependency Injection**: InversifyJS-based DI container for loose coupling

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        ServiceProvider (SP)                     │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌──────────────┐  │
│  │  Client   │  │  Server   │  │ Response  │  │  Discovery   │  │
│  │  Role     │  │  Role     │  │  Role     │  │  Role        │  │
│  │           │  │           │  │           │  │              │  │
│  │ • Request │  │ • Listen  │  │ • Handle  │  │ • UDP        │  │
│  │   other   │  │   to      │  │   TCP     │  │   Broadcast  │  │
│  │   SPs     │  │   Redis   │  │   Response│  │ • Find SM    │  │
│  └───────────┘  └───────────┘  └───────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     ServiceManager (SM)                         │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  Discovery  │  │   Service   │  │   Stream    │              │
│  │  Handler    │  │   Registry  │  │   Info      │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                                                                 │
│  NOTE: Discovery-only, no routing or message coordination       │
└─────────────────────────────────────────────────────────────────┘
```

### Network Protocols

| Protocol | Purpose | Use Case |
|----------|---------|----------|
| **UDP Broadcast** | Service discovery | Finding ServiceManager on the network |
| **TCP** | Reliable RPC | Request/response communication between services |

### Communication Flow

```
1. ServiceProvider starts → UDP broadcast probe → Find ServiceManager
2. ServiceManager responds → Service catalog + configuration
3. ServiceProvider registers → TCP connection to ServiceManager
4. ServiceProvider reports metrics → Periodic TCP updates
5. ServiceProvider A → RPC call → ServiceProvider B (via direct TCP)
```

## Directory Structure

```
distributedRPC.js/
├── src/
│   ├── main.ts                    # Application entry point
│   ├── aop/                       # Aspect-Oriented Programming & DI
│   │   ├── container.ts          # InversifyJS container setup
│   │   ├── di-types.ts           # DI type symbols
│   │   └── exec-time-interceptor.ts  # Execution time interception
│   ├── common/                    # Shared utilities
│   │   ├── abort-aware.ts        # Abort signal utilities
│   │   ├── config.ts             # Configuration management
│   │   ├── id-generator.ts       # UUID/short ID generation
│   │   ├── logger.ts             # Winston logging
│   │   └── retry.ts              # Retry scheduler
│   ├── manager/                   # ServiceManager
│   │   ├── api-spec-260321.ts    # ServiceManager API spec (v260321)
│   │   └── service-manager.ts    # Main coordinator
│   ├── metrics/                   # OpenTelemetry integration
│   │   ├── exec-metrics.ts       # Execution metrics
│   │   ├── otel-metrics.ts       # Metrics instruments
│   │   ├── otel-resource.ts      # OTel resource attributes
│   │   └── otel-tracing.ts       # Distributed tracing
│   ├── network/                   # Network communication
│   │   ├── broadcast-udp-server.ts
│   │   ├── network-events.ts
│   │   ├── tcp-client.ts
│   │   ├── tcp-server.ts
│   │   ├── typed-event-emitter.ts
│   │   ├── udp-client.ts
│   │   ├── udp-discovery.ts
│   │   └── udp-server.ts
│   ├── procedure/                 # Service procedures
│   │   ├── discover.ts           # Discovery procedure
│   │   ├── index.ts             # Procedure exports
│   │   ├── procedure.ts         # Base class
│   │   ├── register.ts          # Registration
│   │   └── report.ts            # Reporting
│   ├── provider/                 # ServiceProvider
│   │   ├── provider-info.ts     # Provider state & attributes
│   │   └── service-provider.ts  # Base class
│   └── types/
│       └── basal-protocol.ts    # Protocol types/constants
├── src/__tests__/                 # Test files (mirrors src structure)
│   ├── aop/
│   ├── common/
│   ├── manager/
│   ├── metrics/
│   ├── network/
│   ├── procedure/
│   ├── provider/
│   └── types/
├── config/
│   └── config.yml               # Default configuration
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Key Classes

### ServiceProvider

Base class for all distributed services. Handles:
- Lifecycle management (start, stop, shutdown)
- Service discovery via UDP broadcast
- Service registration with ServiceManager
- Metric reporting
- TCP server/client initialization
- Request routing and response handling

```typescript
// Key methods
async start(): Promise<void>
async stop(): Promise<void>
async shutdown(): Promise<void>
async register(): Promise<void>
async report(): Promise<void>
getServiceName(): string
getState(): ExecutionState
getMetrics(): OtelMeterics
```

### ServiceManager

Central coordinator for service discovery and registry:
- Responds to UDP broadcast probes
- Maintains service registry
- Accepts service registrations
- Collects and stores service reports

### Network Classes

| Class | Purpose |
|-------|---------|
| `TcpServer` | Listen for incoming TCP connections |
| `TcpClient` | Make outbound TCP connections |
| `UdpServer` | UDP server base class |
| `UdpClient` | UDP client for sending datagrams |
| `UdpDiscovery` | UDP broadcast discovery client |
| `BroadcastUdpServer` | UDP server for discovery responses |

### Procedures

| Procedure | Purpose |
|------------|---------|
| `DiscoverProcedure` | Find ServiceManager via UDP broadcast |
| `RegisterProcedure` | Register service with ServiceManager |
| `ReportProcedure` | Send metrics to ServiceManager |

## Dependencies

### Production
- `@opentelemetry/api` - OpenTelemetry API
- `@opentelemetry/exporter-metrics-otlp-grpc` - OTel metrics exporter
- `@opentelemetry/exporter-trace-otlp-grpc` - OTel trace exporter
- `@opentelemetry/exporter-prometheus` - Prometheus metrics
- `@opentelemetry/resources` - OTel resource attributes
- `@opentelemetry/sdk-metrics` - OTel metrics SDK
- `@opentelemetry/sdk-trace-node` - OTel tracing SDK
- `@opentelemetry/semantic-conventions` - OTel semantic conventions
- `inversify` - Dependency injection
- `js-yaml` - YAML configuration parsing
- `lodash` - Utility functions
- `reflect-metadata` - TypeScript reflection
- `winston` - Logging
- `winston-daily-rotate-file` - Log rotation

### Development
- `typescript` - TypeScript compiler
- `vitest` - Test framework
- `@vitest/coverage-v8` - Code coverage
- `prettier` - Code formatting
- `typedoc` - Documentation generation
- `tsx` - TypeScript executor
- `vite` - Build tool

## Configuration

Configuration is loaded from `config.yml` with sensible defaults:

```yaml
app:
  # Application-specific config

core:
  service_name: "MyService"
  net:
    tcp:
      address: "0.0.0.0"
      port: 0  # Auto-assign port
      client:
        timeout: 10000
    udp:
      address: "0.0.0.0"
      port: 5707
  report:
    enabled: true
    interval: 60  # seconds
    max_retries: 3
  retry:
    interval: 2000
    max_retries: 0  # Infinite
    backoff:
      enabled: true
      max_delay: 240000

log:
  format: "console"  # or "json"
  log_level: "info"
  max_files: "14d"
  max_size: "20m"
```

## Getting Started

```bash
# Install dependencies
pnpm install

# Build TypeScript
pnpm run build

# Run tests
pnpm test

# Start development server
pnpm run dev

# Generate documentation
pnpm run docs
```

## OpenTelemetry Integration

### Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `method_execution_time` | Histogram | Service method timing |
| `retry_attempts_total` | Counter | Retry operations |
| `server_state` | ObservableGauge | Current server state |
| `active_connections` | UpDownCounter | TCP connection count |
| `bytes_total` | Counter | Network throughput |
| `udp_broadcast_requests_total` | Counter | Discovery requests received |
| `udp_broadcast_responses_total` | Counter | Discovery responses sent |
| `tcp_connection_duration` | Histogram | Connection lifetime |

### Tracing

Spans are created for:
- TCP connection lifecycle
- UDP broadcast discovery
- RPC request handling

## License

Apache 2.0