# Testing Guide for distributedRPC.js

## Overview

This project uses [Vitest](https://vitest.dev/) as its testing framework with V8 coverage provider.

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage

# Run specific test file
pnpm test -- src/__tests__/common/config.test.ts

# Run tests matching a pattern
pnpm test -- -t "should initialize"
```

## Test Structure

Tests are located in `src/__tests__/` directory, mirroring the source structure:

```
src/__tests__/
├── aop/
│   ├── container.test.ts
│   └── exec-time-interceptor.test.ts
├── common/
│   ├── config.test.ts
│   ├── logger.test.ts
│   └── retry.test.ts
├── manager/
│   └── service-manager.test.ts
├── metrics/
│   ├── exec-metrics.test.ts
│   └── otel-tracing.test.ts
├── network/
│   ├── broadcast-udp-server.test.ts
│   ├── network-events.test.ts
│   ├── tcp-server.test.ts
│   ├── udp-client.test.ts
│   ├── udp-discovery.test.ts
│   └── udp-server.test.ts
├── procedure/
├── provider/
│   └── service-provider.test.ts
└── types/
    └── broadcast-response.test.ts
```

## Test Setup

The test setup file (`src/__tests__/setup.ts`) provides:

- Global `reflect-metadata` import for DI support
- Console mocking for cleaner test output

## Coverage Requirements

- **Statements**: >80%
- **Functions**: >90%
- **Branches**: >75%
- **Lines**: >75%

## Writing Tests

### Test Pattern

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MyClass } from "../../path/to/my-class";
import { Dependency } from "../../path/to/dependency";

describe("MyClass", () => {
  let instance: MyClass;
  let mockDependency: Partial<Dependency>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock dependency with all required methods
    mockDependency = {
      method1: vi.fn(),
      method2: vi.fn().mockReturnValue("mocked value"),
    };

    // Create instance with mocked dependencies
    instance = new MyClass(mockDependency as Dependency);
  });

  it("should do something specific", () => {
    const result = instance.doSomething();
    expect(result).toBe("expected");
  });
});
```

### Mocking ConfigManager

Many classes require `ConfigManager` which needs proper mocking:

```typescript
const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const mockConfigManager = {
  getLogger: () => mockLogger,
  getCoreConfig: () => ({
    net: {
      tcp: { address: "127.0.0.1", port: 0 },
      udp: { address: "127.0.0.1", port: 5707 },
    },
    retry: {
      interval: 100,
      max_retries: 3,
      backoff: { enable: true, max_delay: 1000, multiplier: 2 },
    },
    service_name: "test-service",
  }),
  getProviderId: () => "test-provider-id",
} as unknown as ConfigManager;
```

### Import Guidelines

**Important**: Always import from the correct locations:

| Export                    | Correct Import Path             |
| ------------------------- | ------------------------------- |
| `NetworkProtocol`         | `../../types/basal-protocol`    |
| `generateCorrelationId`   | `../../metrics/otel-resource`   |
| `ExecutionState`          | `../../types/basal-protocol`    |
| `AccessPoint`             | `../../types/basal-protocol`    |
| `BroadcastResponse260321` | `../../manager/api-spec-260321` |

## Known Issues

### Tests Requiring Updates

The following test files have known issues and need updates:

1. **otel-tracing.test.ts** - Imports `traceMethod` and `traceable` which don't exist in the codebase. These are deprecated decorators.

2. **tcp-server.test.ts** - Uses outdated mock patterns.

3. **udp-client.test.ts** - Mock ConfigManager missing `getCoreConfig` method.

4. **udp-discovery.test.ts** - Similar ConfigManager mock issues.

5. **container.test.ts** - Attempts to use InversifyJS container bindings that aren't set up for direct access.

6. **exec-time-interceptor.test.ts** - Imports `withExecutionTime` which doesn't exist.

7. **service-manager.test.ts** - Mock `idGenerator.shortId` not properly set up.

## Debugging Failed Tests

```bash
# Run with verbose output
pnpm test -- --reporter=verbose

# Run specific test with full details
pnpm test -- src/__tests__/common/config.test.ts -t "should load default" --reporter=verbose
```

## CI Integration

Tests run on every push. Coverage reports are generated in:

- `coverage/text` - Terminal output
- `coverage/lcov` - LCOV format for tools
- `coverage/html` - HTML report for browser viewing
