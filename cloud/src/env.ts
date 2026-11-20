import type { UserHub } from "./durable-objects/user-hub";
import type { TransferRelay } from "./durable-objects/transfer-relay";

export interface Env {
  DB: D1Database;
  USER_HUB: DurableObjectNamespace<UserHub>;
  TRANSFER_RELAY: DurableObjectNamespace<TransferRelay>;
  /** HMAC key for short-lived job tokens (wrangler secret). */
  JOB_SIGNING_KEY: string;
  /** Static assets (the web app). */
  ASSETS: Fetcher;
  /** Where the Windows installer can be downloaded (shown in the dashboard). */
  INSTALLER_URL?: string;
  /** Build-service endpoint for cloud compilation (default: Wokwi public build server). */
  COMPILER_URL?: string;
  /** Optional override of the per-IP pairing-start limit per hour (default 15; raised in tests). */
  PAIR_START_LIMIT?: string;
  COMPILE_LIMIT?: string;
  /** Invite code required to create an account (wrangler secret). */
  SIGNUP_CODE: string;
}
