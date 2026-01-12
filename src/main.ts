import "reflect-metadata";
import { Logger } from "winston";

import { container, TYPES } from "./aop/container";
import { LoggerManager } from "./common/logger";
import { ServiceManager } from "./manager/service-manager";

// Global variable to track shutdown
let shutdownRequested = false;

async function main(): Promise<void> {
  // Setup signal handlers for graceful shutdown
  process.on("SIGINT", () => {
    logger.info(
      `Received SIGINT for ${providerName}, shutting down gracefully...`
    );
    shutdownRequested = true;
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    logger.info(
      `Received SIGTERM for ${providerName}, shutting down gracefully...`
    );
    shutdownRequested = true;
    process.exit(0);
  });

  // Initialize service manager with UDP server
  const provider = container.get<ServiceManager>(TYPES.ServiceManager);
  const logger: Logger = LoggerManager.getInstance().getLogger();
  const providerName = provider.getServiceName();
  logger.info(`Starting ${providerName} application ...`);

  try {
    const startTime = process.hrtime.bigint();
    await provider.initialize();
    const elapsedNs = process.hrtime.bigint() - startTime;
    const elapsedMs = Number(elapsedNs) / 1_000_000;
    logger.info(
      `${providerName} has been started successfully in ${elapsedMs.toFixed(
        2
      )} ms.`
    );
    logger.info("Press Ctrl+C to stop");
  } catch (error) {
    console.error(`Critical error in main application: ${error}`);
    process.exit(1);
  }

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    logger.info("Shutting down...");
    provider.stop();
    process.exit(0);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
}
