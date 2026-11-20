import React, { useEffect, useState } from "react";
import { AbsoluteFill, Audio, delayRender, continueRender, Easing, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

/* ------------------------------------------------------------------ palette & type
   Sampled from the product's own web UI (web/src/index.css, light theme) and its real UI font (Geist, bundled with the app). */
const PAL = { bg: "#f2f2f7", card: "#ffffff", text: "#000000", muted: "rgba(60,60,67,0.6)", blue: "#007aff", green: "#34c759", orange: "#ff9500", purple: "#af52de", line: "rgba(60,60,67,0.16)", font: "Geist, system-ui, sans-serif" };
const HERO = 120, LINE = 64, CAP = 30;   // the film's only three type sizes
const MARGIN = 96;

/* ------------------------------------------------------------------ motion language: one easing curve, fade+rise, slow push-in only */
const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const fadeRise = (frame: number, delay = 0, dist = 16) => ({
  opacity: interpolate(frame - delay, [0, 18], [0, 1], { easing: EASE, ...clamp }),
  transform: `translateY(${interpolate(frame - delay, [0, 18], [dist, 0], { easing: EASE, ...clamp })}px)`,
});
const pushIn = (frame: number, dur: number, to = 1.08) => interpolate(frame, [0, dur], [1, to], { easing: Easing.inOut(Easing.ease), ...clamp });
const entrance = (frame: number, fps: number, delay = 0) => spring({ frame: frame - delay, fps, config: { damping: 100, stiffness: 200, mass: 0.5 } });
const grow = (frame: number, from: number, dur = 24) => interpolate(frame, [from, from + dur], [0, 1], { easing: EASE, ...clamp });

const useGeist = () => {
  const [handle] = useState(() => delayRender("font"));
  useEffect(() => {
    const f = new FontFace("Geist", `url(${staticFile("fonts/geist.woff2")})`, { weight: "100 900" });
    f.load().then((ff) => { document.fonts.add(ff); continueRender(handle); }).catch(() => continueRender(handle));
  }, [handle]);
};

/* ------------------------------------------------------------------ shared pieces */
const Logo: React.FC<{ size: number }> = ({ size }) => (
  <svg viewBox="0 0 64 64" width={size} height={size} style={{ filter: "drop-shadow(0 18px 40px rgba(0,122,255,0.30))" }}>
    <rect width="64" height="64" rx="14" fill="#007aff" />
    <g fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="14" y="14" width="36" height="36" rx="7" />
      <path d="M24 8v6M32 8v6M40 8v6M24 50v6M32 50v6M40 50v6M8 24h6M8 32h6M8 40h6M50 24h6M50 32h6M50 40h6" strokeWidth="3" />
      <path d="M25 39a5 5 0 0 1-.6-9.9 7.5 7.5 0 0 1 14.2 1.3A4.3 4.3 0 0 1 38 39z" strokeWidth="3" />
    </g>
  </svg>
);
const Center: React.FC<{ children: React.ReactNode; gap?: number; top?: boolean }> = ({ children, gap = 28, top }) => (
  <AbsoluteFill style={{ backgroundColor: PAL.bg, justifyContent: top ? "flex-start" : "center", alignItems: "center", padding: MARGIN, paddingTop: top ? 110 : MARGIN, flexDirection: "column", gap }}>{children}</AbsoluteFill>
);
const Hero: React.FC<{ text: string; delay?: number; color?: string }> = ({ text, delay = 0, color = PAL.text }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ fontFamily: PAL.font, fontSize: HERO, fontWeight: 600, letterSpacing: "-0.02em", color, textAlign: "center", lineHeight: 1.05, display: "flex", gap: "0.28em", flexWrap: "wrap", justifyContent: "center" }}>
      {text.split(" ").map((w, i) => <span key={i} style={fadeRise(frame, delay + i * 6)}>{w}</span>)}
    </div>
  );
};
const Line: React.FC<{ text: string; delay?: number; muted?: boolean }> = ({ text, delay = 0, muted }) => {
  const frame = useCurrentFrame();
  return <div style={{ ...fadeRise(frame, delay), fontFamily: PAL.font, fontSize: LINE, fontWeight: 600, letterSpacing: "-0.02em", color: muted ? PAL.muted : PAL.text, textAlign: "center", lineHeight: 1.1 }}>{text}</div>;
};
const Cap: React.FC<{ text: string; delay?: number; color?: string; weight?: number }> = ({ text, delay = 0, color = PAL.muted, weight = 500 }) => {
  const frame = useCurrentFrame();
  return <div style={{ ...fadeRise(frame, delay), fontFamily: PAL.font, fontSize: CAP, fontWeight: weight, color, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums" }}>{text}</div>;
};
const Frame: React.FC<{ w: number; h: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ w, h, children, style }) => (
  <div style={{ width: w, height: h, borderRadius: 24, overflow: "hidden", background: PAL.card, boxShadow: "0 40px 120px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.06)", position: "relative", ...style }}>{children}</div>
);
const Check: React.FC<{ size?: number; progress?: number }> = ({ size = 40, progress = 1 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} style={{ opacity: progress }}>
    <circle cx="12" cy="12" r="12" fill={PAL.green} />
    <path d="M6.5 12.5l3.8 3.8 7.2-7.6" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="20" strokeDashoffset={20 * (1 - progress)} />
  </svg>
);
const Row: React.FC<{ k: string; v: React.ReactNode; frame: number; i: number; last?: boolean; h?: number }> = ({ k, v, frame, i, last, h = 78 }) => (
  <div style={{ ...fadeRise(frame, 18 + i * 6, 10), display: "flex", justifyContent: "space-between", alignItems: "center", height: h, borderBottom: last ? "none" : `1px solid ${PAL.line}`, fontFamily: PAL.font, fontSize: CAP }}>
    <span style={{ color: PAL.muted }}>{k}</span>
    <span style={{ color: PAL.text, fontWeight: 600, fontVariantNumeric: "tabular-nums", display: "flex", alignItems: "center", gap: 14 }}>{v}</span>
  </div>
);

/* ------------------------------------------------------------------ 1 · cold open */
const ColdOpen: React.FC = () => (
  <Center gap={36}>
    <Hero text="AI writes the firmware." />
    <Line text="You still flash it by hand." delay={46} muted />
  </Center>
);

/* ------------------------------------------------------------------ 2 · the old way, shown as steps that keep coming back */
const OldWay: React.FC = () => {
  const frame = useCurrentFrame();
  const steps = ["Find the port.", "Pick the tool.", "Pick the baud rate."];
  return (
    <Center gap={30}>
      {steps.map((s, i) => (
        <div key={s} style={{ ...fadeRise(frame, 6 + i * 22), fontFamily: PAL.font, fontSize: HERO, fontWeight: 600, letterSpacing: "-0.02em", color: i === steps.length - 1 ? PAL.text : PAL.muted, textAlign: "center", lineHeight: 1.05 }}>{s}</div>
      ))}
      <div style={{ marginTop: 16 }}><Line text="Then do it again." delay={84} muted /></div>
    </Center>
  );
};

/* ------------------------------------------------------------------ 3 · the promise */
const PromiseScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = entrance(frame, fps);
  return (
    <Center gap={52}>
      <div style={{ transform: `scale(${0.85 + 0.15 * s})`, opacity: s }}><Logo size={150} /></div>
      <Hero text="Let your AI flash it." delay={14} />
    </Center>
  );
};

