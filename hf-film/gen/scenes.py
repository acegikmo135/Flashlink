"""Generates compositions/*.html and index.html for the 11:42 pm film. Run: python3 gen/scenes.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from common import CURSOR, JS_HELPERS, LOGO_GLYPH, board_svg, scene  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "compositions")
os.makedirs(OUT, exist_ok=True)


def write(name, content):
    open(os.path.join(OUT, name + ".html"), "w").write(content)


GRID = """<defs><pattern id="g" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M60 0H0V60" fill="none" stroke="#cfccc5" stroke-width="1"/></pattern></defs>
<rect width="1920" height="1080" fill="#dcd9d2"/><rect width="1920" height="1080" fill="url(#g)"/>"""


def bench_svg(idp, laptop_dark=True):
    return f"""<svg class="abs" style="left:0;top:0" width="1920" height="1080" viewBox="0 0 1920 1080">
  {GRID}
  <g><circle cx="1010" cy="950" r="96" fill="#000" opacity=".14" transform="translate(10 18)"/><circle cx="1010" cy="950" r="92" fill="#f4f1ea" stroke="#cdc8bd" stroke-width="3"/><circle cx="1010" cy="950" r="68" fill="#3a2a20"/><path d="M1100 942 q50 -4 46 38" fill="none" stroke="#f4f1ea" stroke-width="16" stroke-linecap="round"/></g>
  <g>
    <rect x="1230" y="110" width="720" height="420" rx="26" fill="#000" opacity=".16" transform="translate(14 24)"/>
    <rect x="1230" y="100" width="720" height="420" rx="26" fill="#2a2c33"/>
    <rect x="1254" y="124" width="672" height="372" rx="12" fill="#0f1115"/>
    <rect x="1200" y="552" width="780" height="520" rx="30" fill="#000" opacity=".16" transform="translate(14 24)"/>
    <rect x="1200" y="552" width="780" height="520" rx="30" fill="#c5cad2"/>
    {''.join(f'<rect x="{1230 + c * 66}" y="{590 + r * 54}" width="54" height="40" rx="8" fill="#dde1e7"/>' for r in range(4) for c in range(10))}
    <rect x="1410" y="806" width="340" height="40" rx="8" fill="#dde1e7"/>
  </g>
  <path d="M1272 672 C 1360 676, 1290 820, 1204 790" fill="none" stroke="#000" stroke-width="18" stroke-linecap="round" opacity=".18" transform="translate(8 12)"/>
  <path d="M1272 672 C 1360 676, 1290 820, 1204 790" fill="none" stroke="#2a2e36" stroke-width="16" stroke-linecap="round"/>
  <g transform="rotate(-8 190 880)">
    <rect x="70" y="720" width="230" height="440" rx="40" fill="#000" opacity=".2" transform="translate(12 18)"/>
    <rect x="70" y="720" width="230" height="440" rx="40" fill="#0d0e11"/>
    <rect x="80" y="730" width="210" height="420" rx="32" fill="#1c2230"/>
    <text x="185" y="860" font-family="Geist" font-weight="600" font-size="72" fill="#fff" text-anchor="middle" letter-spacing="-2">11:42</text>
    <text x="185" y="908" font-family="Geist" font-weight="500" font-size="30" fill="#aab3c5" text-anchor="middle">PM</text>
    <rect x="100" y="960" width="170" height="64" rx="16" fill="rgba(255,255,255,.12)"/>
    <text x="185" y="1002" font-family="Geist" font-weight="500" font-size="28" fill="#fff" text-anchor="middle">Demo 9:00 AM</text>
  </g>
  <g transform="translate(250 470) scale(1.55) rotate(-4 320 125)"><rect x="8" y="14" width="640" height="250" rx="14" fill="#000" opacity=".25"/>{board_svg(idp)}</g>
</svg>"""


# ------------------------------------------------------------------ 1 bench (hook)
write("bench", scene("bench", """
#world{position:absolute;inset:0;transform-origin:760px 640px}
#t1,#t2{left:120px;top:96px;opacity:0}
#lapcur{position:absolute;left:1280px;top:150px;width:20px;height:40px;background:#cfd6e4;opacity:0}
""", f"""
    <div id="world">{bench_svg('b-')}<div id="lapcur"></div></div>
    <div id="t1" class="title">11:42 pm.</div>
    <div id="t2" class="title">Demo at 9.</div>
