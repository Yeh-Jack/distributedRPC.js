// Setup file for Vitest tests
import "reflect-metadata";
import { vi } from 'vitest';

// Mock global objects if needed
global.console = {
  ...console,
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn()
};

export {};