/* ------------------------------------------------------------------ 4 · how it connects (DOM rebuild — a diagram, not product UI) */
const Icon: React.FC<{ kind: "chat" | "cloud" | "pc" | "chip" }> = ({ kind }) => {
  const p = { fill: "none", stroke: PAL.text, strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <svg viewBox="0 0 64 64" width={96} height={96}>
      {kind === "chat" && <g {...p}><path d="M10 14h44a4 4 0 0 1 4 4v22a4 4 0 0 1-4 4H30l-12 10V44h-8a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z" /><path d="M20 26h24M20 34h14" /></g>}
      {kind === "cloud" && <g {...p}><path d="M18 46a10 10 0 0 1-1.5-19.9A15 15 0 0 1 45 22.6 11.5 11.5 0 0 1 46 46z" /></g>}
      {kind === "pc" && <g {...p}><rect x="8" y="12" width="48" height="32" rx="4" /><path d="M24 52h16M32 44v8" /></g>}
      {kind === "chip" && <g {...p}><rect x="16" y="16" width="32" height="32" rx="6" /><path d="M26 8v8M38 8v8M26 48v8M38 48v8M8 26h8M8 38h8M48 26h8M48 38h8" /></g>}
    </svg>
  );
};
const HowItConnects: React.FC = () => {
  const frame = useCurrentFrame();
  const nodes: { kind: "chat" | "cloud" | "pc" | "chip"; label: string }[] = [
    { kind: "chat", label: "Your AI chat" }, { kind: "cloud", label: "Cloud compiler" }, { kind: "pc", label: "MCU Bridge on your PC" }, { kind: "chip", label: "Your board" },
  ];
  const NODE = 200, GAP = 170;
  const xs = nodes.map((_, i) => i * (NODE + GAP));
  const total = 4 * NODE + 3 * GAP;
  return (
    <Center gap={90}>
      <Line text="One install. Any AI." />
      <div style={{ position: "relative", width: total, height: NODE + 80 }}>
        {xs.slice(0, -1).map((x, i) => {
          const g = grow(frame, 30 + i * 24, 26);
          return <div key={i} style={{ position: "absolute", left: x + NODE + 14, top: NODE / 2 - 1.5, width: (GAP - 28) * g, height: 3, background: PAL.blue, borderRadius: 2 }} />;
        })}
        {/* one packet travels the whole way, once */}
        {(() => {
          const t = interpolate(frame, [96, 150], [0, 1], { easing: Easing.inOut(Easing.ease), ...clamp });
          const px = t * (total - NODE) + NODE / 2 - 9;
          return <div style={{ position: "absolute", left: px, top: NODE / 2 - 9, width: 18, height: 18, borderRadius: 9, background: PAL.blue, opacity: t > 0 && t < 1 ? 1 : 0 }} />;
        })()}
        {nodes.map((n, i) => (
          <div key={n.label} style={{ position: "absolute", left: xs[i], top: 0, width: NODE, ...fadeRise(frame, 6 + i * 24, 18) }}>
            <div style={{ width: NODE, height: NODE, borderRadius: 44, background: PAL.card, boxShadow: "0 30px 80px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.05)", display: "grid", placeItems: "center" }}><Icon kind={n.kind} /></div>
            <div style={{ marginTop: 26, textAlign: "center", fontFamily: PAL.font, fontSize: CAP, fontWeight: 500, color: PAL.muted, width: NODE + 60, marginLeft: -30 }}>{n.label}</div>
          </div>
        ))}
      </div>
    </Center>
  );
};

