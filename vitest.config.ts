import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    reporters: ["default"],
    setupFiles: ["./src/__tests__/setup.ts"],
    // ui : true, // Optional, enables the Vitest UI by default.
    pool: "forks",
    api: {
      port: 9999, // Change Vitest UI port to 9999.
      host: "0.0.0.0", // Public accessable.
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/__tests__/",
        "src/main.ts",
        "src/procedure/index.ts",
        // Below files need integration test for coverage.
        "src/network/tcp-client.ts",
        "src/network/udp-discovery.ts",
      ],
    },
  },
});
