# API Documentation

## Table of Contents

1. [ServiceProvider](#serviceprovider)
2. [ServiceManager](#servicemanager)
3. [Network Classes](#network-classes)
4. [Procedures](#procedures)
5. [Configuration](#configuration)
6. [Types](#types)
7. [Constants](#constants)

---

## ServiceProvider

**File**: `src/provider/service-provider.ts`

Base class for all distributed services.

### Constructor

```typescript
constructor(idGenerator: IdGenerator)
```

### Public Methods

#### `start(): Promise<void>`
Starts all services including TCP and UDP listeners.

#### `stop(): Promise<void>`
Stops all registered services.

#### `shutdown(): Promise<void>`
Shuts down the service gracefully. Stops all services, frees allocated resources, and cleans up OpenTelemetry metrics.

#### `restart(): Promise<void>`
Restart performs stop, reload, and start in sequence.

#### `register(): Promise<void>`
Registers this service with the ServiceManager.

#### `report(): Promise<void>`
Reports current runtime metrics to the ServiceManager.

#### `reload(): Promise<void>`
Reloads configuration only.

#### `getServiceName(): string`
Returns the configured service name.

#### `getState(): ExecutionState`
Returns the current service state.

#### `getMetrics(): OtelMeterics`
Returns the metrics instance for this service.

#### `getConfigManager(): ConfigManager`
Returns the configuration manager.

#### `getLogger(): Logger`
Returns the logger instance.

#### `getProtocol(): Promise<string>`
Returns JSON representation of the service protocol.

#### `logProtocol(): void`
Logs the protocol of the service.

### Protected Methods (for subclass override)

#### `buildAccessPointInfo(baseInfo: AccessPoint): AccessPoint`
Provide actual access point information. Must be implemented by subclasses.

#### `starting(): Promise<void>`
Hook for subclass initialization. Called during start().

#### `stopping(): Promise<void>`
Hook for subclass cleanup. Called during stop().

#### `initializingResources(): Promise<void>`
Hook for subclass resource initialization.

#### `releasingResources(): Promise<void>`
Hook for subclass resource cleanup.

#### `reloading(): Promise<void>`
Hook for subclass configuration reload.

#### `ask(helper: TcpClient, message: ApiCall, ackType: AckType): Promise<{ msgId: string; promise?: Promise<any> }>`
Send an API request with acknowledgment handling.

#### `buildMessage(apiPath: string, args?: any, msgId?: string): ApiCall`
Build an API call message.

#### `getResponseChannel(data: ApiCall): Promise<TcpClient>`
Get or create a response channel to a peer.

---

## ServiceManager

**File**: `src/manager/service-manager.ts`

Extends `ServiceProvider`. Central orchestration service for distributed RPC system management.

### Constructor

```typescript
constructor(idGenerator: IdGenerator)
```

### Public Methods

#### `gotReport(data: ApiCall): Promise<void>`
Receives and stores report data from service providers.

#### `getReports(peer: PeerIdentity): ReportData[]`
Gets all reports for a specific provider instance.

#### `getLatestReport(peer: PeerIdentity): ReportData | undefined`
Gets the latest report for a specific provider instance.

#### `clearReports(peer: PeerIdentity): void`
Clears all reports for a specific provider instance.

#### `getReportedInstances(): PeerIdentity[]`
Gets all registered services with their instance IDs.

#### `getTcpServer(name: string): TcpServer | undefined`
Retrieves a registered TCP server by name.

#### `getUdpServer(name: string): BroadcastUdpServer | undefined`
Retrieves a registered UDP server by name.

### Protected Methods

#### `registrar(data: ApiCall): Promise<void>`
Handles service registration.

#### `buildAccessPointInfo(baseInfo: AccessPoint): AccessPoint`
Override to provide ServiceManager-specific access point info.

---

## Network Classes

### TcpServer

**File**: `src/network/tcp-server.ts`

Event-driven TCP server for distributed RPC communication.

#### Constructor

```typescript
constructor(configManager: ConfigManager, name?: string)
```

#### Public Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `Promise<void>` | Starts the TCP server |
| `stop()` | `Promise<void>` | Stops the server and closes connections |
| `broadcast(data: Buffer \| string)` | `number` | Broadcast data to all clients |
| `getPort()` | `number` | Get listening port |
| `getState()` | `ExecutionState` | Get server state |
| `getRxBytes()` | `number` | Get total received bytes |
| `getTxBytes()` | `number` | Get total transmitted bytes |
| `getServer()` | `Server \| undefined` | Get underlying server |
| `resetByteCounters()` | `void` | Reset byte counters |

#### Events

- `NetworkEvent.Listening` - Server is ready
- `NetworkEvent.Connection` - New client connected
- `NetworkEvent.Data` - Data received
- `NetworkEvent.Close` - Connection closed
- `NetworkEvent.Error` - Error occurred

---

### TcpClient

**File**: `src/network/tcp-client.ts`

TCP client for making RPC calls.

#### Constructor

```typescript
constructor(
  configManager: ConfigManager,
  ap: AccessPoint,
  name?: string,
  idGenerator?: IdGenerator
)
```

#### Public Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `Promise<void>` | Connects to remote server |
| `stop()` | `Promise<void>` | Disconnects |
| `sendMessage(message: ApiCall)` | `Promise<string>` | Send message, returns msgId |
| `write(data: Buffer \| string)` | `Promise<string>` | Write raw data |
| `writeWithId(data: Buffer \| string, msgId: string)` | `Promise<string>` | Write with specific msgId |
| `setAccessPoint(ap: AccessPoint)` | `void` | Update access point |
| `getAccessPoint()` | `AccessPoint` | Get current access point |
| `getSocket()` | `TcpSocket` | Get underlying socket |
| `getState()` | `ExecutionState` | Get client state |
| `getRxBytes()` | `number` | Get received bytes |
| `getTxBytes()` | `number` | Get transmitted bytes |

#### Events

- `NetworkEvent.Connect` - Connected to server
- `NetworkEvent.Data` - Data received
- `NetworkEvent.Close` - Connection closed
- `NetworkEvent.Error` - Error occurred

---

### UdpServer

**File**: `src/network/udp-server.ts`

Base UDP server class.

#### Constructor

```typescript
constructor(configManager: ConfigManager, name?: string)
```

#### Public Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `Promise<void>` | Starts the UDP server |
| `stop()` | `Promise<void>` | Stops the server |
| `getReadySocket()` | `UdpSocket` | Get the bound socket |
| `getState()` | `ExecutionState` | Get server state |
| `getPort()` | `number` | Get listening port |

---

### UdpClient

**File**: `src/network/udp-client.ts`

UDP client for sending datagrams.

#### Constructor

```typescript
constructor(configManager: ConfigManager, name?: string)
```

#### Public Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `Promise<void>` | Starts the UDP client |
| `stop()` | `Promise<void>` | Stops the client |
| `setBroadcast(enabled: boolean)` | `Promise<void>` | Enable/disable broadcast |
| `sendAndWait(message: Buffer \| string, options: SendOptions)` | `Promise<UdpResponse>` | Send and wait for response |

#### SendOptions

```typescript
interface SendOptions {
  address?: string;
  port: number;
  timeout?: number;
}
```

---

### UdpDiscovery

**File**: `src/network/udp-discovery.ts`

Extends `UdpClient`. UDP broadcast discovery client.

#### Constructor

```typescript
constructor(configManager: ConfigManager, name?: string)
```

#### Public Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `Promise<void>` | Starts the discovery client |
| `discover(options?: DiscoveryOptions)` | `Promise<DiscoveryResult>` | Discover ServiceManagers |
| `discoverOne(options?: DiscoveryOptions)` | `Promise<DiscoveryResult>` | Discover single ServiceManager |

#### DiscoveryOptions

```typescript
interface DiscoveryOptions extends SendOptions {
  maxResponses: number;
}
```

#### DiscoveryResult

```typescript
interface DiscoveryResult {
  responses: BroadcastResponse260321[];
  durationMs: number;
  responseCount: number;
}
```

---

### BroadcastUdpServer

**File**: `src/network/broadcast-udp-server.ts`

Extends `UdpServer`. UDP server for responding to discovery probes.

#### Constructor

```typescript
constructor(configManager: ConfigManager, name?: string)
```

#### Public Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `Promise<void>` | Starts the broadcast server |
| `stop()` | `Promise<void>` | Stops the server |
| `setManagerInfo(info: BroadcastResponse260321)` | `void` | Set manager info to broadcast |

---

### TypedEventEmitter

**File**: `src/network/typed-event-emitter.ts`

Type-safe event emitter for network events.

```typescript
class TypedEventEmitter<TEventMap> extends EventEmitter {
  on<K extends keyof TEventMap>(event: K, listener: TEventMap[K]): this;
  once<K extends keyof TEventMap>(event: K, listener: TEventMap[K]): this;
  off<K extends keyof TEventMap>(event: K, listener: TEventMap[K]): this;
  emit<K extends keyof TEventMap>(event: K, ...args: Parameters<TEventMap[K]>): boolean;
}
```

---

## Procedures

### Procedure (Base Class)

**File**: `src/procedure/procedure.ts`

#### Constructor

```typescript
constructor(configManager: ConfigManager)
```

#### Public Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `execute(context?: ProcedureContext)` | `Promise<any>` | Execute the procedure |
| `getContext()` | `ProcedureContext` | Get current context |
| `setConfigManager(configManager: ConfigManager)` | `void` | Set config manager |

#### Protected Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `delay(ms: number)` | `Promise<void>` | Utility delay |
| `getTcpClient(name: string, ap?: AccessPoint)` | `Promise<TcpClient>` | Create TCP client |
| `getTcpServer(name: string)` | `Promise<TcpServer>` | Create TCP server |

---

### DiscoverProcedure

**File**: `src/procedure/discover.ts`

Finds ServiceManager via UDP broadcast.

#### Context

```typescript
interface ProcedureContext {
  parent?: ServiceProvider;
  taskName: string;
  tasks: Map<string, any>;
  idGenerator: IdGenerator;
  result?: any;
}
```

#### Returns

```typescript
interface ManagerInfo {
  managerInfo: BroadcastResponse260321[];
  manager: any;
  instance: TcpClient | null;
}
```

---

### RegisterProcedure

**File**: `src/procedure/register.ts`

Registers service with ServiceManager.

#### Context

```typescript
interface RegisterContext extends ProcedureContext {
  manager: { manager: RegisterManagerInfo };
  protocol: BasalProtocol;
  smTaskName: string;
  ask: (helper: TcpClient, message: ApiCall, ackType: AckType) => Promise<{ msgId: string; promise?: Promise<any> }>;
  buildMessage: (apiPath: string, args?: any, msgId?: string) => ApiCall;
  getTcpTaskInfo: (taskName: string) => AccessPoint;
}
```

#### Returns

`boolean` - true on success

---

### ReportProcedure

**File**: `src/procedure/report.ts`

Sends metrics to ServiceManager.

#### Context

```typescript
interface ReportContext extends ProcedureContext {
  apiCounter: Map<string, Omit<ApiCounter, "total">>;
  manager: { manager: ReportManagerInfo };
  ask: (helper: TcpClient, message: ApiCall, ackType: AckType) => Promise<{ msgId: string; promise?: Promise<any> }>;
  buildMessage: (apiPath: string, args?: any, msgId?: string) => ApiCall;
}
```

---

## Configuration

### ConfigManager

**File**: `src/common/config.ts`

#### Constructor

```typescript
constructor(providerName?: string)
```

#### Public Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `getConfig()` | `ProviderConfig<T_App, T_Core>` | Get full config |
| `getCoreConfig()` | `T_Core` | Get core config |
| `getAppConfig()` | `T_App` | Get app config |
| `getAppEnv()` | `AppEnv` | Get environment |
| `getProviderId()` | `string` | Get provider ID |
| `getLogger()` | `Logger` | Get logger |
| `getLoggerManager()` | `LoggerManager` | Get logger manager |
| `reload()` | `Promise<void>` | Reload configuration |

---

## Types

### ExecutionState

**File**: `src/types/basal-protocol.ts`

```typescript
enum ExecutionState {
  Error = "Error",
  Halt = "Halt",
  Halting = "Halting",
  Initializing = "Initializing",
  Listening = "Listening",
  Retrying = "Retrying",
  Running = "Running",
  Starting = "Starting",
  Stopping = "Stopping",
  Stopped = "Stopped",
}
```

### AckType

```typescript
enum AckType {
  None = "None",    // No ACK
  Single = "Single",  // Send ACK after processing
  Double = "Double",  // Requester confirms receipt
}
```

### AckValue

```typescript
enum AckValue {
  Ack = "Ack",
  Error = "Error",
  InvalidReqData = "InvalidReqData",
  None = "None",
}
```

### ApiCall

```typescript
interface ApiCall {
  peer: PeerIdentity;
  api: string;
  args: any | undefined;
  msgId: string | undefined;
  promise?: {
    resolve: Function;
    reject: Function;
  };
}
```

### AccessPoint

```typescript
interface AccessPoint extends SocketAddress {
  authorization: string;
  api: string[];
}
```

### SocketAddress

```typescript
interface SocketAddress {
  address: string;
  port: number;
  protocol: NetworkProtocol;
}
```

### ReportData

```typescript
interface ReportData {
  timestamp: number;
  state: ExecutionState;
  ramUsed: number;
  ramFree: number;
  cpuLoad: number;
  netTx: string;
  netTxBytes: number;
  netRx: string;
  netRxBytes: number;
  apiCounter?: Map<string, Omit<ApiCounter, "total">>;
}
```

### NetworkEvent

**File**: `src/network/network-events.ts`

```typescript
enum NetworkEvent {
  Listening = "listening",
  Connect = "connect",
  Connection = "connection",
  Data = "data",
  Message = "message",
  Close = "close",
  Error = "error",
  Stop = "stop",
}
```

---

## Constants

**File**: `src/types/basal-protocol.ts`

```typescript
// Time
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// Protocol
const DEFAULT_ENCODE = "utf-8";
const FOLLOW_UP = "  --> ";
const MAX_HEADER_LEN = 64;
const NO_RESPONSE = "None";
const PROBE_MESSAGE = "Bonjour and EnjoIT.";
const UNKNOWN_ATTRIBUTE = "Unknown";
```

---

## Dependency Injection Types

**File**: `src/aop/di-types.ts`

```typescript
export const TYPES = {
  BroadcastUdpServer: Symbol,
  ConfigManager: Symbol,
  DiscoverProcedure: Symbol,
  IdGenerator: Symbol,
  Logger: Symbol,
  None: Symbol,
  RegisterProcedure: Symbol,
  ReportProcedure: Symbol,
  ServiceManager: Symbol,
  ServiceProvider: Symbol,
  TcpServer: Symbol,
  UdpClient: Symbol,
  UdpDiscovery: Symbol,
  UdpServer: Symbol,
};
```

---

## Container Exports

**File**: `src/aop/container.ts`

```typescript
// Types
export { TYPES };

// Container
export const container: Container;

// Factory functions
export function createNamedTcpServer(configManager: ConfigManager, name: string): TcpServer;
export function createNamedUdpServer(configManager: ConfigManager, name: string, type: Symbol): UdpServer | BroadcastUdpServer;
export function createOtelExporter(configManager: ConfigManager): ConsoleSpanExporter | OTLPTraceExporter;
export function createServiceManagerDiscover(configManager: ConfigManager, name: string, type: Symbol): UdpDiscovery | undefined;

// Provider creation
export async function createProvider<T extends ServiceProvider>(serviceClass: new (...args: any[]) => T): Promise<T>;
```