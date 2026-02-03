# Architecture Documentation

## Overview

This document provides detailed architectural documentation for the distributedRPC.js framework, including current implementation status and future Redis integration plans.

## System Architecture

### Component Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                      ServiceProvider (SP)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐│
│  │   Client    │  │   Server    │  │  Response   │  │Discovery  ││
│  │   Role      │  │   Role      │  │   Role      │  │  Role     ││
│  │             │  │             │  │             │  │           ││
│  │• Publish to │  │• Listen to  │  │• Handle TCP │  │• UDP      ││
│  │  Redis      │  │  Redis      │  │  Responses  │  │  Broadcast││
│  │• Request    │  │• Process    │  │• Correlate  │  │• Find SM  ││
│  │  other SPs  │  │  requests   │  │  responses  │  │• Get      ││
│  └─────────────┘  └─────────────┘  └─────────────┘  │  Streams  ││
│         │                   │              │        └───────────┘│
│         └───────────────────┼──────────────┘                     │
│                             │                                    │
│                    ┌────────▼────────┐                           │
│                    │   Business      │                           │
│                    │   Logic         │                           │
│                    └─────────────────┘                           │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ServiceManager (SM)                          │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  Discovery  │  │   Service   │  │  Stream     │              │
│  │   Handler   │  │  Registry   │  │   Info      │              │
│  │             │  │             │  │             │              │
│  │• UDP        │  │• Available  │  │• Stream     │              │
│  │  Responses  │  │  services   │  │  naming     │              │
│  │• Service    │  │• Protocol   │  │• Protocol   │              │
│  │  catalog    │  │  versions   │  │  versions   │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                                                                 │
│  NOTE: Discovery-only, no routing or message coordination       │
└─────────────────────────────────────────────────────────────────┘
```

## Current Implementation Status

### ✅ Implemented Components

#### 1. UDP Broadcast Service Discovery

- **Location**: `src/network/udp-server.ts`, `src/network/broadcast-udp-server.ts`
- **Purpose**: ServiceProviders find ServiceManager via UDP broadcast
- **Protocol**: Broadcast message "Bonjour and EnjoIT."
- **Response**: JSON containing ServiceManager info and available services

#### 2. TCP Server for Connections

- **Location**: `src/network/tcp-server.ts`
- **Purpose**: Handle incoming TCP connections for responses
- **Features**: Connection tracking, retry logic, graceful shutdown
- **Events**: Connection, Data, Close, Error events

#### 3. ServiceManager Orchestration

- **Location**: `src/manager/service-manager.ts`
- **Purpose**: Coordinate UDP/TCP server lifecycle
- **Features**: Server state management, metrics initialization

#### 4. Basic OpenTelemetry Metrics

- **Location**: `src/metrics/otel-metrics.ts`
- **Metrics**:
  - `method_execution_time`: Histogram for method timing
  - `retry_attempts_total`: Counter for retry operations
  - `server_state`: Observable gauge for server state
  - `active_connections`: UpDownCounter for TCP connections
  - `bytes_total`: Counter for network throughput

#### 5. Dependency Injection

- **Location**: `src/aop/container.ts`
- **Framework**: InversifyJS
- **Features**: Singleton and transient scopes, service activation

#### 6. Winston Logging

- **Location**: `src/common/logger.ts`
- **Features**: JSON/console formats, daily rotation, structured logging

### 🔄 Future Redis Integration (Planned)

#### 1. Redis Stream Communication

- **Purpose**: Cross-service RPC via Redis streams
- **Stream Naming**: `{ServiceName}-{ProtocolVersion}`
- **Consumer Groups**: Automatic load balancing across instances
- **Examples**:
  - `OrderService-v1.0` - Stream for OrderService v1.0 instances
  - `PaymentService-v1.2` - Stream for PaymentService v1.2 instances
  - `UserService-v1.0` - Stream for UserService v1.0 instances

#### 2. Cross-Service RPC Flow

```
SP A (OrderService) → Publish to "PaymentService-v1.2" → Redis LB → SP B (PaymentService)
                                                                        ↓
