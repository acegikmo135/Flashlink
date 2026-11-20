import { describe, expect, it } from "vitest";
import vectors from "../../shared/test-vectors/manifests.json";
import { validateManifest } from "../src/jobs/manifest";
import { crc32, decodeFrame, encodeFrame, FRAME_HEADER_BYTES } from "../src/transfers/framing";
import { hashPassword, signToken, verifyPassword, verifyToken, timingSafeEqual, sha256Hex } from "../src/lib/crypto";
import { selectDevice } from "../src/devices/select";
import type { AgentRecord, DeviceRecord } from "../src/jobs/types";

describe("manifest validation (shared vectors)", () => {
  for (const v of vectors as { name: string; manifest: unknown; valid: boolean; codes: string[] }[]) {
    it(v.name, () => {
      const r = validateManifest(v.manifest);
      expect(r.ok).toBe(v.valid);
      if (!r.ok) {
        const codes = r.issues.map((i) => i.code);
        for (const c of v.codes) expect(codes).toContain(c);
      }
    });
  }

  it("normalises defaults and lowercases hashes", () => {
    const r = validateManifest({
      job_id: "job_norm_0001",
      target: { family: "avr", board: "arduino-uno" },
      files: [{ address: "0x0", filename: "a.hex", size: 10, sha256: "A".repeat(64) }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.files[0].format).toBe("ihex");
      expect(r.manifest.files[0].sha256).toBe("a".repeat(64));
      expect(r.manifest.flash_config.baud_rate).toBe(115200);
    }
  });
});

describe("framing", () => {
  it("crc32 matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("round-trips a frame", () => {
    const payload = crypto.getRandomValues(new Uint8Array(1000));
    const f = decodeFrame(encodeFrame(7, payload, true));
    expect(f.seq).toBe(7);
    expect(f.last).toBe(true);
    expect(Array.from(f.payload)).toEqual(Array.from(payload));
  });
  it("detects corruption", () => {
    const frame = encodeFrame(0, new Uint8Array([1, 2, 3, 4]), false);
    frame[FRAME_HEADER_BYTES + 1] ^= 0xff;
    expect(() => decodeFrame(frame)).toThrow(/crc/);
  });
});

describe("crypto", () => {
  it("signs and verifies tokens, rejects tampering and expiry", async () => {
    const t = await signToken("k", { a: 1, exp: Date.now() + 10_000 });
    expect(await verifyToken("k", t)).toMatchObject({ a: 1 });
    expect(await verifyToken("other", t)).toBeNull();
    expect(await verifyToken("k", t.slice(0, -2) + "xx")).toBeNull();
    const expired = await signToken("k", { exp: Date.now() - 1 });
    expect(await verifyToken("k", expired)).toBeNull();
  });
  it("hashes and verifies passwords", async () => {
    const h = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
  it("timingSafeEqual + sha256", async () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("device selection", () => {
  const agent = (connected: boolean): AgentRecord => ({ id: "a1", name: "pc", connected, last_seen: 0, connected_at: 0, version: "1", os: "w", toolchains: {} });
  const dev = (id: string, connected = true): DeviceRecord =>
    ({ id, agent_id: "a1", port: "COM" + id, connected, first_seen: 0, last_seen: 0, added_version: 1, removed_version: 0, usb: {} as any, family: "esp32", chip: null, board: null, identified: false, identification: "", supported: true, allowed: true, capabilities: [], programmer: null, missing: [], notes: [], flash_size: null, mac: null, busy: false }) as DeviceRecord;

  it("distinguishes no agent / no device / multiple / disconnected", () => {
    expect(selectDevice([], { a1: agent(false) })).toMatchObject({ ok: false, error: { code: "NO_AGENT_CONNECTED" } });
    expect(selectDevice([], { a1: agent(true) })).toMatchObject({ ok: false, error: { code: "NO_DEVICE" } });
    expect(selectDevice([dev("dev1"), dev("dev2")], { a1: agent(true) })).toMatchObject({ ok: false, error: { code: "MULTIPLE_DEVICES" } });
    expect(selectDevice([dev("dev1"), dev("dev2")], { a1: agent(true) }, "dev2")).toMatchObject({ ok: true });
    expect(selectDevice([dev("dev1", false)], { a1: agent(true) }, "dev1")).toMatchObject({ ok: false, error: { code: "DEVICE_DISCONNECTED" } });
    expect(selectDevice([dev("dev1")], { a1: agent(true) }, "nope")).toMatchObject({ ok: false, error: { code: "DEVICE_NOT_FOUND" } });
    expect(selectDevice([dev("dev1")], { a1: agent(true) })).toMatchObject({ ok: true });
    // unsupported serial ports (e.g. Bluetooth COM ports) must not cause MULTIPLE_DEVICES
    const bt = { ...dev("bt1"), supported: false };
    const bt2 = { ...dev("bt2"), supported: false };
    expect(selectDevice([bt, bt2, dev("dev1")], { a1: agent(true) })).toMatchObject({ ok: true, device: { id: "dev1" } });
    expect(selectDevice([bt, bt2], { a1: agent(true) })).toMatchObject({ ok: false, error: { code: "NO_DEVICE" } });
  });
});
