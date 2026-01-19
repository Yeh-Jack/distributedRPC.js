# Distributed RPC.js Architecture

## Overview

Distributed RPC.js is a Node.js backend application built with TypeScript that implements a distributed RPC service framework. It provides reliable communication between services using both TCP and UDP protocols, with support for configuration management, logging, metrics collection, and testing.

## Project Structure & Rules

This is a Node.js application following these conventions:

- Package manager: `pnpm`
- Testing framework: `vitest`
- Source code location: `/src`
- Test files: `/src/__tests__`
- Utility classes: `/src/common`
- Service management: `/src/manager`
- Network components: `/src/network`
- Configuration management: `/src/common/config.ts`
- Logging system: `/src/common/logger.ts`

## Configuration

The project uses YAML configuration files:
- Main config: `config.yaml` or `config/config.yml` - Contains application configuration

## System Components

### 1. Service Manager (`src/manager/service-manager.ts`)
The central coordinator that manages all network services:
- Initializes and starts TCP and UDP servers
- Handles service lifecycle management (start, stop, reload)
- Manages service state tracking through OpenTelemetry metrics
- Provides access to individual server instances

### 2. Network Servers
#### TCP Server (`src/network/tcp-server.ts`)
- Implements a reliable TCP-based communication layer using Node.js net module
- Handles connection lifecycle (establish, data transfer, close)
- Supports graceful shutdown with active connection cleanup
- Provides metrics tracking for active connections and bytes transferred

#### UDP Server (`src/network/udp-server.ts`)
- Implements an unreliable but efficient UDP communication layer using Node.js dgram module  
- Handles message reception and basic error handling
- Supports retry mechanisms for binding failures
- Provides metrics tracking for messages received and bytes transferred

### 3. Dependency Injection Container (`src/aop/container.ts`)
Uses InversifyJS for dependency injection:
- Manages service lifecycle with singleton scope
- Applies cross-cutting concerns like execution time measurement via AOP interceptors
- Configures services with proper instantiation and activation logic

### 4. Configuration Management (`src/common/config.ts`)
- Centralized configuration loading from config files (singleton pattern)
- Provides core configuration values for network settings, retry policies, etc.
- Supports runtime configuration reloading

### 5. Logging System (`src/common/logger.ts`)
- Uses Winston for structured logging
- Configurable log levels and output formats
- Integrates with service manager for consistent logging across components

### 6. Metrics Collection (`src/metrics/otel-metrics.ts`)
- Implements OpenTelemetry metrics collection
- Tracks server states, active connections, and byte counters
- Provides observability into system performance and health

### 7. Event System (`src/network/typed-event-emitter.ts`)
- Type-safe event emitter for network events
- Enables communication between different components through events:
  - Connection establishment
  - Data transfer
  - Error handling
  - Server state changes

## Architecture Patterns

### 1. Dependency Injection
The system uses InversifyJS to manage dependencies and apply AOP (Aspect-Oriented Programming) concerns like execution time measurement.

### 2. Event-Driven Architecture
Components communicate through events, enabling loose coupling between modules:
- Network servers emit connection, data, error, and state change events
- Service manager listens to these events for coordination

### 3. Modular Design
Each component has a single responsibility:
- TCP/UDP servers handle network communication
- Service manager coordinates services
- Configuration and logging are separate concerns
- Metrics collection is decoupled from business logic

### 4. Fault Tolerance
The system includes retry mechanisms for server startup failures, graceful shutdown procedures, and error handling that prevents cascading failures.

## Data Flow

1. **Initialization**: 
   - Main entry point (`main.ts`) starts ServiceManager
   - ServiceManager initializes TCP and UDP servers in parallel
   
2. **Runtime**:
   - Network servers listen on configured addresses/ports
   - Clients connect via TCP or send messages via UDP
   - Servers emit events for connection establishment, data reception, etc.
   - Events are handled by the service manager and other components

3. **Shutdown**:
   - Graceful shutdown signals propagate through the system
   - Active connections are closed properly
   - Network servers stop listening and clean up resources

## Key Features

- **Dual Protocol Support**: Both TCP (reliable) and UDP (fast) communication protocols
- **Configurable Retry Logic**: Automatic retry mechanisms for network binding failures  
- **OpenTelemetry Integration**: Comprehensive metrics collection and observability
- **Graceful Shutdown**: Proper cleanup of connections and resources on termination
- **Type Safety**: Strong typing throughout the codebase using TypeScript
- **Modular Design**: Easy to extend with new protocols or services

## Directory Structure

```
src/
├── main.ts              # Entry point
├── aop/                 # Aspect-Oriented Programming components
│   └── container.ts     # Dependency injection setup
├── common/              # Shared utilities and configuration
│   ├── config.ts        # Configuration management
│   ├── logger.ts        # Logging system
│   └── abort-aware.ts   # Abort controller utilities
├── manager/             # Service coordination components
│   └── service-manager.ts  # Main service coordinator
├── metrics/             # Metrics collection and reporting
│   └── otel-metrics.ts  # OpenTelemetry integration
├── network/             # Network communication layers
│   ├── tcp-server.ts    # TCP protocol implementation
│   ├── udp-server.ts    # UDP protocol implementation
│   └── typed-event-emitter.ts  # Event system
└── types/               # Type definitions
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
- Testing should cover 100% of lines and public/protected functions, and >75% banches coverage.

## Local Development Configuration

For local development, the system can utilize local LLMs configured in `~/.continue/config.yaml` which provides:
- Local Qwen3-Coder model for coding assistance
- Local Qwen3-Completer model for code completion
- API endpoints for local language model services