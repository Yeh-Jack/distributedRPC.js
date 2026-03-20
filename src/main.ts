/**
 * Application entry point for the distributed RPC service.
 * @module main
 */

import "reflect-metadata";

import { container, createProvider } from "./aop/container";
import { ServiceManager } from "./manager/service-manager";
import { ServiceProvider } from "./provider/service-provider";
import { ConfigManager } from "./common/config";

const INTERRUPT_KEY = "<Ctrl+C>";

function handleInterruption(provider: ServiceProvider, logger: any) {
  const providerName = provider.getServiceName();

  // Handle graceful shutdown for <Ctrl+C>.
  process.on("SIGINT", async () => {
    logger.info(
      `${INTERRUPT_KEY} is detected, shutting down the ${providerName} gracefully ...`,
    );
    await provider.stop();
    process.exit(0);
  });

  // Setup signal handlers for graceful shutdown.
  ["SIGABRT", "SIGHUP", "SIGTERM"].forEach((signal) => {
    process.on(signal as NodeJS.Signals, async () => {
      logger.info(
        `Received <${signal}> for ${providerName}, shutting down gracefully ...`,
      );
      await provider.stop();
      process.exit(0);
    });
  });
}

/**
 * Main entry point function that initializes and starts the distributed RPC service.
 *
 * Responsibilities:
 * - Resolves dependencies from the IoC container
 * - Initializes the ServiceManager
 * - Sets up graceful shutdown signal handlers
 * - Reports startup timing metrics
 *
 * @returns Promise that resolves when the service is running or rejects on critical error.
 * @example
 * ```bash
 * # Run the service
 * npm start
 * ```
 */
async function main(): Promise<void> {
  const config = new ConfigManager("Main");
  const logger = config.getLogger();
  logger.info(`Starting the application ...`);

  const manager = await createProvider(ServiceManager);
  const managerName = manager.getServiceName();
  const provider = await createProvider(ServiceProvider);
  const providerName = provider.getServiceName();

  handleInterruption(provider, logger);
  logger.info(`${managerName} and ${providerName} instances are constructed.`);

  try {
    const startTime = process.hrtime.bigint();
    await Promise.all([manager.start(), provider.start()]);
    const elapsedNs = process.hrtime.bigint() - startTime;
    const elapsedMs = Number(elapsedNs) / 1_000_000;
    logger.info(
      `${managerName} and ${providerName} has been started successfully in ${elapsedMs.toFixed(
        2,
      )} ms.`,
    );
    logger.info(`Press ${INTERRUPT_KEY} to stop`);
  } catch (error) {
    console.error(`Critical error catched in main application: `, error);
    process.exit(1);
  }
}

// Run main function when this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
}