SP A (OrderService) ← TCP Response ← SP B (PaymentService) ← Process Request
```

#### 3. Enhanced Metrics for Redis

- Stream consumer lag
- Message processing time
- Load distribution efficiency
- Cross-service communication latency

#### 4. Distributed Tracing for Redis

- Stream publishing spans
- Consumer group distribution spans
- Cross-service correlation tracking

## OpenTelemetry Integration

### Current Metrics Implementation

#### 1. Application-Level Metrics

```typescript
// Method execution time
executionTime.record(duration, {
  class: className,
  method: methodName,
});

// Retry tracking
retryAttempts.add(1, {
  jobId: jobId,
  reason: reason,
});

retryDuration.record(duration, {
  jobId: jobId,
  attempt: attempt,
});
```

#### 2. Network-Level Metrics

```typescript
// Server state monitoring
serverState.addCallback(ServerStateMetric.createCallback());

// Active connections
activeConnections.add(1, {
  direction: "inbound",
  "peer.address": address,
  "peer.port": port,
});

// Network throughput
bytesCounter.add(data.length, {
  protocol: "TCP",
  direction: "sent",
});
```

### Planned Tracing Implementation

#### 1. UDP Discovery Tracing

```typescript
const discoverySpan = OtelTracing.createNetworkSpan("broadcast", "udp", {
  attributes: {
    "network.broadcast.type": "service_discovery",
    "messaging.protocol": "udp",
  },
});

const responseSpan = OtelTracing.createNetworkSpan("response", "udp", {
  attributes: {
    "network.response.content": "service_catalog",
    "network.peer.address": rinfo.address,
  },
});
```

#### 2. TCP Connection Tracing

```typescript
const connectionSpan = OtelTracing.createNetworkSpan("accept", "tcp", {
  attributes: {
    "network.peer.address": socket.remoteAddress,
    "network.peer.port": socket.remotePort,
    "network.connection_id": generateConnectionId(),
  },
});
```

#### 3. Future Redis Tracing (Planned)

```typescript
// Cross-service communication
const rpcSpan = OtelTracing.createSpan("rpc.cross_service", {
  attributes: {
    "rpc.communication_type": "redis_stream",
    "rpc.target_service": "PaymentService-v1.2",
  },
});

const publishSpan = OtelTracing.createSpan("redis.publish", {
  attributes: {
    "messaging.destination": "PaymentService-v1.2",
    "messaging.operation": "publish",
  },
});
```

## AOP Implementation

### Method Decorators

```typescript
@traceable("service_provider")
@injectable()
export class ServiceProvider {
  @traceMethod("udp.broadcast_discovery", {
    kind: SpanKind.CLIENT,
  })
  public async discoverServices(): Promise<ServiceCatalog> {
    // Business logic with automatic tracing
  }

