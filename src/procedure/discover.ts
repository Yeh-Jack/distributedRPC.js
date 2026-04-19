import { inject, injectable } from "inversify";

import { Procedure, ProcedureContext } from "./procedure";
import { createServiceManagerDiscover, TYPES } from "../aop/container";
import { ConfigManager } from "../common/config";
import { BroadcastResponse260321 } from "../manager/api-spec-260321";
import { TcpClient } from "../network/tcp-client";
import { AccessPoint } from "../types/basal-protocol";

export const EVENT_MGR_RESPONSE = "mgr_response";

/**
 * Result of the ServiceManager discovery procedure.
 */
export interface ManagerInfo {
  managerInfo: BroadcastResponse260321[];
  manager: any;
  instance: TcpClient | null;
}

/**
 * Procedure for discovering the ServiceManager.
 *
 * This procedure:
 * 1. Creates a discovery service based on configured strategy (UDP, etc.)
 * 2. Discovers available ServiceManagers
 * 3. Returns discovery result with manager info
 */
@injectable()
export class DiscoverProcedure extends Procedure {
  /**
   * Creates a DiscoverProcedure instance.
   * @param configManager - The configuration manager
   */
  constructor(@inject(TYPES.ConfigManager) configManager: ConfigManager) {
    super(configManager);
  }

  /**
   * Discovers the ServiceManager.
   *
   * @param context - Execution context
   * @returns Promise resolving to discovery result
   */
  public override async execute(
    context?: ProcedureContext,
  ): Promise<ManagerInfo> {
    // Initiate variables.
    const SM_NOT_FOUND = {
      managerInfo: [],
      manager: {},
      instance: null,
    };
    if (context) this.context = context;
    if (!this.context) return SM_NOT_FOUND;
    const { taskName } = this.context;

    // Create discovery service
    const discovery = createServiceManagerDiscover(
      this.configManager,
      taskName,
      this.configManager.getCoreConfig().net?.sm_discovery,
    );
    if (!discovery) {
      this.logger.info("ServiceManager discovery is disabled.");
      return SM_NOT_FOUND;
    }

    // Perform discovery
    const found = await discovery.discover();
    const managerInfo: BroadcastResponse260321[] = found.responses;

    if (managerInfo.length === 0) {
      this.logger.warn("No ServiceManager discovered.");
      return SM_NOT_FOUND;
    }

    // Connect to ServiceManager if discovered
    const manager = { ...managerInfo[0] };
    const mgrInfo: ManagerInfo = {
      managerInfo,
      manager,
      instance: null,
    };
    if (managerInfo.length > 0 && manager?.manager?.provider) {
      const ap: AccessPoint = mgrInfo.manager?.manager?.provider;

      // This channel is used for sending request to ServiceManager only without receiving response.
      // There is a dedicated response channel for receiving responses of all requests.
      const smTask: TcpClient = await this.initializeTcpClient(taskName, ap);
      if (smTask) {
        mgrInfo.instance = smTask;
        this.logger.debug("Request channel to ServiceManager is established.");

        smTask.emit(EVENT_MGR_RESPONSE, mgrInfo);
      }
    }

    // Return manager info for connection
    return mgrInfo;
  }
}
