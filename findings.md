# Findings: distributedRPC.js

## Project Overview

**distributedRPC.js** is a distributed Remote Procedure Call (RPC) framework for Node.js with:
- Zero-config service discovery via UDP broadcast
- TCP-based RPC communication
- OpenTelemetry observability (metrics + tracing)
- InversifyJS dependency injection
- Winston structured logging

## Architecture Summary

### Components

1. **ServiceProvider** - Multi-role distributed service (client + server)
2. **ServiceManager** - Discovery-only coordinator via UDP broadcast
3. **Network Layer** - TCP for RPC, UDP for discovery
4. **Procedures** - Discover, Register, Report

### Key Files

```
src/
├── main.ts                    # Entry point
├── aop/                       # AOP and DI
│   ├── container.ts          # InversifyJS container
│   ├── di-types.ts           # DI type symbols
│   └── exec-time-interceptor.ts
├── common/                    # Utilities
│   ├── config.ts             # YAML config management
│   ├── logger.ts             # Winston logging
│   ├── id-generator.ts       # UUID generation
│   └── retry.ts              # Exponential backoff
├── manager/                   # ServiceManager
│   └── service-manager.ts
├── metrics/                   # OpenTelemetry
│   ├── otel-metrics.ts
│   ├── otel-resource.ts
│   └── otel-tracing.ts
├── network/                   # TCP/UDP communication
│   ├── tcp-server.ts
│   ├── tcp-client.ts
│   ├── udp-discovery.ts
│   └── broadcast-udp-server.ts
├── procedure/                 # Service procedures
│   ├── discover.ts
│   ├── register.ts
│   └── report.ts
├── provider/                 # ServiceProvider
│   └── service-provider.ts
└── types/
    └── basal-protocol.ts
```

## Key Design Decisions

1. **UDP Broadcast Discovery** - Zero-config service finding
2. **Multi-Role Services** - Each SP is client + server
3. **Direct SP-to-SP** - No central routing
4. **Event-Driven** - TypedEventEmitter for network events
5. **InversifyJS DI** - Loose coupling, testable
6. **OpenTelemetry** - Industry-standard observability

## Communication Flow

```
1. SP starts → UDP broadcast → Find SM
2. SM responds → Service catalog
3. SP registers → TCP to SM
4. SP reports metrics → Periodic TCP
5. SP A → RPC call → SP B (direct TCP)
```

## OpenTelemetry Analysis

### What's Implemented

1. **Metrics** - Comprehensive metrics for execution time, connections, throughput, latency
2. **Tracing** - Network spans for TCP/UDP operations
3. **Correlation IDs** - Simple ID generation for request tracking

### Critical Issues

1. **No W3C TraceContext propagation** - Spans cannot be linked across service boundaries
2. **No API handler span** - Business logic not traced end-to-end
3. **Incorrect parent span** - TCP client uses connection span instead of API handler span
4. **Response lacks trace context** - Cannot correlate responses to original requests
5. **Helper calls not traced** - Cross-service call chain broken

### Impact

Without proper trace context propagation, the distributed trace is broken:
- Cannot see end-to-end latency for API calls
- Cannot identify bottlenecks in cross-service calls
- Cannot correlate errors across service boundaries
- Trace viewers show isolated segments instead of connected chains

### Solution (See TRACING.md)

1. Add `TraceContext` to message header (W3C standard)
2. Create SERVER span for incoming API requests
3. Propagate trace context when calling helper services
4. Include trace context in responses
5. Link spans across service boundaries

## Dependencies

### Production
- @opentelemetry/* - Observability
- inversify - Dependency injection
- winston - Logging
- js-yaml - Config parsing
- lodash - Utilities

### Development
- typescript, vitest, prettier, typedoc, vite

## Generated Documentation

- `docs/` - TypeDoc HTML documentation
- `PROJECT.md` - Overview
- `ARCHITECTURE.md` - System design, OpenTelemetry findings
- `DESIGN.md` - Decisions, tracing considerations
- `API.md` - API reference
- `TRACING.md` - OpenTelemetry analysis and recommendations
- `README.md` - Quick start

## Notes

- Redis integration is planned but not implemented
- Project was recently refactored
- Comprehensive test coverage target: >75% branches
- OpenTelemetry tracing needs improvement for cross-service scenarios