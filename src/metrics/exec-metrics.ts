import { Logger } from "winston";

import { LoggerManager } from "../common/logger";

export class ExecutionMetrics {
  constructor(
    private readonly logger: Logger = LoggerManager.getInstance().getLogger()
  ) {}

  public recordExecutionTime(
    className: string,
    methodName: string,
    durationMs: number,
    success: boolean
  ) {
    this.logger.info(
      `[EXEC] ${className}.${methodName}: ${durationMs.toFixed(
        2
      )}ms success=${success}.`
    );
  }
}
