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

import { ESP32_BOOT } from "../src/compile/esp32-boot";
import { LIBRARY_NAME, espHeader, normalizeIhex } from "../src/compile/backend";
import { parseRange } from "../src/installer";

describe("embedded ESP32 boot components (blank-chip support)", () => {
  const sha = (b: Uint8Array) => sha256Hex(b);
  it("match their recorded hashes and sizes", async () => {
    for (const c of [ESP32_BOOT.bootloader, ESP32_BOOT.partitions, ESP32_BOOT.boot_app0]) {
      expect(c.data.length).toBe(c.size);
      expect(await sha(c.data)).toBe(c.sha256);
    }
    // boot_app0 is byte-identical to the one in a job that really booted on hardware
    expect(ESP32_BOOT.boot_app0.sha256).toBe("f94c5d786a7a8fab06ac5d10e33bf37711a6697636dc037559ea19cc410a17f0");
  });
  it("bootloader is a classic-ESP32 DIO image with a header compatible with the app", () => {
    const b = ESP32_BOOT.bootloader.data;
    expect(b[0]).toBe(0xe9);
    expect(b[1]).toBe(3); // segments
    expect(espHeader(b)).toEqual({ mode: "dio", frequency: "80m", flash_size: "4MB" });
    expect(b[12] | (b[13] << 8)).toBe(0); // chip id 0 = ESP32
    expect(ESP32_BOOT.bootloader.address).toBe(0x1000);
  });
  it("partition table has the app where the app image is flashed and fits the size limit", () => {
    const t = ESP32_BOOT.partitions.data;
    const dv = new DataView(t.buffer, t.byteOffset);
    const entries: Record<string, { type: number; sub: number; off: number; size: number }> = {};
    for (let o = 0; o + 32 <= t.length && t[o] === 0xaa && t[o + 1] === 0x50; o += 32) {
      const name = new TextDecoder().decode(t.subarray(o + 12, o + 28)).replace(/\0.*$/, "");
      entries[name] = { type: t[o + 2], sub: t[o + 3], off: dv.getUint32(o + 4, true), size: dv.getUint32(o + 8, true) };
    }
    expect(entries.app0).toEqual({ type: 0, sub: 0x10, off: 0x10000, size: 0x140000 });
    expect(entries.otadata.off).toBe(0xe000);
    expect(entries.nvs.off).toBe(0x9000);
    expect(ESP32_BOOT.app_offset).toBe(entries.app0.off);
    expect(ESP32_BOOT.app_max_bytes).toBe(entries.app0.size);
    expect(ESP32_BOOT.boot_app0.address).toBe(0xe000);
    expect(ESP32_BOOT.partitions.address).toBe(0x8000);
    // regions do not overlap each other or the app
    expect(ESP32_BOOT.bootloader.address + ESP32_BOOT.bootloader.size).toBeLessThanOrEqual(ESP32_BOOT.partitions.address);
    expect(ESP32_BOOT.boot_app0.address + ESP32_BOOT.boot_app0.size).toBeLessThanOrEqual(ESP32_BOOT.app_offset);
  });
});

describe("library names (become lines of libraries.txt)", () => {
  it("accepts Library Manager names, optionally pinned", () => {
    for (const ok of ["Adafruit NeoPixel", "DHT sensor library@1.4.6", "PubSubClient", "ArduinoJson@7.0.4", "LiquidCrystal I2C", "Adafruit_GFX_Library"]) expect(LIBRARY_NAME.test(ok), ok).toBe(true);
  });
  it("rejects anything that could smuggle extra lines or paths", () => {
    for (const bad of ["", "x\nmalicious", "a\rb", "../evil", "lib;rm -rf /", "$(whoami)", "x".repeat(80), " leading", "a@", "a@v1", "https://evil.example/lib.zip", "name`cmd`"]) expect(LIBRARY_NAME.test(bad), JSON.stringify(bad)).toBe(false);
  });
});

describe("ihex normalisation", () => {
  it("normalises CRLF and requires the EOF record", () => {
    expect(normalizeIhex(":02000000FFCF30\r\n:00000001FF\r\n")).toBe(":02000000FFCF30\n:00000001FF\n");
    expect(normalizeIhex(":02000000FFCF30\n")).toBeNull();
    expect(normalizeIhex("not hex")).toBeNull();
  });
  it("range parser", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=200-", 100)).toBe("invalid");
  });
});

import { buildIdFor, cacheKey } from "../src/compile/builds";
describe("build cache key", () => {
  const base = { board: "arduino-uno", sketch: "void setup(){}", files: [{ name: "a.h", content: "1" }, { name: "b.h", content: "2" }], libraries: ["X", "Y@1.0.0"] };
  it("is stable and order-independent but sensitive to every input", async () => {
    const k = await cacheKey(base);
    expect(await cacheKey({ ...base, files: [...base.files].reverse(), libraries: ["Y@1.0.0", "X"] })).toBe(k);
    for (const changed of [{ board: "arduino-nano" }, { sketch: "x" }, { libraries: ["X"] }, { files: [{ name: "a.h", content: "9" }, base.files[1]] }]) expect(await cacheKey({ ...base, ...changed })).not.toBe(k);
    expect(buildIdFor(k)).toMatch(/^bld_[0-9a-f]{12}$/);
  });
});
