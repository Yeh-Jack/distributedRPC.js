# distributedRPC.js

[![Node](https://img.shields.io/badge/Node-%3E%3D18.0-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue)](LICENSE)
[![Coverage](https://img.shields.io/badge/Coverage-0%25-orange)](.github/workflows/ci.yml)
[![Stars](https://img.shields.io/github/stars/anomalyco/distributedRPC.js)](https://github.com/anomalyco/distributedRPC.js)

## This project is under construction, it doesn't work right now.

Node.js implementation of distributed RPC service framework with OpenTelemetry observability. Aim at zero-config (or as less as possible), horizontal scalable and self-healing.

## Features

- **Zero-Configuration Service Discovery** - Services find each other via UDP broadcast
- **Multi-Role Services** - Each instance acts as client, server, and response handler
- **OpenTelemetry Integration** - Metrics, tracing, and structured logging
- **Dependency Injection** - InversifyJS for loose coupling
- **Automatic Retry** - Exponential backoff for transient failures
- **Graceful Shutdown** - Signal handling for clean termination

## Architecture

### Components

**ServiceProvider (SP)**

- Multi-role distributed service that acts as both client and server
- **Server Role**: Listens for API requests via TCP
- **Client Role**: Sends requests to other services via TCP
- **Response Role**: Handles TCP responses from target services
- **Discovery Role**: Uses UDP broadcast to find ServiceManager

**ServiceManager (SM)**

- Coordinator service for service discovery and registry
- Responds to UDP broadcast queries with available service information
- Maintains service registry and collects service reports
- **No routing or message coordination** - Discovery + registry service only

### Communication Flow

```
┌─────────────────┐    UDP Discovery    ┌─────────────────┐
│ ServiceProvider │◄───────────────────►│ ServiceManager  │
│     (SP A)      │   (Find SM)         │  (Discovery)    │
└─────────────────┘                     └─────────────────┘
         │
         │ Register via TCP
         ▼
┌─────────────────┐
│ ServiceProvider │  ← Direct TCP to other services
│     (SP A)      │  ← (Inter-service communication)
│   (Client)      │
└─────────────────┘
```

## Quick Start

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

## Documentation

- [PROJECT.md](PROJECT.md) - Project overview and capabilities
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture and components
- [DESIGN.md](DESIGN.md) - Design decisions and rationale
- [API.md](API.md) - Public API documentation

## Configuration

```yaml
# config.yml
app:
  # Application-specific config

core:
  service_name: "OrderService"
  net:
    tcp:
      address: "0.0.0.0"
      port: 0  # Auto-assign port
    udp:
      address: "0.0.0.0"
      port: 5707
  report:
    enabled: true
    interval: 60
    max_retries: 3
  retry:
    interval: 2000
    max_retries: 0  # Infinite
    backoff:
      enabled: true
      max_delay: 240000
      multiplier: 2

log:
  format: "console"  # or "json"
  log_level: "info"
  max_files: "14d"
  max_size: "20m"
```

## OpenTelemetry Integration

### Metrics

- `method_execution_time` - Service method timing
- `retry_attempts_total` - Retry operations
- `server_state` - Current server state
- `active_connections` - TCP connection count
- `bytes_total` - Network throughput
- `tcp_connection_duration` - Connection lifetime
- `udp_broadcast_latency` - Discovery latency

### Tracing

- UDP broadcast discovery spans
- TCP connection lifecycle spans
- Cross-component correlation tracking

## Development

```bash
# Build
pnpm run build

# Test with coverage
pnpm run test:coverage

# Format code
pnpm run format

# Lint
npx eslint src/**/*.ts
```

## License

Apache 2.0