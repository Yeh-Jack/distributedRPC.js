# Architecture Documentation

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
│  │  Discovery  │  │   Service   │  │  Report     │              │
│  │   Handler   │  │   Registry  │  │  Storage    │              │
│  │             │  │             │  │             │              │
│  │• UDP        │  │• Available  │  │• Report     │              │
│  │  Responses  │  │  services   │  │  history    │              │
│  │• Service    │  │• Protocol   │  │• Metrics    │              │
│  │  catalog    │  │  versions   │  │  collection │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                                                                 │
│  NOTE: Discovery + Registry, no routing or message coordination │
└─────────────────────────────────────────────────────────────────┘
```

## Implemented Components

### 1. UDP Broadcast Service Discovery

**Location**: `src/network/udp-server.ts`, `src/network/broadcast-udp-server.ts`, `src/network/udp-discovery.ts`

**Purpose**: ServiceProviders find ServiceManager via UDP broadcast

**Flow**:
1. ServiceProvider sends broadcast probe: `"Bonjour and EnjoIT."`
2. ServiceManager responds with JSON containing manager info
3. ServiceProvider connects to ServiceManager via TCP

**Protocol**: Broadcast message "Bonjour and EnjoIT."

### 2. TCP Server for Connections

**Location**: `src/network/tcp-server.ts`

**Purpose**: Handle incoming TCP connections for RPC

**Features**:
- Connection tracking
- Retry logic with exponential backoff
- Graceful shutdown
- Events: Connection, Data, Close, Error

### 3. TCP Client for RPC

**Location**: `src/network/tcp-client.ts`

**Purpose**: Make outbound RPC calls

**Features**:
- Auto-generated message IDs
- Correlation ID tracking
- Connection management

### 4. ServiceManager Orchestration

**Location**: `src/manager/service-manager.ts`

**Purpose**: Coordinate UDP/TCP server lifecycle

**Features**:
- Server state management
- Service registry
- Report data storage
- Metrics initialization

### 5. OpenTelemetry Metrics

**Location**: `src/metrics/otel-metrics.ts`

**Metrics**:
- `method_execution_time`: Histogram for method timing
- `retry_attempts_total`: Counter for retry operations
- `server_state`: Observable gauge for server state
- `active_connections`: UpDownCounter for TCP connections
- `bytes_total`: Counter for network throughput
- `tcp_connection_duration`: Histogram for connection lifetime
- `udp_broadcast_latency`: Histogram for discovery latency

### 6. OpenTelemetry Tracing

**Location**: `src/metrics/otel-tracing.ts`

**Current Implementation**:
- Singleton `OtelTracer` for centralized tracer management
- Network spans for TCP connection lifecycle (accept, connect, write, read)
- Broadcast spans for UDP discovery operations
- Correlation ID generation for request tracking

**Current Spans Created**:
| Span Name | Kind | Location | Purpose |
|-----------|------|----------|---------|
| `network.accept` | SERVER | tcp-server.ts | TCP connection accepted |
| `network.connect` | CLIENT | tcp-client.ts | TCP connection established |
| `network.write` | CLIENT | tcp-client.ts | Data written to socket |
| `network.read` | CLIENT | tcp-client.ts | Data read from socket |
| `broadcast.discover_manager` | CLIENT | udp-discovery.ts | UDP discovery probe sent |
| `broadcast.discovery_received` | SERVER | broadcast-udp-server.ts | UDP discovery received |

**Attributes Added to Spans**:
- `network.operation`: Operation type (accept, connect, write, etc.)
- `network.protocol`: TCP or UDP
- `network.direction`: In or Out
- `network.peer.address`: Peer IP address
- `network.peer.port`: Peer port
- `correlation.id`: Request correlation ID

**Known Limitations**:
- No W3C TraceContext propagation across service boundaries
- No span creation for API request handling in ServiceProvider
- No end-to-end tracing for cross-service calls
- Response header lacks trace context

**See [TRACING.md](TRACING.md) for detailed analysis and recommended fixes.**

### 7. Dependency Injection

**Location**: `src/aop/container.ts`

**Framework**: InversifyJS

**Features**:
- Singleton and transient scopes
- Service activation interception
- Factory functions for network components

### 8. Winston Logging

**Location**: `src/common/logger.ts`

**Features**:
- JSON/console formats
- Daily rotation
- Structured logging
- Service-aware context

## Data Flow

### ServiceProvider Startup Flow

```
1. Constructor
   ├── Initialize PROTOCOL with provider metadata
   ├── Create ConfigManager
   └── Initialize IdGenerator

