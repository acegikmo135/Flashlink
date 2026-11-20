import type { Env } from "../env";

/** 1–32 chars, starts with a letter/digit; letters, digits, space, _ . - only (names are shown to AIs and used as identifiers). */
export const DEVICE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.\-]{0,31}$/;

export async function loadNames(env: Env, userId: string): Promise<Map<string, string>> {
  const r = await env.DB.prepare("SELECT device_id, name FROM device_names WHERE user_id = ?1").bind(userId).all<{ device_id: string; name: string }>();
  return new Map(r.results.map((x) => [x.device_id, x.name]));
}

/** Accepts a device id or a user-chosen name (case-insensitive) and returns the device id. Unknown values pass through unchanged. */
export async function resolveDeviceRef(env: Env, userId: string, ref: string | undefined): Promise<string | undefined> {
  if (!ref) return ref;
  const row = await env.DB.prepare("SELECT device_id FROM device_names WHERE user_id = ?1 AND name = ?2").bind(userId, ref.trim()).first<{ device_id: string }>();
  return row?.device_id ?? ref;
}

export async function setDeviceName(env: Env, userId: string, deviceId: string, name: string | null): Promise<{ ok: true; name: string | null } | { ok: false; code: string; message: string }> {
  if (name === null || name.trim() === "") {
    await env.DB.prepare("DELETE FROM device_names WHERE user_id = ?1 AND device_id = ?2").bind(userId, deviceId).run();
    return { ok: true, name: null };
  }
  const n = name.trim();
  if (!DEVICE_NAME.test(n)) return { ok: false, code: "INVALID_NAME", message: "Names are 1–32 characters: letters, digits, spaces, _ . - (must start with a letter or digit)." };
  const taken = await env.DB.prepare("SELECT device_id FROM device_names WHERE user_id = ?1 AND name = ?2").bind(userId, n).first<{ device_id: string }>();
  if (taken && taken.device_id !== deviceId) return { ok: false, code: "NAME_TAKEN", message: `Another board is already called '${n}'.` };
  await env.DB.prepare("INSERT INTO device_names (user_id, device_id, name, updated_at) VALUES (?1,?2,?3,?4) ON CONFLICT(user_id, device_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at").bind(userId, deviceId, n, Date.now()).run();
  return { ok: true, name: n };
}
