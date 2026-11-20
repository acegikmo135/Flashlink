import { isTerminal, type AgentRecord, type DeviceRecord, type Job } from "../jobs/types";

export const iso = (t?: number | null) => (t ? new Date(t).toISOString() : null);

// --------------------------------------------------------------------- shapes

export function publicDevice(d: DeviceRecord, agents: Record<string, AgentRecord>, jobs: Job[]) {
  const active = jobs.find((j) => j.device_id === d.id && !isTerminal(j.status));
  const agent = agents[d.agent_id];
  const state = !agent?.connected ? "agent_offline" : !d.connected ? "disconnected" : active ? (active.kind === "flash" ? "flashing" : "verifying") : "idle";
  return {
    device_id: d.id,
    state,
    port: d.port,
    family: d.family,
    chip: d.chip,
    board: d.board,
    identified: d.identified,
    identification_source: d.identification,
    supported: d.supported,
    remote_flashing_allowed: d.allowed,
    flash_size: d.flash_size,
    mac: d.mac,
    programmer: d.programmer,
    capabilities: d.capabilities,
    missing_tooling: d.missing,
    notes: d.notes,
    usb: d.usb,
    active_job_id: active?.id ?? null,
    first_seen: iso(d.first_seen),
    last_seen: iso(d.last_seen),
  };
}

export function publicAgent(a: AgentRecord) {
  return { agent_id: a.id, name: a.name, online: a.connected, version: a.version, os: a.os, last_seen: iso(a.last_seen), toolchains: a.toolchains };
}