/* ------------------------------------------------------------------ 5 · the plain-words prompt (DOM rebuild of a generic chat) */
const PromptScene: React.FC = () => {
  const frame = useCurrentFrame();
  const P = "Flash the blink sketch to Kitchen ESP32";
  const typed = Math.round(interpolate(frame, [24, 24 + 70], [0, P.length], { ...clamp }));
  const showReply = frame > 112;
  const bar = interpolate(frame, [126, 170], [0, 1], { easing: Easing.inOut(Easing.ease), ...clamp });
  return (
    <Center gap={56} top>
      <Line text="Say it in plain words." />
      <div style={{ ...fadeRise(frame, 8, 24) }}>
        <Frame w={1240} h={620}>
          <div style={{ padding: "34px 44px", display: "flex", flexDirection: "column", gap: 26, height: "100%" }}>
            <div style={{ fontFamily: PAL.font, fontSize: CAP, color: PAL.muted, fontWeight: 500 }}>Any AI chat</div>
            <div style={{ alignSelf: "flex-end", maxWidth: 940, background: PAL.blue, color: "#fff", fontFamily: PAL.font, fontSize: CAP + 6, fontWeight: 500, padding: "22px 32px", borderRadius: 32, lineHeight: 1.25, minHeight: 74 }}>
              {P.slice(0, typed)}{typed < P.length && <span style={{ opacity: Math.floor(frame / 8) % 2 }}>|</span>}
            </div>
            {showReply && (
              <div style={{ ...fadeRise(frame, 112, 14), alignSelf: "flex-start", maxWidth: 940, background: "rgba(120,120,128,0.12)", fontFamily: PAL.font, fontSize: CAP + 4, color: PAL.text, padding: "24px 32px", borderRadius: 32, lineHeight: 1.3 }}>
                Compiling for your ESP32, then flashing it.
                <div style={{ marginTop: 18, display: "inline-flex", alignItems: "center", gap: 12, fontSize: CAP - 4, fontWeight: 600, color: PAL.blue, background: "rgba(0,122,255,0.12)", padding: "8px 18px", borderRadius: 14 }}>build_and_flash</div>
                <div style={{ marginTop: 20, height: 10, width: 520, borderRadius: 5, background: "rgba(120,120,128,0.2)", overflow: "hidden" }}><div style={{ height: "100%", width: `${bar * 100}%`, background: PAL.blue, borderRadius: 5 }} /></div>
              </div>
            )}
          </div>
        </Frame>
      </div>
    </Center>
  );
};