2. start()
   ├── Check state (must be Error|Initializing|Retrying|Stopped)
   ├── _initializeResources()
   │   ├── Initialize OpenTelemetry
   │   ├── Start response channel TCP server
   │   └── Initialize API function map
   ├── _discoverServiceManager()
   │   └── Execute DiscoverProcedure (UDP broadcast)
   ├── starting() [subclass hook]
   └── _startReportSchedule()

3. Running State
   ├── API channel accepts requests
   └── Automatic reports every 60s (configurable)

4. stop()
   ├── stopping() [subclass hook]
   ├── Stop all tasks except ServiceManager task
   ├── Stop report schedule
   └── State → Stopped
```

### ServiceManager Lifecycle

```
1. Constructor
   ├── Initialize SPEC_SVC_MGR_260321 protocol
   ├── Create ServiceManagerConfig
   └── Set sm_discovery = None (doesn't discover itself)

2. start()
   ├── setApiChannel(true) - Listen for register/report
   └── _initializeBroadcastListener("reception")
       ├── Build BroadcastResponse with manager info
       └── Start BroadcastUdpServer

3. API Handlers
   ├── register(peer, data) → _putProvider(data)
   └── gotReport(peer, data) → Store ReportData

4. stop()
   ├── setApiChannel(false)
   └── stopping() [subclass hook]
```

## State Machine

```
ExecutionState enum:
  Stopped → Initializing → Starting → Running
                                ↓         ↓
                           Listening   Stopping → Stopped
                                ↓
                              Halting → Halt

  Error ← any state (on error)
  Retrying ← Starting (on bind failure, before max retries)
```

## Task Management

Services maintain a `tasks: Map<string, any>` for managing network resources:

```typescript
// Task channels
const _TASK_CHANNEL_API = "_chnAPI";    // Accept API requests
const _TASK_CHANNEL_RESPONSE = "_chnResponse";  // Send responses
const _TASK_MANAGER = "_svcManager";    // Connection to ServiceManager
```

## Message Protocol

### API Request (via TCP)

```json
{
  "peer": { "service": "OrderService", "instance": "abc123" },
  "api": "register",
  "args": { /* RegisterInfo */ },
  "msgId": "uuid-v4"
}
```

### Response Header (64 bytes)

- Byte 0: Success flag (1=success, 0=failure)
- Bytes 1-63: Message ID (null-padded UUID)

## Event System

```typescript
enum NetworkEvent {
  Listening = "listening",   // Server bound and ready
  Connect = "connect",       // Client connected (TCP)
  Connection = "connection",  // New client (TCP server)
  Data = "data",             // Data received (TCP)
  Message = "message",       // Message received (UDP)
  Close = "close",          // Connection closed
  Error = "error",           // Error occurred
  Stop = "stop",             // Server stopped
}
```

## Future Planned Features

### Redis Stream Communication (Planned)

- **Purpose**: Cross-service RPC via Redis streams
- **Stream Naming**: `{ServiceName}-{ProtocolVersion}`
- **Consumer Groups**: Automatic load balancing across instances

### Enhanced Metrics (Planned)

- Stream consumer lag
- Message processing time
- Load distribution efficiency
- Cross-service communication latency

### Enhanced Tracing (Planned)

- Stream publishing spans
- Consumer group distribution spans
- Cross-service correlation tracking

## Security Considerations

### Current

- No authentication implemented
- No encryption for network traffic
- Open UDP broadcast ports

### Future Planned

- Service authentication via tokens
- TLS encryption for TCP responses
- Redis authentication and ACLs
- Service registration validation