""", JS_HELPERS + """
    const w1 = split($('#t1'), 'word');
    tl.set('#t1', { opacity: 1 }, 0.3);
    tl.fromTo(w1, { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: .13, stagger: .067, ease: 'power4.out' }, 0.4);
    tl.to('#t1', { opacity: 0, filter: 'blur(8px)', duration: .15, ease: 'power2.in' }, 1.85);
    tl.fromTo('#t2', { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: .2, ease: 'power4.out' }, 2.05);
    tl.to('#t2', { opacity: 0, filter: 'blur(8px)', duration: .15, ease: 'power2.in' }, 3.85);
    // the world: a slow push toward the dead board, then the camera dives into the laptop screen
    tl.fromTo('#world', { scale: 1 }, { scale: 1.07, duration: 3.9, ease: 'power1.inOut' }, 0);
    tl.set('#world', { transformOrigin: '1590px 310px' }, 4.05);
    tl.to('#world', { scale: 3.3, duration: .8, ease: 'power3.in' }, 4.05);
    tl.set('#lapcur', { opacity: 1 }, 2.2); tl.set('#lapcur', { opacity: 0 }, 2.6); tl.set('#lapcur', { opacity: 1 }, 3.0); tl.set('#lapcur', { opacity: 0 }, 3.4); tl.set('#lapcur', { opacity: 1 }, 3.8);
