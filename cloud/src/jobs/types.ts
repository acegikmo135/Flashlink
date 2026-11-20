import type { NormalizedManifest } from "./manifest";

export const ERROR_CODES = [
  "NO_AGENT_CONNECTED",
  "NO_DEVICE",
  "MULTIPLE_DEVICES",
  "DEVICE_NOT_FOUND",
  "UNSUPPORTED_MCU",
  "TARGET_MISMATCH",
  "DEVICE_DISCONNECTED",
  "DEVICE_NOT_ALLOWED",
  "FLASH_IN_PROGRESS",
  "MANIFEST_INVALID",
  "TOOLCHAIN_MISSING",
  "PROGRAMMER_MISSING",
  "TRANSFER_FAILED",
  "TRANSFER_TIMEOUT",
  "HASH_MISMATCH",
  "FLASH_FAILED",
  "VERIFICATION_FAILED",
  "JOB_NOT_FOUND",
  "JOB_EXPIRED",
  "JOB_CONFLICT",
  "CANCELLED",
  "TIMEOUT",
  "AGENT_DISCONNECTED",
  "SERIAL_ERROR",
  "PROBE_FAILED",
  "RATE_LIMITED",
  "INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const TERMINAL_STATUSES = ["completed", "failed", "verification_failed", "cancelled", "expired"] as const;
export const JOB_STATUSES = ["awaiting_upload", "transferring", "flashing", "verifying", ...TERMINAL_STATUSES] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export function isTerminal(s: JobStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(s);
}

export interface JobError {
  code: ErrorCode | string;
  message: string;
  details?: unknown;
}

export interface JobProgress {
  phase: string;
  percent: number;
  file?: string;
  message?: string;
}

export interface Job {
  id: string;
  user_id: string;
  agent_id: string;
  device_id: string;
  kind: "flash" | "verify";
  manifest: NormalizedManifest;
  manifest_digest: string;
  options: { verify: boolean; boot_log_seconds: number };
  status: JobStatus;
  progress: JobProgress;
  /** Per-file transfer state as reported by the agent. */
  files: { filename: string; size: number; transferred: number; verified_sha256: boolean }[];
  created_at: number;
  updated_at: number;
  expires_at: number;
  accepted_at?: number;
  finished_at?: number;
  cancel_requested?: boolean;
  error?: JobError;
  result?: Record<string, unknown>;
  log: string[];
}

export interface DeviceUsb {
  vid: string | null;
  pid: string | null;
  serial_number: string | null;
  manufacturer: string | null;
  product: string | null;
  description: string | null;
}

export interface DeviceRecord {
  id: string;
  agent_id: string;
  port: string | null;
  connected: boolean;
  first_seen: number;
  last_seen: number;
  added_version: number;
  removed_version: number;
  usb: DeviceUsb;
  family: string | null;
  chip: string | null;
  board: string | null;
  identified: boolean;
  identification: string;
  supported: boolean;
  allowed: boolean;
  capabilities: string[];
  programmer: string | null;
  missing: string[];
  notes: string[];
  flash_size: string | null;
  mac: string | null;
  busy: boolean;
}

export interface ToolchainInfo {
  available: boolean;
  version?: string | null;
  path?: string | null;
}

export interface AgentRecord {
  id: string;
  name: string;
  connected: boolean;
  last_seen: number;
  connected_at: number | null;
  version: string | null;
  os: string | null;
  toolchains: Record<string, ToolchainInfo>;
}
