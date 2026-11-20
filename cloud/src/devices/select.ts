import type { DeviceRecord, AgentRecord, ErrorCode } from "../jobs/types";

export interface Failure {
  ok: false;
  error: { code: ErrorCode; message: string; hint?: string; details?: unknown };
}

/** Whether a device can currently be talked to (agent online AND device present). */
export function isReachable(d: DeviceRecord, agents: Record<string, AgentRecord>): boolean {
  return d.connected && !!agents[d.agent_id]?.connected;
}

/**
 * Resolve which device a tool call targets. This is where Claude learns the
 * difference between "nothing plugged in", "several candidates", etc.
 */
export function selectDevice(
  devices: DeviceRecord[],
  agents: Record<string, AgentRecord>,
  deviceId?: string,
): { ok: true; device: DeviceRecord } | Failure {
  const online = Object.values(agents).filter((a) => a.connected);
  if (deviceId) {
    const d = devices.find((x) => x.id === deviceId);
    if (!d) {
      return { ok: false, error: { code: "DEVICE_NOT_FOUND", message: `No device with id '${deviceId}' is known for this account.`, hint: "Call list_devices to see current device ids." } };
    }
    if (!agents[d.agent_id]?.connected) {
      return { ok: false, error: { code: "NO_AGENT_CONNECTED", message: `The MCU Bridge desktop app that owns '${deviceId}' is offline.`, hint: "Ask the user to start MCU Bridge on their PC and check its connection status." } };
    }
    if (!d.connected) {
      return { ok: false, error: { code: "DEVICE_DISCONNECTED", message: `Device '${deviceId}' (${d.port ?? "no port"}) is no longer connected.`, hint: "Ask the user to re-plug the board, then call detect_new_devices." } };
    }
    return { ok: true, device: d };
  }
  if (online.length === 0) {
    return { ok: false, error: { code: "NO_AGENT_CONNECTED", message: "No MCU Bridge desktop app is connected to this account.", hint: "Ask the user to start MCU Bridge on their Windows PC and make sure it shows 'Connected'." } };
  }
  const live = devices.filter((d) => isReachable(d, agents));
  if (live.length === 0) {
    return { ok: false, error: { code: "NO_DEVICE", message: "The desktop app is connected but no microcontroller is plugged in.", hint: "Ask the user to connect the board via USB, then call detect_new_devices with wait_seconds." } };
  }
  if (live.length > 1) {
    return {
      ok: false,
      error: {
        code: "MULTIPLE_DEVICES",
        message: `${live.length} devices are connected; specify device_id.`,
        details: live.map((d) => ({ device_id: d.id, port: d.port, family: d.family, chip: d.chip, board: d.board })),
        hint: "Pick one device_id from details (or list_devices) and repeat the call.",
      },
    };
  }
  return { ok: true, device: live[0] };
}