/* ------------------------------------------------------------------ 6 · the moment — three camera shots on ONE real capture of the actual web app.
   The capture (public/captures/hero.mp4) plays continuously; each shot is a crop of it, so the action never restarts. */
const CAP_W = 1440, CAP_H = 900;
const Shot: React.FC<{ videoStart: number; lines: [string, number][]; cx: number; cy: number; zoom: number; dur: number; w?: number; h?: number }> = ({ videoStart, lines, cx, cy, zoom, dur, w = 1560, h = 640 }) => {
  const frame = useCurrentFrame();
  const k = (w / CAP_W) * zoom * pushIn(frame, dur, 1.05);
  // captions swap on a short cross-fade; each stays up for its window
  return (
    <Center gap={44} top>
      <div style={{ position: "relative", height: LINE * 1.1, width: 1400 }}>
        {lines.map(([t, until], i) => {
          const from = i === 0 ? 0 : lines[i - 1][1];
          const o = interpolate(frame, [from, from + 10, until - 8, until], [i === 0 ? 1 : 0, 1, 1, i === lines.length - 1 ? 1 : 0], { ...clamp });
          const y = interpolate(frame - from, [0, 18], [i === 0 ? 0 : 16, 0], { easing: EASE, ...clamp });
          return <div key={t} style={{ position: "absolute", inset: 0, textAlign: "center", opacity: o, transform: `translateY(${y}px)`, fontFamily: PAL.font, fontSize: LINE, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{t}</div>;
        })}
      </div>
      <Frame w={w} h={h}>
        <div style={{ position: "absolute", left: w / 2 - cx * k, top: h / 2 - cy * k, width: CAP_W * k, height: CAP_H * k }}>
          <OffthreadVideo src={staticFile("captures/hero.mp4")} startFrom={Math.round(videoStart * 30)} muted style={{ width: "100%", height: "100%", display: "block" }} />
        </div>
      </Frame>
    </Center>
  );
};
const ShotWide: React.FC = () => {
  const frame = useCurrentFrame();
  const W = 1300, H = 812;
  return (
    <Center gap={36} top>
      <Line text="Name your boards." />
      <Frame w={W} h={H}>
        <div style={{ width: W, height: H, transform: `scale(${pushIn(frame, 60, 1.04)})`, transformOrigin: "50% 40%" }}>
          <OffthreadVideo src={staticFile("captures/hero.mp4")} muted style={{ width: W, height: H, objectFit: "cover", display: "block" }} />
        </div>
      </Frame>
    </Center>
  );
};

/* ------------------------------------------------------------------ 7 · compile — DOM rebuild of a REAL tool response (live compile_firmware call) */
const CompileCard: React.FC = () => {
  const frame = useCurrentFrame();
  const rows: [string, React.ReactNode][] = [
    ["tool", "compile_firmware"], ["board", "arduino-uno"], ["libraries", "Adafruit NeoPixel"], ["size", "6,264 bytes"], ["sha-256", "6094da1f97dd751917247fd25f1a9274…"],
    ["status", <><span style={{ color: PAL.green }}>ok</span><Check size={34} progress={grow(frame, 56, 14)} /></>],
  ];
  return (
    <Center gap={56} top>
      <Line text="Compiles in the cloud." />
      <div style={{ ...fadeRise(frame, 10, 24), transform: `scale(${pushIn(frame, 120, 1.03)})` }}>
        <Frame w={1180} h={rows.length * 78 + 56}>
          <div style={{ padding: "28px 48px" }}>{rows.map(([k, v], i) => <Row key={k} k={k} v={v} frame={frame} i={i} last={i === rows.length - 1} />)}</div>
        </Frame>
      </div>
    </Center>
  );
};

/* ------------------------------------------------------------------ 8 · libraries */
const Libraries: React.FC = () => {
  const frame = useCurrentFrame();
  const libs: [string, string][] = [["Adafruit NeoPixel", "latest"], ["DHT sensor library", "1.4.6"], ["ArduinoJson", "7.0.4"]];
  return (
    <Center gap={56} top>
      <Line text="Any library you need." />
      <div style={{ ...fadeRise(frame, 10, 24) }}>
        <Frame w={1180} h={libs.length * 96 + 128}>
          <div style={{ padding: "26px 48px" }}>
            <div style={{ ...fadeRise(frame, 14, 8), fontFamily: PAL.font, fontSize: CAP, color: PAL.muted, height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${PAL.line}` }}><span>libraries</span><span>Arduino Library Manager</span></div>
            {libs.map(([n, v], i) => (
              <div key={n} style={{ ...fadeRise(frame, 26 + i * 12, 10), display: "flex", alignItems: "center", justifyContent: "space-between", height: 96, borderBottom: i < libs.length - 1 ? `1px solid ${PAL.line}` : "none", fontFamily: PAL.font, fontSize: CAP + 6, fontWeight: 600 }}>
                <span>{n}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 16, color: PAL.muted, fontWeight: 500, fontSize: CAP }}>{v === "latest" ? "latest" : `@${v}`}<Check size={34} progress={grow(frame, 40 + i * 12, 14)} /></span>
              </div>
            ))}
          </div>
        </Frame>
      </div>
      <Cap text="Pin a version and a rebuild stays identical." delay={80} />
    </Center>
  );
};

/* ------------------------------------------------------------------ 9 · full ESP32 image — the real flash layout (DOM rebuild) */
const FlashMap: React.FC = () => {
  const frame = useCurrentFrame();
  const W = 1500, TOTAL = 0x150000;
  const px = (a: number) => (a / TOTAL) * W;
  const parts: { name: string; addr: number; size: number; color: string; sizeLabel: string }[] = [
    { name: "bootloader.bin", addr: 0x1000, size: 17104, color: PAL.purple, sizeLabel: "17,104 B" },
    { name: "partitions.bin", addr: 0x8000, size: 3072, color: PAL.orange, sizeLabel: "3,072 B" },
    { name: "boot_app0.bin", addr: 0xe000, size: 8192, color: PAL.green, sizeLabel: "8,192 B" },
    { name: "firmware.bin", addr: 0x10000, size: 0x140000, color: PAL.blue, sizeLabel: "your app" },
  ];
  return (
    <Center gap={50} top>
      <Line text="Even a blank ESP32 boots." />
      <div style={{ ...fadeRise(frame, 10, 20), width: W }}>
        <div style={{ position: "relative", height: 64, background: "rgba(120,120,128,0.14)", borderRadius: 14, overflow: "hidden" }}>
          {parts.map((p, i) => (
            <div key={p.name} style={{ position: "absolute", left: px(p.addr), width: Math.max(px(p.size) * grow(frame, 30 + i * 18, 20), 4) * (p.name === "firmware.bin" ? 0.9 : 1), top: 0, bottom: 0, background: p.color, opacity: grow(frame, 30 + i * 18, 12) }} />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontFamily: PAL.font, fontSize: CAP - 6, color: PAL.muted }}><span>0x0</span><span>0x150000</span></div>
      </div>
      <Frame w={1180} h={parts.length * 74 + 56}>
        <div style={{ padding: "28px 48px" }}>
          {parts.map((p, i) => (
            <div key={p.name} style={{ ...fadeRise(frame, 40 + i * 18, 10), display: "flex", alignItems: "center", height: 74, borderBottom: i < parts.length - 1 ? `1px solid ${PAL.line}` : "none", fontFamily: PAL.font, fontSize: CAP, fontVariantNumeric: "tabular-nums" }}>
              <span style={{ width: 16, height: 16, borderRadius: 8, background: p.color, marginRight: 20 }} />
              <span style={{ fontWeight: 600, flex: 1 }}>{p.name}</span>
              <span style={{ color: PAL.muted, width: 200 }}>0x{p.addr.toString(16)}</span>
              <span style={{ color: PAL.muted, width: 180, textAlign: "right" }}>{p.sizeLabel}</span>
            </div>
          ))}
        </div>
      </Frame>
    </Center>
  );
};

/* ------------------------------------------------------------------ 10 · the right tool per board */
const RightTool: React.FC = () => {
  const frame = useCurrentFrame();
  const rows: [string, string][] = [["Arduino Uno · Nano · Mega", "avrdude"], ["ESP32 · ESP8266", "esptool"]];
  return (
    <Center gap={64} top>
      <Line text="The right tool, every time." />
      <Frame w={1380} h={rows.length * 150 + 56}>
        <div style={{ padding: "28px 56px" }}>
          {rows.map(([b, t], i) => {
            const g = grow(frame, 24 + i * 26, 22);
            return (
              <div key={b} style={{ display: "flex", alignItems: "center", height: 150, borderBottom: i < rows.length - 1 ? `1px solid ${PAL.line}` : "none", fontFamily: PAL.font }}>
                <span style={{ flex: 1, fontSize: LINE - 14, fontWeight: 600, letterSpacing: "-0.02em", opacity: g }}>{b}</span>
                <span style={{ width: 120 * g, height: 3, background: PAL.blue, borderRadius: 2, marginRight: 34 }} />
                <span style={{ fontSize: LINE - 14, fontWeight: 600, letterSpacing: "-0.02em", color: PAL.blue, opacity: g, width: 300 }}>{t}</span>
              </div>
            );
          })}
        </div>
      </Frame>
      <Cap text="Chosen from the board it detects. Never the wrong one." delay={70} />
    </Center>
  );
};

/* ------------------------------------------------------------------ 11 · re-flash a build (DOM rebuild of real fields from the live build history) */
const Reflash: React.FC = () => {
  const frame = useCurrentFrame();
  const rows: [string, React.ReactNode][] = [
    ["flash_build", "bld_8d15561a8060"],
    ["rebuilds from your source", <Check size={34} progress={grow(frame, 40, 14)} />],
    ["sha-256 matches the record", <Check size={34} progress={grow(frame, 66, 14)} />],
    ["differs? refused until you allow it", <span style={{ color: PAL.muted, fontWeight: 500 }}>BUILD_CHANGED</span>],
  ];
  return (
    <Center gap={56} top>
      <Line text="Re-flash any past build." />
      <div style={{ ...fadeRise(frame, 10, 24) }}>
        <Frame w={1180} h={rows.length * 78 + 56}>
          <div style={{ padding: "28px 48px" }}>{rows.map(([k, v], i) => <Row key={k} k={k} v={v} frame={frame} i={i} last={i === rows.length - 1} />)}</div>
        </Frame>
      </div>
      <Cap text="Firmware is never stored — only its record." delay={84} />
    </Center>
  );
};

/* ------------------------------------------------------------------ 12 · verified — crop of the real Activity page */
const Verified: React.FC = () => {
  const frame = useCurrentFrame();
  const W = 1560, H = 560, k = (W / CAP_W) * 2.0 * pushIn(frame, 120, 1.05);
  const cx = 860, cy = 262;
  return (
    <Center gap={44} top>
      <Line text="Verified, never assumed." />
      <div style={{ ...fadeRise(frame, 10, 24) }}>
        <Frame w={W} h={H}>
          <Img src={staticFile("captures/activity.jpg")} style={{ position: "absolute", left: W / 2 - cx * k, top: H / 2 - cy * k, width: CAP_W * k, height: CAP_H * k }} />
        </Frame>
      </div>
      <Cap text="A flash counts only when the desktop app confirms it." delay={60} />
    </Center>
  );
};

/* ------------------------------------------------------------------ 13 · proof, 14 · end card */
const Proof: React.FC = () => (
  <Center gap={40}>
    <Hero text="Verified on a real ESP32." />
    <Cap text="127 automated tests pass. Firmware is never stored." delay={44} />
  </Center>
);
const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = entrance(frame, fps);
  return (
    <Center gap={36}>
      <div style={{ transform: `scale(${0.85 + 0.15 * s})`, opacity: s }}><Logo size={220} /></div>
      <div style={{ ...fadeRise(frame, 10), fontFamily: PAL.font, fontSize: HERO, fontWeight: 600, letterSpacing: "-0.02em", color: PAL.text }}>MCU Bridge</div>
      <Cap text="Let your AI flash it." delay={20} color={PAL.text} weight={600} />
      <Cap text="mcu-bridge.manthankansagra.workers.dev" delay={30} />
    </Center>
  );
};

/* ------------------------------------------------------------------ assembly: every cut lands on a beat (60 bpm → whole seconds) */
const SEC = 30;
const S: { from: number; dur: number; C: React.FC }[] = [
  { from: 0, dur: 4, C: ColdOpen },
  { from: 4, dur: 3, C: OldWay },
  { from: 7, dur: 3, C: PromiseScene },
  { from: 10, dur: 4, C: HowItConnects },
  { from: 14, dur: 6, C: PromptScene },
  { from: 20, dur: 3, C: ShotWide },
  { from: 23, dur: 4, C: () => <Shot videoStart={3.0} lines={[["Ask your AI to flash one.", 84], ["Done. Logged.", 120]]} cx={640} cy={290} zoom={1.9} dur={120} /> },
  { from: 27, dur: 4, C: CompileCard },
  { from: 31, dur: 4, C: Libraries },
  { from: 35, dur: 5, C: FlashMap },
  { from: 40, dur: 4, C: RightTool },
  { from: 44, dur: 4, C: Reflash },
  { from: 48, dur: 4, C: Verified },
  { from: 52, dur: 4, C: Proof },
  { from: 56, dur: 5, C: EndCard },
];
export const TOTAL = 61 * SEC;

export const Film: React.FC = () => {
  useGeist();
  return (
    <AbsoluteFill style={{ backgroundColor: PAL.bg }}>
      {S.map(({ from, dur, C }, i) => (
        <Sequence key={i} from={from * SEC} durationInFrames={dur * SEC}><C /></Sequence>
      ))}
      <Audio src={staticFile("score.wav")} />
    </AbsoluteFill>
  );
};
