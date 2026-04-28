# Implementation Documentation

## Table of Contents

1. [Project Overview](#project-overview)
2. [Directory Structure](#directory-structure)
3. [Key Classes and Relationships](#key-classes-and-relationships)
4. [Public API Exports](#public-api-exports)
5. [Dependency Injection Setup](#dependency-injection-setup-containerts)
6. [Network Layer Architecture](#network-layer-architecture)
7. [ServiceProvider and ServiceManager Lifecycle](#serviceprovider-and-servicemanager-lifecycle)
8. [Procedures (Register, Discover, Report)](#procedures-register-discover-report)
9. [OpenTelemetry Integration](#opentelemetry-integration)
10. [Configuration Management](#configuration-management)
11. [Constants and Enums](#constants-and-enums)

---

## Project Overview

**distributedRPC.js** is a distributed Remote Procedure Call (RPC) framework for Node.js that enables service discovery, inter-service communication, and centralized management through a UDP/TCP network architecture.

### Core Components

- **ServiceProvider (SP)**: Individual service instances that register with and report to a ServiceManager
- **ServiceManager (SM)**: Central coordinator that maintains service registry and enables discovery
- **Network Layer**: TCP for reliable RPC communication, UDP for service discovery via broadcast

### Key Features

- Zero-configuration service discovery via UDP broadcast
- Automatic retry with exponential backoff
- OpenTelemetry metrics and distributed tracing
- Dependency injection via InversifyJS
- Structured JSON logging with daily rotation

---

## Directory Structure

```
src/
├── main.ts                          # Application entry point
├── aop/                             # Aspect-Oriented Programming
│   ├── container.ts                 # InversifyJS DI container setup
│   ├── di-types.ts                  # DI type symbols
│   └── exec-time-interceptor.ts     # Execution time interception (deprecated)
├── common/                          # Shared utilities
│   ├── abort-aware.ts               # Abort signal utilities
│   ├── config.ts                    # Configuration management
│   ├── id-generator.ts              # UUID and short ID generation
│   ├── logger.ts                    # Winston logging with rotation
│   └── retry.ts                     # Retry scheduler with backoff
├── manager/                         # Service coordination
│   ├── api-spec-260321.ts           # ServiceManager API specification
│   └── service-manager.ts           # ServiceManager orchestration
├── metrics/                         # Observability
│   ├── exec-metrics.ts              # Execution metrics recording
│   ├── otel-metrics.ts              # OpenTelemetry metrics
│   ├── otel-resource.ts             # OTel resource attributes
│   └── otel-tracing.ts              # Distributed tracing
├── network/                         # Network communication
│   ├── broadcast-udp-server.ts      # UDP broadcast for discovery responses
│   ├── network-events.ts            # Network event types and utilities
│   ├── tcp-client.ts                # TCP client for RPC
│   ├── tcp-server.ts                # TCP server for RPC
│   ├── typed-event-emitter.ts       # Type-safe event emitter
│   ├── udp-client.ts                # UDP client
│   ├── udp-discovery.ts             # UDP discovery client
│   └── udp-server.ts                # UDP server base
├── procedure/                       # Service procedures
│   ├── discover.ts                  # ServiceManager discovery procedure
│   ├── index.ts                     # Procedure exports
│   ├── procedure.ts                 # Base procedure class
│   ├── register.ts                  # Service registration procedure
│   └── report.ts                    # Metrics reporting procedure
├── provider/                        # ServiceProvider implementation
│   ├── provider-info.ts             # Provider state management
│   └── service-provider.ts          # ServiceProvider base class
└── types/                           # Type definitions
    └── basal-protocol.ts            # Protocol types and constants
```

---

## Key Classes and Relationships

### Class Hierarchy

```
ServiceProvider (extends)
├── ServiceManager

TypedEventEmitter<NetworkEventMap> (extends)
├── TcpServer
├── TcpClient
├── UdpServer
├── UdpClient
└── UdpDiscovery (extends UdpClient)

Procedure (extends, @injectable)
├── DiscoverProcedure
├── RegisterProcedure
└── ReportProcedure
```

### Core Relationships

```
main.ts
├── ServiceProvider (created via createProvider)
└── ServiceManager (created via createProvider)

ServiceProvider
├── uses TcpServer (API channel, response channel)
├── uses TcpClient (to ServiceManager, response channels)
├── uses UdpDiscovery (to find ServiceManager)
└── owns tasks Map (named servers/clients)

ServiceManager
├── uses BroadcastUdpServer (reception)
└── owns _services Map (registered providers)

container.ts
├── creates TcpServer instances
├── creates UdpServer/BroadcastUdpServer instances
└── binds Procedure singletons
```

---

## Public API Exports

### `src/aop/container.ts`

```typescript
// Re-exports TYPES for DI symbol bindings
export { TYPES };

// Global InversifyJS container
export const container: Container;

// Factory functions
export function createNamedTcpServer(
  configManager: ConfigManager,
  name: string,
): TcpServer;
export function createNamedUdpServer(
  configManager: ConfigManager,
  name: string,
  type: Symbol,
): UdpServer | BroadcastUdpServer;
export function createOtelExporter(
  configManager: ConfigManager,
): ConsoleSpanExporter | OTLPTraceExporter;

// Provider creation with DI and instrumentation
export async function createProvider<T extends ServiceProvider>(
  serviceClass: new (...args: any[]) => T,
): Promise<T>;

// Discovery factory
export function createServiceManagerDiscover(
  configManager: ConfigManager,
  name: string,
  type: Symbol,
): UdpDiscovery | undefined;
```

### `src/aop/di-types.ts`

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

### `src/procedure/index.ts`

```typescript
export * from "./procedure"; // Procedure, ProcedureContext
export * from "./discover"; // DiscoverProcedure, ManagerInfo, EVENT_MGR_RESPONSE
export * from "./register"; // RegisterProcedure, RegisterContext, EVENT_PVD_REGISTERED
export * from "./report"; // ReportProcedure, ReportContext
```

### `src/types/basal-protocol.ts`

**Exported Types:**

```typescript
// Time constants
export const SECOND = 1000
export const MINUTE = 60 * SECOND
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR
export const WEEK = 7 * DAY

// Protocol constants
export const DEFAULT_ENCODE = "utf-8"
export const FOLLOW_UP = " --> "
export const MAX_HEADER_LEN = 64
export const NO_RESPONSE = "None"
export const PROBE_MESSAGE = "Bonjour and EnjoIT."
export const UNKNOWN_ATTRIBUTE = "Unknown"

// Interfaces
export interface AccessPoint extends SocketAddress {
  authorization: string
  api: string[]
}
export interface ApiCall { peer, api, args, msgId, promise? }
export interface ApiCounter { success, invalidRequest, failedOnProcess, total? }
export interface ApiSpec { request, response, ack }
export interface BasalProtocol { protocol_ver, apis, provider }
export interface PeerIdentity { service, instance }
export interface ProviderConnectInfo extends AccessPoint, BasalProtocol["provider"]
export interface RegisterInfo extends BasalProtocol { provider: BasalProtocol["provider"] & AccessPoint }
export interface ReportData { timestamp, state, ramUsed, ramFree, cpuLoad, netTx, netTxBytes, netRx, netRxBytes, apiCounter? }
export interface ResponseArgs { apiSpec, data, errType, request, target }
export interface RestCall extends ApiCall { method, authType?, authorization? }
export interface SocketAddress { address, port, protocol }

// Enums
export enum AckType { None, Single, Double }
export enum AckValue { Ack, Error, InvalidReqData, None }
export enum AppEnv { development, production, staging, test }
export enum ExecutionState { Error, Halt, Halting, Initializing, Listening, Retrying, Running, Starting, Stopping, Stopped }
export enum MeterType { Application, Network, Host }
export enum NetworkProtocol { TCP, UDP }

// Factory functions
export function getAppEnv(): AppEnv
```

### `src/common/config.ts`

```typescript
// Configuration interfaces
export interface AppConfig {}
export interface CoreConfig { net, report, retry, service_name, provider_id }
export interface LogConfig { format, log_level, max_files, max_size }
export interface ReportConfig { enabled, interval, max_retries, retry_delay }
export interface RetryConfig { backoff: { enabled, max_delay, multiplier }, interval, max_retries? }
export interface ProviderConfig<T_App, T_Core> { app, core, log }

// Constants
export const DEFAULT_DISCOVERY_PORT = 5707
export const DEFAULT_RETRY_MULTIPLIER = 2

// ConfigManager class
export class ConfigManager<T_App extends AppConfig = AppConfig, T_Core extends CoreConfig = CoreConfig> {
  constructor(providerName?: string)

  // Getters
  getAppConfig(): T_App
  getAppEnv(): AppEnv
  getConfig(): ProviderConfig<T_App, T_Core>
  getCoreConfig(): T_Core
  getLogger(): Logger
  getLoggerManager(): LoggerManager
  getProviderId(): string

  // Methods
  async reload(): Promise<void>
}

// ServiceManagerConfig specialization
export class ServiceManagerConfig extends ConfigManager<ServiceManagerAppConfig260321, CoreConfig>
```

### `src/common/logger.ts`

```typescript
export enum LogFormat {
  JSON,
  CONSOLE,
}

export class LoggerManager {
  constructor(configManager: ConfigManager);
  close(): void;
  getLogger(): Logger;
  async reload(): Promise<void>;
  setConfigManager(configManager: ConfigManager): void;
}
```

### `src/network/network-events.ts`

```typescript
export enum NetworkDirection {
  In,
  Out,
}
export enum NetworkEvent {
  Listening,
  Connect,
  Connection,
  Data,
  Message,
  Close,
  Error,
  Stop,
}

export interface NetworkEventMap {
  [NetworkEvent.Listening]: () => void;
  [NetworkEvent.Connection]: (peer: NetworkPeer) => void;
  [NetworkEvent.Data]: (peer: NetworkPeer, data: Buffer) => void;
  [NetworkEvent.Message]: (peer: NetworkPeer, data: Buffer) => void;
  [NetworkEvent.Close]: (peer: NetworkPeer, hadError?: boolean) => void;
  [NetworkEvent.Error]: (error: Error, peer?: NetworkPeer) => void;
}

export const NetworkRetryable: Set<string>; // {"EADDRINUSE", "EADDRNOTAVAIL", "ENETDOWN"}

export type NetworkPeer =
  | (SocketAddress & { protocol: TCP; socket: TcpSocket })
  | (SocketAddress & { protocol: UDP; socket: UdpSocket });

// Utility functions
export function getBroadcastAddress(ifaceName?: string): string | null;
export function getHostIP(): string;
```

### `src/network/tcp-server.ts`

```typescript
export class TcpServer extends TypedEventEmitter<NetworkEventMap> {
  readonly name: string;

  constructor(configManager: ConfigManager, name?: string);

  // Public API
  broadcast(data: Buffer | string): number;
  getPort(): number;
  getRxBytes(): number;
  getServer(): Server | undefined;
  getState(): ExecutionState;
  getTxBytes(): number;
  resetByteCounters(): void;
  async start(): Promise<void>;
  async stop(): Promise<void>;
}
```

### `src/network/tcp-client.ts`

```typescript
export class TcpClient extends TypedEventEmitter<NetworkEventMap> {
  readonly name: string;

  constructor(
    configManager: ConfigManager,
    ap: AccessPoint,
    name?: string,
    idGenerator?: IdGenerator,
  );

  // Public API
  getAccessPoint(): AccessPoint;
  getRxBytes(): number;
  getSocket(): TcpSocket;
  getState(): ExecutionState;
  getTxBytes(): number;
  resetByteCounters(): void;
  async sendMessage(message: ApiCall): Promise<string>;
  setAccessPoint(ap: AccessPoint): void;
  async start(): Promise<void>;
  async stop(): Promise<void>;
  async write(data: Buffer | string): Promise<string>;
  async writeWithId(data: Buffer | string, msgId: string): Promise<string>;
}
```

### `src/network/udp-server.ts`

```typescript
export class UdpServer extends TypedEventEmitter<NetworkEventMap> {
  readonly name: string;

  constructor(configManager: ConfigManager, name?: string);

  // Public API
  getReadySocket(): UdpSocket;
  getState(): ExecutionState;
  getPort(): number;
  async start(): Promise<void>;
  async stop(): Promise<void>;
}
```

### `src/network/udp-client.ts`

```typescript
export interface SendOptions {
  address?;
  port;
  timeout?;
}
export interface UdpResponse {
  data: Buffer;
  peer: NetworkPeer;
}

export class UdpClient extends TypedEventEmitter<NetworkEventMap> {
  readonly name: string;

  constructor(configManager: ConfigManager, name?: string);

  // Public API
  getReadySocket(): UdpSocket;
  getState(): ExecutionState;
  getPort(): number;
  async start(): Promise<void>;
  async stop(): Promise<void>;
  async setBroadcast(enabled: boolean): Promise<void>;
  async sendAndWait(
    message: Buffer | string,
    options: SendOptions,
  ): Promise<UdpResponse>;
}
```

### `src/network/udp-discovery.ts`

```typescript
export interface DiscoveryOptions extends SendOptions {
  maxResponses: number;
}
export interface DiscoveryResult {
  responses: BroadcastResponse260321[];
  durationMs: number;
  responseCount: number;
}

export class UdpDiscovery extends UdpClient {
  static readonly DEFAULT_OPTIONS: DiscoveryOptions;

  constructor(configManager: ConfigManager, name?: string);

  // Public API
  async start(): Promise<void>;
  async discover(options?: DiscoveryOptions): Promise<DiscoveryResult>;
  async discoverOne(options?: DiscoveryOptions): Promise<DiscoveryResult>;
}
```

### `src/network/broadcast-udp-server.ts`

```typescript
export class BroadcastUdpServer extends UdpServer {
  constructor(configManager: ConfigManager, name?: string);

  // Public API
  setManagerInfo(info: BroadcastResponse260321): void;
  async start(): Promise<void>;
  async stop(): Promise<void>;
}
```

### `src/provider/service-provider.ts`

```typescript
export class ServiceProvider {
  readonly PROTOCOL: BasalProtocol;

  constructor(idGenerator: IdGenerator);

  // Lifecycle
  async activate(): Promise<void>;
  async halt(): Promise<void>;
  async reload(): Promise<void>;
  async restart(): Promise<void>;
  async shutdown(): Promise<void>;
  async start(): Promise<void>;
  async stop(): Promise<void>;

  // Registration and reporting
  async register(): Promise<void>;
  async report(): Promise<void>;

  // Accessors
  getConfigManager(): ConfigManager;
  getLogger(): Logger;
  getMetrics(): OtelMeterics;
  getServiceName(): string;
  getState(): ExecutionState;

  // Protocol
  async getProtocol(): Promise<string>;
  logProtocol(): void;
}
```

### `src/manager/service-manager.ts`

```typescript
export class ServiceManager extends ServiceProvider {
  constructor(idGenerator: IdGenerator);

  // Service management
  clearReports(peer: PeerIdentity): void;
  getReportedInstances(): PeerIdentity[];
  getReports(peer: PeerIdentity): ReportData[];
  getLatestReport(peer: PeerIdentity): ReportData | undefined;
  getTcpServer(name: string): TcpServer | undefined;
  getUdpServer(name: string): BroadcastUdpServer | undefined;

  // API handlers
  async gotReport(data: ApiCall): Promise<void>;
  protected async registrar(data: ApiCall): Promise<void>;
}
```

### `src/metrics/otel-metrics.ts`

```typescript
// Exported metrics instruments
export const executionTime: Histogram;
export const retryAttempts: Counter;
export const retryDuration: Histogram;
export const serverState: ObservableGauge;
export const activeConnections: UpDownCounter;
export const bytesCounter: Counter;
export const listenerState: ObservableGauge;
export const tcpConnectionDuration: Histogram;
export const tcpConnectionsFailed: Counter;
export const tcpDataTransferSize: Histogram;
export const udpBroadcastLatency: Histogram;
export const udpBroadcastRequests: Counter;
export const udpBroadcastResponses: Counter;

// Classes
export class OtelProviderState extends ProviderState {
  createCallback(): ObservableCallback;
  getCallback(): ObservableCallback | undefined;
}

export class OtelMeterics {
  constructor(
    providerAttr: DetectedResourceAttributes,
    providerState?: OtelProviderState,
  );

  // Metric getters
  getExecutionTime(): Histogram | undefined;
  getRetryAttempts(): Counter | undefined;
  getRetryDuration(): Histogram | undefined;
  getServerState(): ObservableGauge | undefined;
  getListenerState(): ObservableGauge | undefined;
  getActiveConnections(): UpDownCounter | undefined;
  getBytesCounter(): Counter | undefined;
  getUdpBroadcastRequests(): Counter | undefined;
  getUdpBroadcastResponses(): Counter | undefined;
  getUdpBroadcastLatency(): Histogram | undefined;
  getTcpConnectionDuration(): Histogram | undefined;
  getTcpConnectionsFailed(): Counter | undefined;
  getTcpDataTransferSize(): Histogram | undefined;
  getNetMeter(): Meter;
  getAppMeter(): Meter;
  async shutdown(): Promise<void>;
}
```

### `src/metrics/otel-tracing.ts`

```typescript
export interface NetworkSpanOptions {
  message?;
  address?;
  port?;
  protocol?;
  direction?;
  attributes?;
  parent?;
}
export interface SpanOptions {
  kind?;
  attributes?;
  parent?;
  startTime?;
}

export class OtelTracer {
  static getInstance(providerId: string, provider?: ProviderState): OtelTracer;

  constructor(provider: ProviderState);

  configure(provider: ProviderState): void;
  createSpan(name: string, options?: SpanOptions): Span;
  createNetworkSpan(operation: string, options?: NetworkSpanOptions): Span;
  createBroadcastSpan(operation: string, options?: NetworkSpanOptions): Span;
  getProviderIdentity(): string;
  getProviderState(): ProviderState;
  recordException(
    span: Span,
    error: Error,
    attributes?: Record<string, any>,
  ): void;
  async shutdown(): Promise<void>;
}
```

---

## Dependency Injection Setup (container.ts)

The project uses **InversifyJS** for dependency injection with a singleton container.

### Container Configuration

```typescript
import "reflect-metadata";
import { Container } from "inversify";

export const container = new Container();

// Singleton IdGenerator
container
  .bind<IdGenerator>(TYPES.IdGenerator)
  .to(DefaultIdGenerator)
  .inSingletonScope();

// Singleton Procedures
container
  .bind<DiscoverProcedure>(TYPES.DiscoverProcedure)
  .to(DiscoverProcedure)
  .inSingletonScope();

container
  .bind<RegisterProcedure>(TYPES.RegisterProcedure)
  .to(RegisterProcedure)
  .inSingletonScope();

container
  .bind<ReportProcedure>(TYPES.ReportProcedure)
  .to(ReportProcedure)
  .inSingletonScope();
```

### Service Provider Creation with Instrumentation

```typescript
export async function createProvider<T extends ServiceProvider>(
  serviceClass: new (...args: any[]) => T,
): Promise<T> {
  container
    .bind<T>(serviceClass)
    .to(serviceClass)
    .onActivation(async (_ctx, _instance) => {
      await _instance.reload();
      const metrics = new ExecutionMetrics(_instance.getLogger());
      return instrumentService(_instance, metrics);
    });
  return container.getAsync<T>(serviceClass);
}
```

### Factory Functions

```typescript
// TCP Server factory
export function createNamedTcpServer(
  configManager: ConfigManager,
  name: string,
): TcpServer {
  return new TcpServer(configManager, name);
}

// UDP Server factory (returns BroadcastUdpServer for "broadcast" type)
export function createNamedUdpServer(
  configManager: ConfigManager,
  name: string,
  type: Symbol,
): UdpServer | BroadcastUdpServer {
  if (type === TYPES.BroadcastUdpServer) {
    return new BroadcastUdpServer(configManager, name);
  }
  return new UdpServer(configManager, name);
}

// OpenTelemetry exporter factory
export function createOtelExporter(configManager: ConfigManager) {
  if (AppEnv.development === configManager.getAppEnv()) {
    return new ConsoleSpanExporter();
  }
  return new OTLPTraceExporter({ url: "http://localhost:4317" });
}

// ServiceManager discovery factory
export function createServiceManagerDiscover(
  configManager: ConfigManager,
  name: string,
  type: Symbol,
): UdpDiscovery | undefined {
  if (type === TYPES.UdpDiscovery) {
    return new UdpDiscovery(configManager, name);
  }
  return undefined;
}
```

---

## Network Layer Architecture

### TCP Communication

TCP provides reliable, connection-oriented RPC communication.

```
ServiceProvider A                    ServiceProvider B
      |                                    |
      |-- TCP Connection (API Channel) --->|
      |<--- TCP Connection (Response) -----|
      |                                    |
      |  JSON ApiCall in, JSON response out|
      |  64-byte header: [success][msgId]  |
```

**TcpServer** (`src/network/tcp-server.ts`):

- Listens for incoming connections
- Tracks all connected sockets in `_sockets` Set
- Emits `NetworkEvent.Data` with `{ peer, data }`
- Records metrics: `activeConnections`, `bytesCounter`, `tcpConnectionDuration`

**TcpClient** (`src/network/tcp-client.ts`):

- Connects to remote server via AccessPoint
- Provides `sendMessage()` for RPC calls with auto-generated msgId
- Provides `writeWithId()` for sending with specific correlation ID
- Emits `NetworkEvent.Data` with incoming responses

### UDP Discovery

UDP broadcast enables zero-configuration ServiceManager discovery.

```
ServiceProvider                ServiceManager
      |                              |
      |-- UDP Broadcast (probe) ---->|
      |<-- UDP Response (info) ------|
```

**UdpDiscovery** (`src/network/udp-discovery.ts`):

- Extends `UdpClient` with broadcast enabled
- Sends `PROBE_MESSAGE` ("Bonjour and EnjoIT.") with correlation ID
- Collects responses up to `maxResponses` limit
- Timeout default: 5 seconds

**BroadcastUdpServer** (`src/network/broadcast-udp-server.ts`):

- Extends `UdpServer` for responding to discovery probes
- Validates probe prefix: `Bonjour and EnjoIT.->`
- Responds with JSON-serialized ServiceManager info
- Records metrics: `udpBroadcastRequests`, `udpBroadcastResponses`, `udpBroadcastLatency`

### Message Protocol

**API Request** (via TCP):

```json
{
  "peer": { "service": "OrderService", "instance": "abc123" },
  "api": "register",
  "args": {
    /* RegisterInfo */
  },
  "msgId": "uuid-v4"
}
```

**Response Header** (64 bytes):

- Byte 0: Success flag (1=success, 0=failure)
- Bytes 1-63: Message ID (null-padded UUID)

### Event System

```typescript
enum NetworkEvent {
  Listening = "listening", // Server bound and ready
  Connect = "connect", // Client connected (TCP)
  Connection = "connection", // New client (TCP server)
  Data = "data", // Data received (TCP)
  Message = "message", // Message received (UDP)
  Close = "close", // Connection closed
  Error = "error", // Error occurred
  Stop = "stop", // Server stopped
}
```

---

## ServiceProvider and ServiceManager Lifecycle

### ServiceProvider Lifecycle

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

3. register()
   └── Execute RegisterProcedure
       └── Send RegisterInfo to ServiceManager via TCP

4. Running State
   ├── API channel accepts requests
   ├── Automatic reports every 60s (configurable)

5. stop()
   ├── stopping() [subclass hook]
   ├── Stop all tasks except ServiceManager task
   ├── Stop report schedule
   └── State → Stopped

6. shutdown()
   ├── stop()
   ├── _stopReportSchedule()
   ├── _stopManagerTask()
   └── _releaseResources()
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

### State Machine

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

### Task Management

Services maintain a `tasks: Map<string, any>` for managing network resources:

```typescript
// Task channels
const _TASK_CHANNEL_API = "_chnAPI"; // Accept API requests
const _TASK_CHANNEL_RESPONSE = "_chnResponse"; // Send responses
const _TASK_MANAGER = "_svcManager"; // Connection to ServiceManager

// Example: Getting a task
const tcpServer = this.tasks.get("_chnAPI") as TcpServer;

// Example: Stopping all tasks except manager
for (const name of this.tasks.keys()) {
  if (name === this._TASK_MANAGER) continue;
  await this._stopTask(name);
}
```

---

## Procedures (Register, Discover, Report)

### Base Procedure Class

```typescript
// src/procedure/procedure.ts
@injectable()
export abstract class Procedure {
  protected configManager!: ConfigManager;
  protected logger!: Logger;
  protected context!: ProcedureContext; // Shared variables from caller

  constructor(configManager: ConfigManager) {
    this.setConfigManager(configManager);
  }

  async execute(context?: ProcedureContext): Promise<any> {
    if (context) this.context = context;
    throw new Error(`${this.constructor.name}.execute() is not implemented.`);
  }

  protected async delay(ms: number): Promise<void>;
  protected async initializeTcpClient(
    name: string,
    ap?: AccessPoint,
  ): Promise<TcpClient>;
  protected async initializeTcpServer(name: string): Promise<TcpServer>;
}
```

### DiscoverProcedure

```typescript
// src/procedure/discover.ts
export interface ManagerInfo {
  managerInfo: BroadcastResponse260321[]
  manager: any
  instance: TcpClient | null
}

@injectable()
export class DiscoverProcedure extends Procedure {
  constructor(@inject(TYPES.ConfigManager) configManager: ConfigManager)

  async execute(context?: ProcedureContext): Promise<ManagerInfo>
  // 1. Create UdpDiscovery based on sm_discovery config
  // 2. Call discovery.discover() to find ServiceManagers
  // 3. Connect to first ServiceManager via TCP
  // 4. Return ManagerInfo with TcpClient instance
}
```

**Discovery Flow:**

```
1. Create UdpDiscovery instance
2. Start UDP client, enable broadcast
3. Send "Bonjour and EnjoIT.->{correlationId}" to broadcast address
4. Collect responses until timeout or maxResponses
5. Parse JSON responses as BroadcastResponse260321
6. Create TcpClient to first responder
7. Return ManagerInfo { managerInfo, manager, instance: TcpClient }
```

### RegisterProcedure

```typescript
// src/procedure/register.ts
export interface RegisterContext extends ProcedureContext {
  manager: { manager: RegisterManagerInfo }
  protocol: BasalProtocol
  smTaskName: string
  ask: (helper, message, ackType) => Promise<{ msgId, promise? }>
  buildMessage: (apiPath, args?, msgId?) => ApiCall
  getTcpTaskInfo: (taskName) => AccessPoint
}

@injectable()
export class RegisterProcedure extends Procedure {
  constructor(@inject(TYPES.ConfigManager) configManager: ConfigManager)

  async execute(context?: RegisterContext): Promise<boolean>
  // 1. Get ServiceManager TCP client from tasks
  // 2. Build RegisterInfo with protocol + AccessPoint
  // 3. Send via ask() with AckType.Single
  // 4. Return true on success, false on failure
}
```

**Register Flow:**

```
1. Get ServiceManager TcpClient from tasks["_svcManager"]
2. Build RegisterInfo:
   {
     protocol_ver: "1.0.0",
     provider: {
       id: "shortId",
       name: "OrderService",
       desc: "...",
       version: "1.0.0",
       ...accessPoint (address, port, protocol, api)
     }
   }
3. Send register API call
4. Wait for response (Ack)
5. Emit EVENT_PVD_REGISTERED on success
```

### ReportProcedure

```typescript
// src/procedure/report.ts
export interface ReportContext extends ProcedureContext {
  apiCounter: Map<string, Omit<ApiCounter, "total">>
  manager: { manager: ReportManagerInfo }
  ask: (helper, message, ackType) => Promise<{ msgId, promise? }>
  buildMessage: (apiPath, args?, msgId?) => ApiCall
}

@injectable()
export class ReportProcedure extends Procedure {
  constructor(@inject(TYPES.ConfigManager) configManager: ConfigManager)

  async execute(context?: ReportContext): Promise<void>
  // 1. Collect system metrics (RAM, CPU, network bytes)
  // 2. Send report to ServiceManager with retry logic
}
```

**Report Data:**

```typescript
interface ReportData {
  timestamp: number; // Unix timestamp
  state: ExecutionState; // Current state
  ramUsed: number; // MB used
  ramFree: number; // MB free
  cpuLoad: number; // 0-100 percentage
  netTx: string; // "1.23 MB" formatted
  netTxBytes: number; // Raw bytes
  netRx: string; // "456 KB" formatted
  netRxBytes: number; // Raw bytes
  apiCounter?: Map<string, { success; invalidRequest; failedOnProcess }>;
}
```

**Report Flow:**

```
1. Collect metrics via _collectReportData()
   - process.memoryUsage().heapUsed → MB
   - os.freemem() → MB
   - os.loadavg()[0] / os.cpus().length → percentage
   - Sum getTxBytes/getRxBytes from all TcpServer/TcpClient tasks
2. Build ReportData with state and API counters
3. Send to ServiceManager with retry (max 3 attempts)
4. Log success/failure
```

---

## OpenTelemetry Integration

### Metrics (`src/metrics/otel-metrics.ts`)

**Application Metrics:**

- `method_execution_time` (Histogram): Service method timing
- `retry_attempts_total` (Counter): Retry operations
- `retry_duration` (Histogram): Time per retry attempt
- `server_state` (ObservableGauge): Current server state

**Network Metrics:**

- `active_connections` (UpDownCounter): TCP connection count
- `bytes_total` (Counter): Network throughput
- `listener_state` (ObservableGauge): Listener status
- `tcp_connection_duration` (Histogram): Connection lifetime
- `tcp_connections_failed_total` (Counter): Failed connections
- `tcp_data_transfer_size` (Histogram): Data per TCP operation
- `udp_broadcast_requests_total` (Counter): Discovery requests received
- `udp_broadcast_responses_total` (Counter): Discovery responses sent
- `udp_broadcast_response_time` (Histogram): Discovery latency

### Tracing (`src/metrics/otel-tracing.ts`)

**OtelTracer** provides span creation for:

```typescript
// Network operations (TCP/UDP)
createNetworkSpan(operation: string, options: NetworkSpanOptions): Span

// Broadcast discovery operations
createBroadcastSpan(operation: string, options: NetworkSpanOptions): Span

// General spans
createSpan(name: string, options: SpanOptions): Span

// Exception recording
recordException(span: Span, error: Error, attributes?: Record): void
```

**Span Attributes:**

- `network.operation`: e.g., "accept", "connect", "write", "read"
- `network.protocol`: "TCP" or "UDP"
- `network.direction`: "inbound" or "outbound"
- `network.peer.address` / `network.peer.port`: Connection peer
- `correlation.id`: Message correlation for tracing across services

### Provider State (`src/provider/provider-info.ts`)

```typescript
export interface ProviderInfo {
  enabled: boolean;
  [ATTR_SERVICE_NAME]: string; // "service.name"
  [ATTR_SERVICE_INSTANCE]: string; // "service.instance"
  [ATTR_SERVICE_VERSION]: string; // "service.version"
  [ATTR_PROTOCOL_VERSION]: string; // "protocol.version"
  [ATTR_DEPLOY_ENV]: string; // "deployment.environment"
}

export class ProviderState {
  getProvider(): ProviderInfo;
  getState(): ExecutionState;
  setProvider(provider: ProviderInfo): void;
  setState(state: ExecutionState): void;
  getCommonAttributes(): Record<string, ProviderAttributeValue>;
}
```

---

## Configuration Management

### Configuration Sources

1. **YAML file** (`config.yml` or `config/config.yml`)
2. **Environment variables** (`NODE_ENV`, `HOST_IP`, `BROADCAST`)
3. **Default values**

### ConfigManager (`src/common/config.ts`)

```typescript
class ConfigManager<T_App, T_Core> {
  constructor(providerName?: string);

  // Configuration loading
  private _loadConfig(): ProviderConfig;
  private _mergeWithDefaults(parsed: Partial<ProviderConfig>): ProviderConfig;

  // Accessors
  getAppConfig(): T_App;
  getAppEnv(): AppEnv;
  getConfig(): ProviderConfig;
  getCoreConfig(): T_Core;
  getProviderId(): string;
  getLogger(): Logger;

  // Reload
  async reload(): Promise<void>;
}
```

### Default Configuration

```typescript
// TCP defaults
{
  address: "0.0.0.0",  // Bind on all NICs
  port: 0,              // Random available port
  client: {
    timeout: 10 * 1000,           // 10 seconds
    keep_alive: true,
    keep_alive_initial_delay: 0
  }
}

// UDP defaults
{
  address: "0.0.0.0",
  port: 5707           // DEFAULT_DISCOVERY_PORT
}

// Report defaults
{
  enabled: true,
  interval: 60 * 1000,  // 60 seconds
  max_retries: 3,
  retry_delay: 5 * 1000  // 5 seconds
}

// Retry defaults
{
  interval: 2 * 1000,    // 2 seconds
  max_retries: 0,        // Infinity
  backoff: {
    enabled: true,
    max_delay: 4 * 60 * 1000,  // 4 minutes
    multiplier: 2
  }
}
```

### Logger Configuration

```typescript
// LogConfig
{
  format: "json" | "console",  // JSON in production, console in dev
  log_level: "info",
  max_files: "14d",            // Keep 14 days
  max_size: "20m"              // 20MB per file
}
```

---

## Constants and Enums

### Time Constants (`src/types/basal-protocol.ts`)

```typescript
export const SECOND = 1000;
export const MINUTE = 60 * SECOND; // 60,000
export const HOUR = 60 * MINUTE; // 3,600,000
export const DAY = 24 * HOUR; // 86,400,000
export const WEEK = 7 * DAY; // 604,800,000
```

### Protocol Constants

```typescript
export const DEFAULT_ENCODE = "utf-8";
export const FOLLOW_UP = " --> "; // For log formatting
export const MAX_HEADER_LEN = 64; // Response header size
export const NO_RESPONSE = "None"; // For ApiSpec response
export const PROBE_MESSAGE = "Bonjour and EnjoIT."; // Discovery probe
export const UNKNOWN_ATTRIBUTE = "Unknown";
```

### ExecutionState Enum

```typescript
export enum ExecutionState {
  Error = "Error",
  Halt = "Halt", // Stopped but can restart
  Halting = "Halting",
  Initializing = "Initializing",
  Listening = "Listening",
  Retrying = "Retrying", // Retry in progress
  Running = "Running",
  Starting = "Starting",
  Stopping = "Stopping",
  Stopped = "Stopped",
}
```

### AppEnv Enum

```typescript
export enum AppEnv {
  development = "development",
  production = "production",
  staging = "staging",
  test = "test",
}
```

### NetworkProtocol Enum

```typescript
export enum NetworkProtocol {
  TCP = "TCP",
  UDP = "UDP",
}
```

### AckType Enum

```typescript
export enum AckType {
  None = "None", // No acknowledgment needed
  Single = "Single", // Send ACK after processing
  Double = "Double", // Requester confirms receipt
}
```

### AckValue Enum

```typescript
export enum AckValue {
  Ack = "Ack", // Positive acknowledgment
  Error = "Error", // Processing error
  InvalidReqData = "InvalidReqData", // Malformed request
  None = "None", // No response
}
```

### NetworkEvent Enum

```typescript
export enum NetworkEvent {
  Listening = "listening", // Server bound
  Connect = "connect", // Client connected (TCP)
  Connection = "connection", // New client (TCP server)
  Data = "data", // Data received (TCP)
  Message = "message", // Message received (UDP)
  Close = "close", // Connection closed
  Error = "error", // Error occurred
  Stop = "stop", // Server stopped
}
```

### NetworkRetryable Errors

```typescript
export const NetworkRetryable = new Set([
  "EADDRINUSE", // Address in use
  "EADDRNOTAVAIL", // Address not available
  "ENETDOWN", // Network down
]);
```

---

## Example Usage

### Creating a Custom Service

```typescript
import { ServiceProvider } from "./provider/service-provider";
import { TcpClient } from "./network/tcp-client";
import { AccessPoint, AckType, ApiCall } from "./types/basal-protocol";

class OrderService extends ServiceProvider {
  constructor(idGenerator: IdGenerator) {
    super(idGenerator);
    this.PROTOCOL.provider.name = "OrderService";
    this.PROTOCOL.provider.desc = "Order processing service";
  }

  protected buildAccessPointInfo(baseInfo: AccessPoint): AccessPoint {
    return {
      ...baseInfo,
      authorization: "order-service-key",
      api: ["createOrder", "cancelOrder", "getOrderStatus"],
    };
  }

  protected async starting(): Promise<void> {
    // Custom initialization
  }

  protected async stopping(): Promise<void> {
    // Custom cleanup
  }

  // Custom API methods
  public async createOrder(orderData: any): Promise<any> {
    const message: ApiCall = {
      peer: { service: "OrderService", instance: this.PROTOCOL.provider.id },
      api: "createOrder",
      args: orderData,
    };

    // Send to another service via TCP
    const helper = await this.initializeTcpClient("payment-helper", paymentAp);
    const { promise } = await this.ask(helper, message, AckType.Single);
    return promise;
  }
}
```

### Making RPC Calls

```typescript
// Build message
const message: ApiCall = {
  peer: { service: "OrderService", instance: "abc123" },
  api: "createOrder",
  args: { items: [...], total: 99.99 },
  msgId: undefined,  // Auto-generated
};

// Send with acknowledgment
const { msgId, promise } = await this.ask(tcpClient, message, AckType.Single);

try {
  const result = await promise;
  console.log("Order created:", result);
} catch (err) {
  console.error("Order failed:", err);
}
```

### Configuration File (config.yml)

```yaml
app:
  # Application-specific config
  redis:
    address: "localhost"
    port: 6379
    credential: "secret"

core:
  net:
    sm_discovery: "UdpDiscovery"
    sm_port: 5707
    tcp:
      address: "0.0.0.0"
      port: 8080
      client:
        timeout: 10000
        keep_alive: true
        keep_alive_initial_delay: 0
    udp:
      address: "0.0.0.0"
      port: 5707
  report:
    enabled: true
    interval: 60
    max_retries: 3
    retry_delay: 5
  retry:
    interval: 2000
    max_retries: 0
    backoff:
      enabled: true
      max_delay: 240000
      multiplier: 2
  service_name: "OrderService"

log:
  format: "console"
  log_level: "debug"
  max_files: "14d"
  max_size: "20m"
```
