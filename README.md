# distributedRPC.js

[![Node](https://img.shields.io/badge/Node-%3E%3D18.0-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue)](LICENSE)
[![Coverage](https://img.shields.io/badge/Coverage-0%25-orange)](.github/workflows/ci.yml)
[![Stars](https://img.shields.io/github/stars/anomalyco/distributedRPC.js)](https://github.com/anomalyco/distributedRPC.js)

## This project is under construction, it doesn't work right now.

Node.js implementation of distributed RPC service framework with Redis-based message queuing and OpenTelemetry observability. Aim at zero-config (or as less as possible), horizontal scalable and self-healing.

## Architecture

### Components

**ServiceProvider (SP)**

- Multi-role distributed service that acts as both client and server
- **Server Role**: Consumes requests from Redis streams and processes them
- **Client Role**: Sends requests to other services via Redis streams
- **Response Role**: Handles TCP responses from target services
- **Discovery Role**: Uses UDP broadcast to find ServiceManager

**ServiceManager (SM)**

- Coordinator service for service discovery only
- Responds to UDP broadcast queries with available service information
- Provides stream naming conventions and Redis configuration
- **No routing or message coordination** - Pure discovery service

### Redis-Based Distributed RPC Flow

```
┌─────────────────┐    UDP Discovery    ┌─────────────────┐
│ ServiceProvider │◄───────────────────►│ ServiceManager  │
│     (SP A)      │   (Find SM)         │  (Discovery)    │
└─────────────────┘                     └─────────────────┘
         │
         │ "Available Services: OrderService-v1.0, PaymentService-v1.2"
         │
         │ Publish to PaymentService-v1.2 stream
         ▼
┌─────────────────┐
│ ServiceProvider │  ← Direct publish to target service stream
│     (SP A)      │  ← (OrderService publishing to PaymentService stream)
│   (Client)      │
└─────────────────┘
         │
         │ Redis Load Balances to any PaymentService v1.2 instance
         │ (Automatic distribution via consumer groups)
         ▼
┌─────────────────┐                             ┌─────────────────┐
│ ServiceProvider │◄── Redis Load Balanced ────►│ PaymentService  │
│   (SP B)        │     (Any v1.2 instance)     │   (Any instance)│
│   (Server)      │                             └─────────────────┘
└─────────────────┘
         │
         │ TCP Response: PaymentService → OrderService
         ▼
[Original Requester] ◄── Final Response ────────┘
```

### Key Architectural Principles

**1. Stream Naming Convention**

- Format: `{ServiceName}-{ProtocolVersion}`
- Examples: `OrderService-v1.0`, `PaymentService-v1.2`, `UserService-v1.0`
- Protocol version ensures data structure compatibility

**2. Elastic Distribution via Redis**

- Multiple SP instances of same version share one Redis stream
- Redis consumer groups automatically balance load
- Easy horizontal scaling: just add SP instances to consumer groups
- Fault tolerance: Redis redistributes if instances fail

**3. Direct SP-to-SP Communication**

- SP A publishes directly to SP B's stream (not its own)
- No ServiceManager routing - pure direct communication
- Target service responds via TCP directly to requesting service

**4. Multi-Role ServiceProviders**

- Each SP can be client, server, response handler simultaneously
- Automatic role switching based on operation context
- Elastic scaling per service type via consumer groups

### Current Implementation

**Implemented Components:**

- ✅ UDP broadcast service discovery
- ✅ TCP server for connection handling
- ✅ Basic OpenTelemetry metrics (execution time, network stats)
- ✅ Correlation ID propagation
- ✅ InversifyJS dependency injection
- ✅ AOP method decorators (InversifyJS compatible)
- ✅ Winston logging with rotation

**Future Redis Integration (Planned):**

- 🔄 Redis stream publishing/consuming
- 🔄 Consumer groups for load balancing
- 🔄 Cross-service RPC via Redis streams
- 🔄 Enhanced distributed tracing

### OpenTelemetry Integration

**Metrics:**

- `method_execution_time`: Service method execution timing
- `retry_attempts_total`: Total retry attempts
- `server_state`: Observable server state gauge
- `active_connections`: Active TCP connections counter
- `bytes_total`: Network throughput metrics

**Tracing:**

- UDP broadcast discovery spans
- TCP connection lifecycle spans
- Cross-component correlation tracking
- Error handling and status reporting

**Logging:**

- Structured JSON logging with Winston
- Daily log rotation
- Service-aware logging with context
- OpenTelemetry correlation ID integration

### Dependency Injection & AOP

**InversifyJS Container:**

- Automatic dependency resolution
- Singleton and transient scope management
- Service activation interception

**AOP Method Decorators:**

- `@traceable()` - Class-level instrumentation
- `@traceMethod()` - Method-level tracing
- Automatic span creation and correlation
- DI-compatible (no proxy objects)

### Getting Started

```bash
# Install dependencies
pnpm install

# Build TypeScript
pnpm run build

# Run tests
pnpm test

# Start development server
pnpm run dev
```

### Configuration

```yaml
# config.yml.
# Remarked options are default configurations.
# If the `service_name` option is omitted, class name of the service will be used.
app:

core:
  service_name: "OrderService"
#   net:
#     tcp_address: 0.0.0.0
#     tcp_port: 0
#     udp_address: 0.0.0.0
#     udp_port: 5707
#   retry:
#     backoff:
#       enable: false
#       max_delay: 240000 # 4 minutes.
#       multiplier: 2
#     interval: 2000
#     max_try: 0 # Infinite retry.

# log:
#   format: "console" # or "json"
#   log_level: "info"
#   max_files: "14d"
#   max_size: "20m"
```

### License

Apache 2.0