  @traceMethod("tcp.handle_connection", {
    kind: SpanKind.SERVER,
  })
  public async handleConnection(socket: TcpSocket): Promise<void> {
    // Connection handling with automatic tracing
  }
}
```

### Benefits of Method Decorators

- **DI Compatible**: Works with InversifyJS lifecycle
- **Type Safe**: Full TypeScript support
- **Explicit**: Clear method-level instrumentation
- **Maintainable**: No runtime proxy manipulation

## Data Flow

### Current Flow (Non-Redis)

```
1. SP starts → UDP broadcast → Find SM
2. SM responds → Service catalog
3. SP listens → TCP connections
4. TCP connection → Process request
5. Direct response → Back to client
```

### Future Flow (With Redis)

```
1. SP starts → UDP broadcast → Find SM
2. SM responds → Service catalog + Redis config
3. SP joins → Consumer group for own stream
4. SP processes → Requests from own stream
5. SP needs help → Publish to target service stream
6. Redis LB → Random target instance
7. Target instance → Process request
8. Target responds → TCP back to requester
9. Requester → Completes processing
10. Requester responds → Original requester
```

## Configuration

### Service Types

- **ServiceProvider**: Multi-role distributed service
- **ServiceManager**: Discovery-only coordinator

### Network Configuration

- **TCP**: Bidirectional communication for responses
- **UDP**: Broadcast for service discovery
- **Redis**: Future message queuing and load balancing

### Stream Naming Convention

- **Format**: `{ServiceName}-{ProtocolVersion}`
- **Purpose**: Version compatibility and service identification
- **Example**: `OrderService-v1.0` → For all OrderService v1.0 instances

## Scalability Considerations

### Current Scaling (Non-Redis)

- Vertical scaling: More CPU/memory per instance
- Manual load balancing: External load balancer required
- Connection limits: TCP connection constraints

### Future Scaling (With Redis)

- Horizontal scaling: Add SP instances freely
- Automatic load balancing: Redis consumer groups
- Fault tolerance: Redis redistributes on failures
- Protocol versioning: Compatible service versions

## Security Considerations

### Current Security

- No authentication implemented
- No encryption for network traffic
- Open UDP broadcast ports

### Future Security (Planned)

- Service authentication via tokens
- TLS encryption for TCP responses
- Redis authentication and ACLs
- Service registration validation

## Monitoring & Observability

### Current Metrics

- Method execution time
- Network connection counts
- Server state monitoring
- Retry attempt tracking

### Future Metrics (Planned)

- Redis stream lag
- Cross-service latency
- Load distribution efficiency
- Consumer group health

### Current Logging

- Structured JSON logging
- Daily log rotation
- Service-aware context

### Future Logging (Planned)

- Correlated logs with trace IDs
- Cross-service log aggregation
- Real-time log analysis

## Error Handling

### Current Error Handling

- Network retry logic
- Graceful connection cleanup
- Winston error logging

### Future Error Handling (Planned)

- Redis connection resilience
- Circuit breaker patterns
- Distributed error tracking

## Testing Strategy

### Current Testing

- Unit tests for individual components
- Integration tests for network flows
- Mock-based testing for dependencies

### Future Testing (Planned)

- End-to-end RPC flow testing
- Redis cluster testing
- Load testing for scalability
- Fault injection testing

## Directory Structure

```
src/
├── main.ts                     # Entry point
├── aop/                        # Aspect-Oriented Programming components
│   ├── container.ts            # Dependency injection setup
│   ├── di-types.ts             # DI type definitions
│   ├── exec-time-interceptor.ts # Execution time interception (current - needs fix)
│   └── [future-decorators.ts]  # Method decorators (planned)
├── common/                     # Shared utilities and configuration
│   ├── config.ts               # Configuration management
│   ├── logger.ts               # Logging system
│   ├── abort-aware.ts          # Abort controller utilities
│   └── retry.ts                # Retry logic
├── manager/                    # Service coordination components
│   └── service-manager.ts      # Main service coordinator
├── metrics/                    # Metrics collection and reporting
│   ├── otel-metrics.ts         # OpenTelemetry integration
│   └── [otel-tracing.ts]       # Distributed tracing (planned)
├── network/                    # Network communication layers
│   ├── tcp-server.ts           # TCP protocol implementation
│   ├── udp-server.ts           # UDP protocol implementation
│   ├── broadcast-udp-server.ts # Broadcast UDP implementation
│   └── typed-event-emitter.ts  # Event system
└── types/                      # Type definitions
    ├── basal-protocol.ts       # Protocol definitions
    └── [redis-types.ts]        # Redis integration types (planned)
```

## Coding Standards & Best Practices

According to project rules:

- All new files should be written in TypeScript
- Use TypeDoc style comments for documentation
- Generate documentation for classes, public/protected methods, and APIs
- Follow the existing codebase patterns when implementing new features
- Get configuration from ConfigManager singleton (`src/common/config.ts`)
- Get logger from LoggerManager singleton (`src/common/logger.ts`)

## Testing

The project uses vitest as its testing framework with test files located in `/src/__tests__/`. The tests cover:

- Integration testing
- Setup and teardown procedures
- Testing should cover 100% of lines and public/protected functions, and >75% branches coverage

## Future Roadmap

### Phase 1: AOP Fixes (Current Issue)

- [ ] Replace proxy-based AOP with method decorators
- [ ] Add distributed tracing for UDP discovery
- [ ] Add distributed tracing for TCP connections
- [ ] Enhance OpenTelemetry metrics

### Phase 2: Redis Integration

- [ ] Redis stream client implementation
- [ ] Consumer group management
- [ ] Cross-service RPC flow
- [ ] Enhanced Redis metrics and tracing

### Phase 3: Production Readiness

- [ ] Authentication and authorization
- [ ] TLS encryption
- [ ] Performance optimization
- [ ] Monitoring and alerting
