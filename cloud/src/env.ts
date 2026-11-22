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
  /** Optional KV namespace that caches compiled firmware per account (see src/compile/fwcache.ts). */
  FIRMWARE_CACHE?: KVNamespace;
  /** Days a cached build is kept (default 7; "0" turns the cache off). */
  FIRMWARE_CACHE_DAYS?: string;
  /** Invite code required to create an account (wrangler secret). */
  SIGNUP_CODE: string;
  /** The owner: the signed-in account with this email gets the admin dashboard and receives invite-request mail. */
  ADMIN_EMAIL?: string;
  /** Sender for outgoing mail, e.g. "MCU Bridge <invite@your-domain>". Required for either mail transport. */
  MAIL_FROM?: string;
  /** Mail transport A: Resend (wrangler secret). */
  RESEND_API_KEY?: string;
  /** Mail transport B: Cloudflare Email Routing `send_email` binding (destination must be a verified address). */
  SEND_EMAIL?: SendEmail;
}