"""))

# ------------------------------------------------------------------ 2 fail (the old way, in real error strings)
write("fail", scene("fail", """
#w{position:absolute;inset:0;background:#15171c;clip-path:circle(0px at 83% 29%)}
#term{position:absolute;left:120px;top:330px;width:1680px;font-family:"JetBrains Mono",monospace;font-weight:400;font-size:36px;line-height:1.6;color:#d3d9e6;white-space:normal}
#term div{opacity:0;height:76px;white-space:pre}
.err{color:#ff7a7a}
#ft{left:120px;top:100px;color:#fff;opacity:0}
""", """
    <div id="w">
      <div id="ft" class="title">Flashing fails. Again.</div>
      <div id="term">
<div id="l1">$ esptool write-flash 0x10000 firmware.bin</div><div id="l2" class="err">A fatal error occurred: Failed to connect to ESP32.</div><div id="l3">$ avrdude -c arduino -p m328p -P COM5</div><div id="l4" class="err">avrdude: stk500_getsync(): not in sync</div>
      </div>
    </div>
""", JS_HELPERS + """
    tl.fromTo('#w', { clipPath: 'circle(0px at 83% 29%)' }, { clipPath: 'circle(150% at 83% 29%)', duration: .55, ease: 'power3.inOut' }, 0);
    const ft = split($('#ft'), 'word');
    tl.set('#ft', { opacity: 1 }, 0.7);
    tl.fromTo(ft, { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: .13, stagger: .09, ease: 'power4.out' }, 0.75);
    const L = [['#l1', 1.2], ['#l2', 2.1], ['#l3', 3.1], ['#l4', 4.0]];
    L.forEach(([s, t]) => { const el = $(s); const full = el.textContent; const o = { i: 0 };
      tl.set(s, { opacity: 1 }, t);
      tl.fromTo(o, { i: 0 }, { i: full.length, duration: Math.min(.7, full.length / 90), ease: 'none', onUpdate() { el.textContent = full.slice(0, Math.round(o.i)); } }, t); });
    tl.to('#ft', { opacity: 0, filter: 'blur(8px)', duration: .15, ease: 'power2.in' }, 6.4);
"""))

# ------------------------------------------------------------------ 3 reveal (colour flood to the brand blue)
write("reveal", scene("reveal", """
#w{position:absolute;inset:0;background:#007aff;clip-path:circle(0px at 50% 62%)}
#wm{position:absolute;left:130px;top:300px;font-size:270px;color:#fff;white-space:nowrap;line-height:1;letter-spacing:-.04em}
#sub{position:absolute;left:140px;top:640px;font-size:60px;font-weight:500;color:rgba(255,255,255,.92);opacity:0}
""", """
    <div id="w"><div id="wm">MCU Bridge</div><div id="sub">Let your AI flash it.</div></div>
""", JS_HELPERS + """
    tl.fromTo('#w', { clipPath: 'circle(0px at 50% 62%)' }, { clipPath: 'circle(150% at 50% 62%)', duration: .6, ease: 'power2.inOut' }, 0);
    const ch = split($('#wm'), 'char');
    tl.fromTo(ch, { opacity: .3, filter: 'blur(10px)' }, { opacity: 1, filter: 'blur(0px)', duration: .18, stagger: .1, ease: 'power3.out' }, 0.7);
    tl.fromTo('#sub', { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: .25, ease: 'power4.out' }, 2.0);
    // leave on a whip: the next world arrives from the right
    tl.to('#w', { x: -260, opacity: 0, filter: 'blur(18px)', duration: .45, ease: 'power3.in' }, 3.85);
"""))

# ------------------------------------------------------------------ 4 name it (REAL capture of the web app)
CAP = 1440
K1 = 1500 / CAP * 1.8
write("nameit", scene("nameit", f"""
#w{{position:absolute;inset:0;background:#dcd9d2}}
#win{{position:absolute;left:210px;top:330px;width:1500px;height:640px;border-radius:24px;overflow:hidden;background:#fff}}
#vcam{{position:absolute;left:0;top:0;width:{CAP}px;height:900px;transform-origin:0 0}}
#vcam video{{position:absolute;left:0;top:0;width:{CAP}px;height:900px}}
#nt{{left:120px;top:100px;opacity:0}}
""", f"""
    <div id="w">
      <svg class="abs" style="left:0;top:0" width="1920" height="1080">{GRID}</svg>
      <div id="nt" class="title">Name your board.</div>
      <div id="win" class="shadow"><div id="vcam"><video id="nvid" class="clip" src="assets/hero.mp4" data-start="0" data-duration="4.9" data-media-start="0" muted playsinline></video></div></div>
      {CURSOR}
    </div>
""", JS_HELPERS + f"""
    const K = {K1}, CX = 460, CY = 300, W = 1500, H = 640;
    tl.set('#vcam', {{ x: W / 2 - CX * K, y: H / 2 - CY * K, scale: K }}, 0);
    // arrive on a whip from the right
    tl.fromTo('#w', {{ x: 340, opacity: 0, filter: 'blur(18px)' }}, {{ x: 0, opacity: 1, filter: 'blur(0px)', duration: .5, ease: 'expo.out' }}, 0);
    const nt = split($('#nt'), 'word');
    tl.set('#nt', {{ opacity: 1 }}, 0.4);
    tl.fromTo(nt, {{ opacity: 0, filter: 'blur(8px)' }}, {{ opacity: 1, filter: 'blur(0px)', duration: .13, stagger: .1, ease: 'power4.out' }}, 0.5);
    // the cursor enters from off-screen and clicks the board's name at media t=1.0 s (local 1.7 s)
    const nx = 210 + (440 - CX) * K + W / 2 - 750 + 0, ny = 330 + (300 - CY) * K + H / 2 - 320;
    cursorPath('.cursor', [[0.2, 2050, 1180], [0.95, 930, 640]]);
    click('.cursor', 1.0);
    tl.to('.cursor', {{ x: 1180, y: 780, duration: .6, ease: 'power2.inOut' }}, 1.4);
    tl.to('.cursor', {{ opacity: 0, duration: .2 }}, 4.0);
    tl.to('#w', {{ x: -240, opacity: 0, filter: 'blur(18px)', duration: .4, ease: 'power3.in' }}, 4.2);
"""))

# ------------------------------------------------------------------ 5 ask (generic chat world, white)
write("ask", scene("ask", """
#w{position:absolute;inset:0;background:#fff}
#at{left:120px;top:100px;opacity:0}
#panel{position:absolute;left:320px;top:290px;width:1280px;height:620px;border-radius:36px;background:#f2f2f7}
#me{position:absolute;right:340px;top:340px;max-width:900px;background:#007aff;color:#fff;font-size:44px;font-weight:500;padding:26px 40px;border-radius:40px;letter-spacing:-.01em;opacity:0;white-space:nowrap}
#ai{position:absolute;left:360px;top:540px;width:880px;height:290px;border-radius:40px;background:#fff;opacity:0}
#ai p{position:absolute;left:44px;top:34px;font-size:40px;font-weight:500;letter-spacing:-.01em;white-space:nowrap}
#chip{position:absolute;left:36px;top:130px;width:300px;height:58px;border-radius:16px;background:rgba(0,122,255,.14);color:#007aff;font-size:32px;font-weight:600;display:flex;align-items:center;justify-content:center}
#bar{position:absolute;left:44px;top:228px;width:560px;height:12px;border-radius:6px;background:rgba(120,120,128,.2);overflow:hidden}
#bar i{display:block;height:100%;width:100%;background:#007aff;transform-origin:0 50%;transform:scaleX(0)}
#flood{position:absolute;left:396px;top:670px;width:300px;height:58px;border-radius:16px;background:#007aff;opacity:0}
""", """
    <div id="w">
      <div id="at" class="title">Then just ask.</div>
      <div id="panel"></div>
      <div id="me"><span id="mt"></span></div>
      <div id="ai"><p>Compiling for your ESP32, then flashing it.</p><div id="chip">build_and_flash</div><div id="bar"><i></i></div></div>
      <div id="flood"></div>
    </div>
""", JS_HELPERS + """
    tl.fromTo('#w', { clipPath: 'circle(0px at 50% 100%)' }, { clipPath: 'circle(150% at 50% 100%)', duration: .5, ease: 'power3.inOut' }, 0);
    const at = split($('#at'), 'char');
    tl.set('#at', { opacity: 1 }, 0.4);
    tl.fromTo(at, { opacity: .3, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0px)', duration: .15, stagger: .04, ease: 'power3.out' }, 0.5);
    tl.fromTo('#panel', { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: .6, ease: 'expo.out' }, 0.5);
    tl.set('#me', { opacity: 1 }, 1.2);
    typeTo($('#mt'), 'Flash blink to Desk ESP32', 1.2, 1.5);
    tl.fromTo('#ai', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: .5, ease: 'expo.out' }, 3.0);
    tl.fromTo('#chip', { scale: .8 }, { scale: 1, duration: .5, ease: 'back.out(1.4)' }, 3.4);
    tl.fromTo('#bar i', { scaleX: 0 }, { scaleX: 1, duration: 1.6, ease: 'power1.inOut' }, 3.7);
    // the chip becomes the next world: it grows past the frame (zoom through)
    tl.set('#flood', { opacity: 1 }, 5.35);
    tl.fromTo('#flood', { scale: 1 }, { scale: 42, duration: .65, ease: 'power3.in', transformOrigin: '50% 50%' }, 5.35);
"""))

# ------------------------------------------------------------------ 6 compile (REAL compile_firmware response, rebuilt as DOM)
CHK = '<svg viewBox="0 0 24 24" width="40" height="40"><circle cx="12" cy="12" r="12" fill="#34c759"/><path class="ck" d="M6.5 12.5l3.8 3.8 7.2-7.6" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/></svg>'


def card(rows, rowh=88):
    h = len(rows) * rowh + 56
    inner = "".join(
        f'<div class="row" style="height:{rowh}px"><span class="k">{k}</span><span class="v">{v}</span></div>' for k, v in rows
    )
    return h, f'<div id="card" class="shadow" style="position:absolute;left:0;top:0;width:1160px;height:{h}px;border-radius:28px;background:#fff;padding:28px 52px">{inner}</div>'


CARD_CSS = """
.row{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(60,60,67,.16);font-size:36px;opacity:0}
.row:last-child{border-bottom:none}
.k{color:rgba(60,60,67,.6);font-weight:500}.v{font-weight:600;display:flex;align-items:center;gap:16px;font-variant-numeric:tabular-nums}
"""
rows_c = [("tool", "compile_firmware"), ("board", "esp32-wroom-32"), ("libraries", "Adafruit NeoPixel"), ("size", "6,264 bytes"), ("sha-256", "6094da1f97dd7519…"), ("status", f'<span style="color:#34c759">ok</span>{CHK}')]
hc, cardc = card(rows_c)
write("compile", scene("compile", CARD_CSS + f"""
#w{{position:absolute;inset:0;background:#007aff}}
#ct{{left:120px;top:100px;color:#fff;opacity:0}}
#cw{{position:absolute;left:560px;top:330px;width:1160px;height:{hc}px}}
.ck{{stroke-dasharray:1;stroke-dashoffset:1}}
""", f"""
    <div id="w"><div id="ct" class="title">Compiled in the cloud.</div><div id="cw">{cardc}</div></div>
""", JS_HELPERS + """
    const ct = split($('#ct'), 'word');
    tl.set('#ct', { opacity: 1 }, 0.3);
    tl.fromTo(ct, { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: .13, stagger: .09, ease: 'power4.out' }, 0.35);
    tl.fromTo('#card', { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: .6, ease: 'expo.out' }, 0.45);
    $$('.row').forEach((r, i) => tl.fromTo(r, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .3, ease: 'power3.out' }, 0.9 + i * .38));
    tl.to('.ck', { strokeDashoffset: 0, duration: .35, ease: 'power2.out' }, 3.2);
    tl.to('#cw', { opacity: 0, filter: 'blur(10px)', duration: .2, ease: 'power2.in' }, 4.55);
    tl.to('#ct', { opacity: 0, filter: 'blur(8px)', duration: .15 }, 4.6);
