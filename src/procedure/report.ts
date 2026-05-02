import * as os from "os";
import { inject, injectable } from "inversify";

import { Procedure, ProcedureContext } from "./procedure";
import { TYPES } from "../aop/container";
import { ConfigManager } from "../common/config";
import { TcpClient } from "../network/tcp-client";
import { TcpServer } from "../network/tcp-server";
import {
  AckType,
  ApiCall,
  ApiCounter,
  ApiSpec,
  SECOND,
  FOLLOW_UP,
  ReportData,
  ExecutionState,
} from "../types/basal-protocol";

/**
 * Interface containing the ServiceManager's API specifications for reporting.
 */
export interface ReportManagerInfo {
  apis: {
    report: ApiSpec;
  };
}

/**
 * Context required for the report procedure execution.
 */
export interface ReportContext extends ProcedureContext {
  apiCounter: Map<string, Omit<ApiCounter, "total">>;
  manager: { manager: ReportManagerInfo };

  ask: (
    helper: TcpClient,
    message: ApiCall,
    ackType: AckType,
  ) => Promise<{ msgId: string; promise?: Promise<any> }>;
  buildMessage: (apiPath: string, args?: any, msgId?: string) => ApiCall;
}

/**
 * Procedure for reporting current runtime metrics to the ServiceManager.
 *
 * This procedure:
 * 1. Collects current system metrics (RAM, CPU, network)
 * 2. Sends report to ServiceManager with retry logic
 * 3. Handles failures with configurable retry attempts
 */
@injectable()
export class ReportProcedure extends Procedure {
  /**
   * Creates a ReportServiceManagerProcedure instance.
   * @param configManager - The configuration manager
   */
  constructor(@inject(TYPES.ConfigManager) configManager: ConfigManager) {
    super(configManager);
  }

  /**
   * Reports current runtime metrics to the ServiceManager.
   *
   * @param context - Execution context with dependencies
   * @returns Promise resolving true when report is sent or conditional rejection, false for max retries reached.
   */
  public async execute(context?: ReportContext): Promise<boolean> {
    // Initiate variables.
    if (context) this.context = context;
    if (!this.context) return true;
    const { taskName, tasks, manager, ask, buildMessage } = this
      .context as ReportContext;

    // Check preconditions
    const smTask = tasks.get(taskName);
    if (!(smTask instanceof TcpClient)) {
      this.logger.debug("No ServiceManager found for report.");
      return true;
    }
    this.logger.debug("Report current status to service manager ...");

    const ackType = manager.manager.apis.report.ack;
    const reportData = this._collectReportData();
    const apiData: ApiCall = buildMessage("report", reportData);

    const reportConfig = this.configManager.getCoreConfig().report;
    const maxRetries = reportConfig?.max_retries ?? 3;
    const retryDelay = reportConfig?.retry_delay ?? 5 * SECOND;

    let attempt = 0;
    let success = false;

    while (attempt <= maxRetries && !success) {
      try {
        const { promise } = await ask(smTask, apiData, ackType);
        if (promise) await promise;
        this.logger.silly(`${FOLLOW_UP}Report sent successfully.`);
        success = true;
      } catch (err) {
        attempt++;
        if (attempt > maxRetries) {
          this.logger.warn(
            `${FOLLOW_UP}Failed to send report after ${maxRetries} retries.`,
          );
          break;
        }
        this.logger.debug(
          `${FOLLOW_UP}Report attempt ${attempt} failed, retrying in ${retryDelay / SECOND} seconds ...`,
        );
        await this.delay(retryDelay);
      }
    }
    return success;
  }

  /**
   * Collects system metrics for the report.
   * Sums up network transmission/received bytes from all TcpServer and TcpClient tasks.
   *
   * @returns ReportData containing current system metrics
   */
  private _collectReportData(): ReportData {
    const { parent, tasks, apiCounter } = this.context as ReportContext;

    const MB = 1024 * 1024;
    const memUsage = process.memoryUsage();
    const ramUsed = Math.round(memUsage.heapUsed / MB); // Convert to MB

    const freeMem = os.freemem();
    const ramFree = Math.round(freeMem / MB); // Convert to MB

    // Calculate CPU load using 1-minute average
    const cpuLoad = Math.round((os.loadavg()[0] * 100) / os.cpus().length);

    // Sum up network bytes from all TcpServer and TcpClient tasks
    let totalTxBytes = 0;
    let totalRxBytes = 0;

    for (const task of tasks.values()) {
      if (task instanceof TcpServer || task instanceof TcpClient) {
        totalTxBytes += task.getTxBytes();
        totalRxBytes += task.getRxBytes();
      }
    }

    // Auto-scale network transmission / received
    const networkRx = this._formatBytes(totalRxBytes);
    const networkTx = this._formatBytes(totalTxBytes);

    return {
      timestamp: Date.now(),
      state: parent?.getState() || ExecutionState.Error,
      ramUsed,
      ramFree,
      cpuLoad,
      netRx: networkRx,
      netRxBytes: totalRxBytes,
      netTx: networkTx,
      netTxBytes: totalTxBytes,
      apiCounter: apiCounter,
    };
  }

  /**
   * Formats bytes to human-readable string with auto-scaled unit.
   *
   * @param bytes - Number of bytes
   * @returns Formatted string with unit (B, KB, MB, GB)
   */
  private _formatBytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB"];
    let unitIndex = 0;
    let size = bytes;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}
