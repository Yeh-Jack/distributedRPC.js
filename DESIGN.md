# Design Decisions

## Overview

This document captures the key design decisions made in distributedRPC.js to achieve its goals of zero-config service discovery, horizontal scalability, and self-healing.

## Design Principles

### 1. Zero-Configuration Discovery

**Decision**: Use UDP broadcast for service discovery instead of configuration files or environment variables.

**Rationale**:
- Services can join a network without any prior knowledge
- ServiceManager location is discovered automatically
- Reduces operational complexity

**Trade-offs**:
- UDP is unreliable (but discovery is retryable)
- Requires network that supports broadcast/multicast
- Not suitable for cross-datacenter scenarios

**Implementation**:
```typescript
// Probe message format
const PROBE_MESSAGE = "Bonjour and EnjoIT.";

// Response contains manager info
interface BroadcastResponse260321 {
  manager: RegisterInfo;
  redis: any;  // Future Redis configuration
}
```

### 2. Multi-Role ServiceProviders

**Decision**: Each service instance can simultaneously act as client, server, and response handler.

**Rationale**:
- Simplifies deployment (one binary/image per service)
- No separate "client" or "server" mode to configure
- Natural representation of distributed services

**Trade-offs**:
- More complex state management
- Higher resource usage per instance

**Implementation**:
```typescript
class ServiceProvider {
  // TCP server for API requests
  tasks: Map<string, TcpServer>;

  // TCP client for responses
  chnResp: Record<string, Record<string, TcpClient>>;

  // TCP client to ServiceManager
  tasks: Map<string, TcpClient>;
}
```

### 3. Direct SP-to-SP Communication

**Decision**: Services communicate directly with each other, not through ServiceManager.

**Rationale**:
- ServiceManager remains simple (discovery only)
- Lower latency for inter-service communication
- Better scalability (no central bottleneck)

**Trade-offs**:
- Services need to discover each other
- More complex connection management

### 4. Event-Driven Architecture

**Decision**: Use TypedEventEmitter for all network events.

**Rationale**:
- Loose coupling between components
- Easy to extend with new event handlers
- Standard Node.js patterns

**Implementation**:
```typescript
class TcpServer extends TypedEventEmitter<NetworkEventMap> {
  // NetworkEvent.Connection, NetworkEvent.Data, etc.
}

interface NetworkEventMap {
  [NetworkEvent.Listening]: () => void;
  [NetworkEvent.Connection]: (peer: NetworkPeer) => void;
  [NetworkEvent.Data]: (peer: NetworkPeer, data: Buffer) => void;
  // ...
}
```

### 5. Dependency Injection with InversifyJS

**Decision**: Use InversifyJS for dependency injection.

**Rationale**:
- Clear dependency graph
- Easy to mock dependencies in tests
- Lifecycle management built-in

**Implementation**:
```typescript
@injectable()
export class ServiceProvider {
  constructor(
    @inject(TYPES.IdGenerator) protected idGenerator: IdGenerator,
  ) {}
}
```

### 6. OpenTelemetry for Observability

**Decision**: Use OpenTelemetry for metrics and tracing instead of custom solutions.

**Rationale**:
- Industry standard
- Easy integration with observability platforms
- Vendor-neutral

**Metrics Exposed**:
- `method_execution_time` - Histogram
- `retry_attempts_total` - Counter
- `server_state` - ObservableGauge
- `active_connections` - UpDownCounter
- `bytes_total` - Counter
- `tcp_connection_duration` - Histogram
- `udp_broadcast_latency` - Histogram

**Current Tracing Implementation**:
- Singleton `OtelTracer` with `getInstance(providerId)` pattern
- Network spans for TCP/UDP operations
- Correlation ID generation for request tracking
- Service attributes automatically included in spans

**Known Gap**: Cross-service trace context propagation not implemented. See [TRACING.md](TRACING.md) for details.

### 7. Structured Logging with Winston

**Decision**: Use Winston with JSON formatting for production.

**Rationale**:
- Log aggregation and analysis
- Correlation ID tracking
- Log rotation built-in

**Format**:
```json
{
  "level": "info",
  "message": "Service started",
  "service": "OrderService",
  "instance": "abc123",
  "timestamp": "2026-05-02T12:00:00.000Z"
}
```

### 8. Retry with Exponential Backoff

**Decision**: Implement automatic retry with configurable exponential backoff.

**Rationale**:
- Handle transient failures gracefully
- Prevent thundering herd
- Configurable for different use cases

**Configuration**:
```yaml
retry:
  interval: 2000        # Initial interval (ms)
  max_retries: 0        # 0 = infinite
  backoff:
    enabled: true
    max_delay: 240000   # 4 minutes
    multiplier: 2
```

### 9. Lazy Initialization

**Decision**: Use lazy initialization for procedures and expensive resources.

**Rationale**:
- Faster startup time
- Resources created only when needed
- Reduced memory footprint

**Implementation**:
```typescript
// Procedures are lazily imported and created
async register(): Promise<void> {
  const { RegisterProcedure } = await import("../procedure");
  const procedure = new RegisterProcedure(this.configManager);
  // ...
}
```

### 10. Generic Type Safety

**Decision**: Use TypeScript generics for configuration management.

**Rationale**:
- Type-safe configuration access
- IDE autocompletion
- Catch errors at compile time

**Implementation**:
```typescript
class ConfigManager<
  T_App extends AppConfig = AppConfig,
  T_Core extends CoreConfig = CoreConfig,
> {
  getCoreConfig(): T_Core { /* ... */ }
  getAppConfig(): T_App { /* ... */ }
}
```

## Architectural Patterns

### 1. Procedure Pattern

Procedures encapsulate complex multi-step operations:

```typescript
abstract class Procedure {
  async execute(context?: ProcedureContext): Promise<any> {
    // Template method pattern
  }
}

// Concrete procedures
class DiscoverProcedure extends Procedure { /* ... */ }
class RegisterProcedure extends Procedure { /* ... */ }
class ReportProcedure extends Procedure { /* ... */ }
```

### 2. Task Channel Pattern

Named tasks for different network resources:

```typescript
// Task channels (from ProviderTask enum)
ProviderTask.ChannelApi      // API requests
ProviderTask.ChannelResponse  // Responses
ProviderTask.Manager        // ServiceManager connection
```

### 3. Provider State Pattern

Unified state management with OpenTelemetry integration:

```typescript
class ProviderState {
  private _state: ExecutionState;
  private _provider: ProviderInfo;
}

class OtelProviderState extends ProviderState {
  createCallback(): ObservableCallback;
}
```

## Future Design Considerations

### Redis Integration (Planned)

- Stream naming: `{ServiceName}-{ProtocolVersion}`
- Consumer groups for load balancing
- Direct SP-to-SP via Redis instead of TCP

### Authentication (Planned)

- Service tokens for registration
- TLS encryption for all TCP traffic
- mTLS for service-to-service authentication

### Circuit Breaker (Planned)

- Per-service failure tracking
- Automatic failover to healthy instances
- Configurable thresholds

## Anti-Patterns Avoided

| Anti-Pattern | Why Avoided | Alternative |
|--------------|-------------|-------------|
| Singleton abuse | DI container manages lifecycle | InversifyJS singleton scope |
| God objects | Small, focused classes | Procedure pattern |
| Callback hell | async/await everywhere | Promise-based APIs |
| Global state | Context passed through | ConfigManager per service |