"""))

# ------------------------------------------------------------------ 7 libraries (same blue ground — blur swap)
libs = [("Adafruit NeoPixel", "latest"), ("DHT sensor library", "@1.4.6"), ("ArduinoJson", "@7.0.4")]
rows_l = [(n, f'<span style="color:rgba(60,60,67,.6);font-weight:500">{v}</span>{CHK}') for n, v in libs]
hl, cardl = card(rows_l, 104)
write("libs", scene("libs", CARD_CSS + f"""
#w{{position:absolute;inset:0;background:#007aff}}
#lt{{left:120px;top:100px;color:#fff;opacity:0}}
#lw{{position:absolute;left:140px;top:330px;width:1160px;height:{hl}px}}
#lc{{position:absolute;left:140px;top:{330 + hl + 44}px;font-size:44px;font-weight:500;color:rgba(255,255,255,.92);opacity:0;white-space:nowrap}}
.ck{{stroke-dasharray:1;stroke-dashoffset:1}}
.k{{color:#111!important;font-weight:600!important}}
""", f"""
    <div id="w"><div id="lt" class="title">Any library you need.</div><div id="lw">{cardl}</div><div id="lc">Pin a version and a rebuild stays identical.</div></div>
""", JS_HELPERS + """
    tl.fromTo('#lt', { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: .2, ease: 'power4.out' }, 0.15);
    tl.fromTo('#card', { x: 60, opacity: 0, filter: 'blur(12px)' }, { x: 0, opacity: 1, filter: 'blur(0px)', duration: .5, ease: 'expo.out' }, 0.2);
    $$('.row').forEach((r, i) => tl.fromTo(r, { opacity: 0, x: 18 }, { opacity: 1, x: 0, duration: .3, ease: 'power3.out' }, 0.6 + i * .3));
    $$('.ck').forEach((c, i) => tl.to(c, { strokeDashoffset: 0, duration: .3, ease: 'power2.out' }, 1.1 + i * .3));
    tl.fromTo('#lc', { opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0px)', duration: .3, ease: 'power3.out' }, 1.9);
    tl.to(['#lw', '#lt', '#lc'], { opacity: 0, filter: 'blur(10px)', duration: .2, ease: 'power2.in' }, 4.4);
"""))

# ------------------------------------------------------------------ 8 flash map (REAL ESP32 flash layout)
parts = [("bootloader.bin", 0x1000, 17104, "#af52de", "17,104 B"), ("partitions.bin", 0x8000, 3072, "#ff9500", "3,072 B"), ("boot_app0.bin", 0xE000, 8192, "#34c759", "8,192 B"), ("firmware.bin", 0x10000, 0x140000, "#007aff", "your app")]
TOT = 0x150000
SW = 1500
strip = "".join(
    f'<div class="seg" data-i="{i}" style="position:absolute;left:{a / TOT * SW:.1f}px;top:0;width:{max(s / TOT * SW * (0.92 if i == 3 else 1), 6):.1f}px;height:70px;background:{c}"></div>'
    for i, (n, a, s, c, l) in enumerate(parts)
)
prow = "".join(
    f'<div class="prow" style="height:84px"><span class="dot" style="background:{c}"></span><span class="nm">{n}</span><span class="ad">0x{a:x}</span><span class="sz">{l}</span></div>'
    for n, a, s, c, l in parts
)
write("flashmap", scene("flashmap", f"""
#w{{position:absolute;inset:0;background:#dcd9d2;clip-path:circle(0px at 50% 50%)}}
#ft2{{left:120px;top:100px;opacity:0}}
#strip{{position:absolute;left:210px;top:330px;width:{SW}px;height:70px;border-radius:16px;background:rgba(120,120,128,.22);overflow:hidden}}
.seg{{transform-origin:0 50%;transform:scaleX(0)}}
#ends{{position:absolute;left:210px;top:410px;width:{SW}px;font-size:30px;font-weight:500;color:rgba(60,60,67,.7);display:flex;justify-content:space-between}}
#tbl{{position:absolute;left:210px;top:490px;width:1500px;height:{4 * 84 + 56}px;border-radius:28px;background:#fff;padding:28px 56px}}
.prow{{display:flex;align-items:center;border-bottom:1px solid rgba(60,60,67,.16);font-size:36px;opacity:0}}
.prow:last-child{{border-bottom:none}}
.dot{{width:20px;height:20px;border-radius:10px;margin-right:26px}}
.nm{{flex:1;font-weight:600}}.ad{{width:260px;color:rgba(60,60,67,.6);font-weight:500;font-variant-numeric:tabular-nums}}.sz{{width:240px;text-align:right;color:rgba(60,60,67,.6);font-weight:500;font-variant-numeric:tabular-nums}}
""", f"""
    <div id="w">
      <svg class="abs" style="left:0;top:0" width="1920" height="1080">{GRID}</svg>
      <div id="ft2" class="title">Even a blank ESP32 boots.</div>
      <div id="strip">{strip}</div>
      <div id="ends"><span>0x0</span><span>0x150000</span></div>
      <div id="tbl" class="shadow">{prow}</div>
    </div>
""", JS_HELPERS + """
    tl.fromTo('#w', { clipPath: 'circle(0px at 50% 50%)' }, { clipPath: 'circle(150% at 50% 50%)', duration: .55, ease: 'power2.inOut' }, 0);
    const t = split($('#ft2'), 'word');
    tl.set('#ft2', { opacity: 1 }, 0.4);
    tl.fromTo(t, { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: .13, stagger: .09, ease: 'power4.out' }, 0.45);
    $$('.seg').forEach((s, i) => tl.fromTo(s, { scaleX: 0 }, { scaleX: 1, duration: .5, ease: 'power3.out' }, 1.0 + i * .45));
    $$('.prow').forEach((r, i) => tl.fromTo(r, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .3, ease: 'power3.out' }, 1.15 + i * .45));
    tl.to('#w', { opacity: 0, filter: 'blur(10px)', duration: .22, ease: 'power2.in' }, 5.3);
"""))

# ------------------------------------------------------------------ 9 flash + verify (REAL capture: flashing → ready → Activity)
K2 = 1500 / CAP * 1.9
K0 = 1500 / CAP
write("flash", scene("flash", f"""
#w{{position:absolute;inset:0;background:#dcd9d2}}
#win{{position:absolute;left:210px;top:330px;width:1500px;height:640px;border-radius:24px;overflow:hidden;background:#fff}}
#vcam{{position:absolute;left:0;top:0;width:{CAP}px;height:900px;transform-origin:0 0}}
#vcam video{{position:absolute;left:0;top:0;width:{CAP}px;height:900px}}
#s1t,#s2t{{left:120px;top:100px;opacity:0}}
#ck{{position:absolute;left:960px;top:540px;width:200px;height:200px;margin:-100px 0 0 -100px;border-radius:100px;background:#34c759;opacity:0;display:grid;place-items:center}}
""", f"""
    <div id="w">
      <svg class="abs" style="left:0;top:0" width="1920" height="1080">{GRID}</svg>
      <div id="s1t" class="title">Streamed to your PC.</div>
      <div id="s2t" class="title">Verified, never assumed.</div>
      <div id="win" class="shadow"><div id="vcam"><video id="fvid" class="clip" src="assets/hero.mp4" data-start="0" data-duration="5.1" data-media-start="3.4" muted playsinline></video></div></div>
      {CURSOR}
      <div id="ck"><svg viewBox="0 0 24 24" width="120" height="120"><path d="M6.5 12.5l3.8 3.8 7.2-7.6" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    </div>
""", JS_HELPERS + f"""
    const W = 1500, H = 640, K1 = {K2}, K0 = {K0};
    tl.set('#vcam', {{ x: W / 2 - 640 * K1, y: H / 2 - 300 * K1, scale: K1 }}, 0);
    tl.fromTo('#w', {{ x: 300, opacity: 0, filter: 'blur(18px)' }}, {{ x: 0, opacity: 1, filter: 'blur(0px)', duration: .5, ease: 'expo.out' }}, 0);
    const a = split($('#s1t'), 'word');
    tl.set('#s1t', {{ opacity: 1 }}, 0.35);
    tl.fromTo(a, {{ opacity: 0, filter: 'blur(8px)' }}, {{ opacity: 1, filter: 'blur(0px)', duration: .13, stagger: .1, ease: 'power4.out' }}, 0.4);
    // pull back to the whole window so the cursor can reach the sidebar
    tl.to('#vcam', {{ x: 0, y: 0, scale: K0, duration: .55, ease: 'power2.inOut' }}, 2.1);
    tl.to('#s1t', {{ opacity: 0, filter: 'blur(8px)', duration: .15, ease: 'power2.in' }}, 2.5);
    // the cursor clicks "Activity" at media t=6.4 s (local 3.0 s): the capture navigates on that frame
    cursorPath('.cursor', [[2.0, 1900, 1100], [2.95, 345, 545]]);
    click('.cursor', 3.0);
    tl.to('.cursor', {{ opacity: 0, duration: .2 }}, 3.5);
    tl.to('#vcam', {{ x: W / 2 - 860 * {K2 * 1.05}, y: H / 2 - 262 * {K2 * 1.05}, scale: {K2 * 1.05}, duration: .6, ease: 'power2.inOut' }}, 3.2);
    tl.fromTo('#s2t', {{ opacity: 0, filter: 'blur(8px)' }}, {{ opacity: 1, filter: 'blur(0px)', duration: .2, ease: 'power4.out' }}, 3.4);
    // the check grows through the frame (zoom through) into the bench
    tl.set('#ck', {{ opacity: 1 }}, 5.35);
    tl.fromTo('#ck', {{ scale: .3 }}, {{ scale: 14, duration: .8, ease: 'power3.in' }}, 5.35);
"""))

# ------------------------------------------------------------------ 10 payoff (the bench again; the LED blinks on the beat)
write("payoff", scene("payoff", """
#world{position:absolute;inset:0;transform-origin:1087px 673px}
#pool{position:absolute;left:1087px;top:673px;width:300px;height:300px;margin:-150px 0 0 -150px;border-radius:50%;background:radial-gradient(circle,rgba(74,163,255,.55) 0%,rgba(74,163,255,.18) 45%,rgba(74,163,255,0) 70%);opacity:0}
#lit{position:absolute;left:0;top:0;opacity:0}
#pt{left:120px;top:100px;opacity:0}
#dip{position:absolute;inset:0;background:#000;opacity:0}
#flood2{position:absolute;inset:0;background:#34c759;clip-path:circle(150% at 50% 50%)}
""", f"""
    <div id="world">{bench_svg('p-')}<div id="pool"></div><svg id="lit" width="1920" height="1080" viewBox="0 0 1920 1080"><g transform="translate(250 470) scale(1.55) rotate(-4 320 125)"><rect x="522" y="134" width="34" height="24" rx="4" fill="#4aa3ff"/><rect x="528" y="140" width="22" height="12" rx="3" fill="#dff0ff"/></g></svg></div>
    <div id="pt" class="title">It blinks.</div>
    <div id="flood2"></div>
    <div id="dip"></div>
""", JS_HELPERS + """
    // enter: the green of the check iris-closes onto the bench
    tl.fromTo('#flood2', { clipPath: 'circle(150% at 50% 50%)' }, { clipPath: 'circle(0% at 50% 50%)', duration: .55, ease: 'power3.out' }, 0);
    tl.fromTo('#world', { scale: 2.6 }, { scale: 2.45, duration: 2.6, ease: 'power1.out' }, 0);
    // blink on the beat: 120 bpm → one beat = 0.5 s; on for 0.25 s, from 2.4 s
    for (let i = 0; i < 9; i++) { const t = 2.4 + i * 0.5;
      tl.set(['#lit', '#pool'], { opacity: 1 }, t); tl.set(['#lit', '#pool'], { opacity: 0 }, t + .25); }
    tl.fromTo('#pt', { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: .2, ease: 'power4.out' }, 5.3);
    tl.to('#world', { scale: 1.0, duration: 1.0, ease: 'power2.inOut' }, 4.4);
    tl.to('#pt', { opacity: 0, filter: 'blur(8px)', duration: .15 }, 6.9);
    tl.to('#dip', { opacity: .4, duration: .1 }, 7.1);
"""))

# ------------------------------------------------------------------ 11 claim
write("claim", scene("claim", """
#w{position:absolute;inset:0;background:#fff}
#cl{left:130px;top:400px;font-size:116px;white-space:nowrap}
#cl span{display:inline-block;color:#b9b7b0}
""", """
    <div id="w"><div id="cl" class="title">Your AI, hands on hardware.</div></div>
""", JS_HELPERS + """
    const w = split($('#cl'), 'word');
    tl.set(w, { color: '#b9b7b0' }, 0);
    w.forEach((s, i) => tl.to(s, { color: '#111111', duration: .09, ease: 'none' }, 0.15 + i * .1));
    tl.to('#cl', { opacity: 0, filter: 'blur(8px)', duration: .2, ease: 'power2.in' }, 3.1);
"""))

# ------------------------------------------------------------------ 12 end card: the cursor clicks the mark, a fill rises through it
write("endcard", scene("endcard", """
#w{position:absolute;inset:0;background:#fff}
#tile{position:absolute;left:330px;top:250px;width:290px;height:290px;border-radius:64px;border:6px solid #d3d3d8;overflow:hidden}
#fill{position:absolute;inset:0;background:#007aff;transform-origin:50% 100%;transform:scaleY(0)}
#glyph{position:absolute;left:0;top:0}
.gl path,.gl rect{stroke-dasharray:1;stroke-dashoffset:1}
#wmk{position:absolute;left:690px;top:305px;font-size:170px;line-height:1;white-space:nowrap;clip-path:inset(0 100% 0 0)}
#cta{position:absolute;left:330px;top:640px;width:900px;height:120px;border-radius:60px;background:#007aff;color:#fff;font-size:46px;font-weight:600;display:flex;align-items:center;justify-content:center;opacity:0}
#url{position:absolute;left:336px;top:800px;font-size:40px;font-weight:500;color:rgba(60,60,67,.7);opacity:0;white-space:nowrap}
""", f"""
    <div id="w">
      <div id="tile"><div id="fill"></div><svg id="glyph" viewBox="0 0 64 64" width="290" height="290"><g class="gl" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="14" width="36" height="36" rx="7" pathLength="1"/><path d="M24 8v6M32 8v6M40 8v6M24 50v6M32 50v6M40 50v6M8 24h6M8 32h6M8 40h6M50 24h6M50 32h6M50 40h6" stroke-width="3" pathLength="1"/><path d="M25 39a5 5 0 0 1-.6-9.9 7.5 7.5 0 0 1 14.2 1.3A4.3 4.3 0 0 1 38 39z" stroke-width="3" pathLength="1"/></g></svg></div>
      <div id="wmk">MCU Bridge</div>
      <div id="cta">Add it to your AI as a connector</div>
      <div id="url">mcu-bridge.manthankansagra.workers.dev</div>
      {CURSOR}
    </div>
""", JS_HELPERS + """
    cursorPath('.cursor', [[0.2, 2000, 900], [1.5, 520, 380]]);
    click('.cursor', 1.6);
    tl.fromTo('#fill', { scaleY: 0 }, { scaleY: 1, duration: .55, ease: 'power3.inOut' }, 1.62);
    tl.to('.gl path, .gl rect', { strokeDashoffset: 0, duration: .6, ease: 'power2.out', stagger: .08 }, 1.95);
    tl.to('.cursor', { x: 1500, y: 820, opacity: 0, duration: .7, ease: 'power2.in' }, 2.2);
    tl.to('#wmk', { clipPath: 'inset(0 0% 0 0)', duration: .7, ease: 'power3.out' }, 2.6);
    tl.fromTo('#cta', { opacity: 0, y: 24, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: .45, ease: 'expo.out' }, 3.9);
    tl.fromTo('#url', { opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0px)', duration: .35, ease: 'power3.out' }, 4.3);
"""))

# ------------------------------------------------------------------ index.html (root)
HOSTS = [
    ("bench", 0, 5.6), ("fail", 4.6, 6.8), ("reveal", 10.8, 4.4), ("nameit", 14.6, 5.0), ("ask", 19.0, 6.6), ("compile", 25.0, 5.6),
    ("libs", 30.0, 4.6), ("flashmap", 34.0, 5.6), ("flash", 39.0, 6.4), ("payoff", 44.6, 7.6), ("claim", 51.8, 3.6), ("endcard", 55.0, 8.0),
]
DUR = 63
hosts = "\n".join(
    f'      <div id="{i}" class="clip" data-composition-id="{i}" data-composition-src="compositions/{i}.html" data-start="{s}" data-duration="{d}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080" style="z-index:{n + 1}"></div>'
    for n, (i, s, d) in enumerate(HOSTS)
)
open(os.path.join(os.path.dirname(__file__), "..", "index.html"), "w").write(f"""<!doctype html>
<html lang="en" data-composition-variables='[{{"id":"color-ground","type":"color","label":"Bench ground","default":"#dcd9d2"}},{{"id":"color-ink","type":"color","label":"Ink","default":"#111111"}},{{"id":"color-accent","type":"color","label":"Accent","default":"#007aff"}},{{"id":"font-display","type":"string","label":"Display font","default":"Geist"}}]'>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      :root {{ --color-ground:#dcd9d2; --color-ink:#111111; --color-accent:#007aff; --font-display:Geist; }}
      * {{ margin:0; padding:0; box-sizing:border-box; }}
      html, body {{ width:1920px; height:1080px; overflow:hidden; background:var(--color-ground); }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{DUR}" data-width="1920" data-height="1080">
{hosts}
      <audio id="mix" class="clip" src="assets/audio/mix.wav" data-start="0" data-duration="{DUR}" data-track-index="2" data-volume="1"></audio>
    </div>
    <script>
      window.__timelines = window.__timelines || {{}};
      window.__timelines["main"] = gsap.timeline({{ paused: true }});
    </script>
  </body>
</html>
""")
print("generated", len(HOSTS), "scenes")
