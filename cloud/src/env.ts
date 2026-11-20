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
  /** Invite code required to create an account (wrangler secret). */
  SIGNUP_CODE: string;
}
