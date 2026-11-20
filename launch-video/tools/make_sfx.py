"""Synthesise the film's sound effects (no samples, no voice) from a cue list -> 44.1 kHz stereo wav.

usage: python tools/make_sfx.py out/sfx.json out/sfx.wav
Cue types: pad tick pop whoosh riser stream draw chime ding blink impact sparkle shimmer
(plus 'click', 'thud', 'sweep' used by other films). Everything is synthesised with numpy and is deterministic (seeded RNG).
"""
import json
import sys
import wave

import numpy as np
from numpy.fft import irfft, rfft, rfftfreq

SR = 44100
rng = np.random.default_rng(7)
src = sys.argv[1] if len(sys.argv) > 1 else "out/sfx.json"
dst = sys.argv[2] if len(sys.argv) > 2 else "out/sfx.wav"
cfg = json.load(open(src))
N = int((cfg["dur"] + 2.0) * SR)
L = np.zeros(N)
R = np.zeros(N)


def t_(d):
    return np.arange(int(d * SR)) / SR


def env(n, a=.005, r=.2, curve=3.0):
    e = np.ones(n)
    na = max(1, int(a * SR))
    e[:na] = np.linspace(0, 1, na)
    nr = min(n, int(r * SR))
    e[n - nr:] *= np.linspace(1, 0, nr) ** curve
    return e


def lp_fast(x, fc):
    X = rfft(x)
    f = rfftfreq(len(x), 1 / SR)
    X *= 1 / (1 + (f / fc) ** 4)
    return irfft(X, len(x))


def band(x, lo, hi):
    X = rfft(x)
    f = rfftfreq(len(x), 1 / SR)
    X[(f < lo) | (f > hi)] = 0
    return irfft(X, len(x))


def put(sig, t, pan=0.0, gain=1.0):
    i = int(t * SR)
    n = min(len(sig), N - i)
    if n <= 0 or i < 0:
        return
    l_ = gain * np.cos((pan + 1) * np.pi / 4)
    r_ = gain * np.sin((pan + 1) * np.pi / 4)
    L[i:i + n] += sig[:n] * l_
    R[i:i + n] += sig[:n] * r_


def sine(f, d):
    n = int(d * SR)
    ph = np.cumsum(np.full(n, f) if np.ndim(f) == 0 else f) / SR
    return np.sin(2 * np.pi * ph)


_IR = {}


def reverb(sig, mix=.3, tail=1.2):
    key = round(tail, 2)
    if key not in _IR:
        n = int(tail * SR)
        ir = rng.standard_normal(n) * np.exp(-np.linspace(0, 7, n))
        _IR[key] = lp_fast(ir, 3500)
    ir = _IR[key]
    n = len(sig) + len(ir)
    o = irfft(rfft(sig, n) * rfft(ir, n), n)
    o /= np.max(np.abs(o)) + 1e-9
    out = np.zeros(n)
    out[:len(sig)] += sig * (1 - mix)
    out += o * mix * (np.max(np.abs(sig)) + 1e-9)
    return out


def pad(t, dur):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    s = sum(np.sin(2 * np.pi * f * tt + p) * a for f, p, a in [(55, 0, .5), (82.4, 1, .35), (110.2, 2, .2), (164.8, 3, .12)])
    s *= .6 + .4 * np.sin(2 * np.pi * tt / 9.0 - 1.2)
    e = np.minimum(1, tt / 3) * np.minimum(1, (dur - tt) / 2.5)
    put(s * e * .12, t, 0, 1)


def tick(t, v=0, hi=0):
    f = [2100, 2600, 1800][v % 3] * (1.6 if hi else 1)
    n = int(.03 * SR)
    x = sine(f, .03) * env(n, .001, .028, 2) + rng.standard_normal(n) * env(n, .0005, .01, 3) * .5
    put(x * .16, t, rng.uniform(-.25, .25))


def pop(t, hi=0):
    d = .16
    f = np.linspace(520, 880, int(d * SR)) * (1.25 if hi else 1)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(int(d * SR), .004, .15, 2)
    put(reverb(x, .22, .5) * .32, t, .05)


def whoosh(t, dur):
    n = int(dur * SR)
    x = rng.standard_normal(n)
    tt = np.arange(n) / SR
    out = np.zeros(n)
    for fc0, fc1, a in [(300, 5500, .8), (120, 1800, .5)]:
        fc = np.linspace(fc0, fc1, n)
        blk = 2048
        for i in range(0, n, blk):
            c = fc[min(i, n - 1)]
            out[i:i + blk] += a * band(x[i:i + blk], c * .6, c * 1.5)
    x = out * np.sin(np.pi * np.clip(tt / dur, 0, 1)) ** 1.6
    i = int(t * SR)
    m = min(n, N - i)
    L[i:i + m] += (x * np.linspace(1, .4, n))[:m] * .55
    R[i:i + m] += (x * np.linspace(.4, 1, n))[:m] * .55


def riser(t, dur, lo=180, hi=900, amp=.35):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    f = np.geomspace(lo, hi, n)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) + .5 * np.sin(2 * np.pi * np.cumsum(f * 2.01) / SR)
    x += rng.standard_normal(n) * .25 * (tt / dur)
    x *= (tt / dur) ** 2.2 * np.minimum(1, (dur - tt) / .05)
    put(x * amp * .45, t, 0)


def stream(t, dur):
    n = int(dur * SR)
    x = np.zeros(n)
    k = int(dur * 38)
    for j in range(k):
        u = j / k
        at = int(u * (n - 2000))
        f = 900 + 2600 * u * rng.uniform(.6, 1.3)
        g = sine(f, .018) * env(int(.018 * SR), .001, .016, 2) * (.4 + .6 * u)
        x[at:at + len(g)] += g
    put(x * .2, t, 0)


def draw(t, dur):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    x = np.sin(2 * np.pi * np.cumsum(np.geomspace(300, 1400, n)) / SR) * .25 * np.sin(np.pi * tt / dur)
    put(reverb(x, .35, 1.0) * .5, t, 0)


def bell(f, d, gain):
    tt = t_(d)
    x = np.zeros_like(tt)
    for k, a, dec in [(1, 1, 3.2), (2.76, .35, 4.5), (5.4, .15, 7)]:
        x += a * np.sin(2 * np.pi * f * k * tt) * np.exp(-dec * tt)
    return x * gain * env(len(tt), .002, .1, 1)


def chime(t):
    for i, f in enumerate([784, 988, 1175, 1568]):
        put(reverb(bell(f, 1.3, .3), .35, 1.4), t + i * .075, -.2 + i * .13)


def ding(t, hi=0):
    f = 1318 if hi else 1046
    put(reverb(bell(f, 1.2, .38) + bell(f * 1.5, 1.2, .16), .3, 1.2), t, 0)


def blink(t, v):
    f = 440 * 2 ** ([0, 2, 4, 7][v % 4] / 12)
    put(reverb(bell(f, .7, .3), .25, .9), t, .1)
    put(sine(f / 4, .35) * env(int(.35 * SR), .003, .3, 2.2) * .35, t)
    put(rng.standard_normal(int(.012 * SR)) * env(int(.012 * SR), .0005, .01, 2) * .3, t)


def impact(t):
    n = int(2.4 * SR)
    tt = np.arange(n) / SR
    f = 120 * np.exp(-tt * 1.8) + 32
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 2.1)
    nz = lp_fast(rng.standard_normal(n), 2600) * np.exp(-tt * 3.5) * .6
    put(reverb((x + nz) * .9, .3, 1.8), t, 0)


def sparkle(t):
    for i in range(14):
        f = rng.choice([1568, 1976, 2349, 2637, 3136, 3951])
        put(reverb(bell(f, .6, .13), .4, 1.2), t + i * .045 + rng.uniform(0, .02), rng.uniform(-.7, .7))


def shimmer(t):
    n = int(2.2 * SR)
    tt = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * f * tt) * a for f, a in [(523.3, .3), (659.3, .25), (784, .22), (1046.5, .12)]) * np.sin(np.pi * np.clip(tt / 2.2, 0, 1)) ** 2
    put(reverb(x * .22, .4, 1.6), t, 0)


def click(t, v=0):
    n = int(.02 * SR)
    x = (sine(3000 + 400 * (v % 3), .02) * .5 + rng.standard_normal(n) * .5) * env(n, .0005, .018, 2)
    put(x * .22, t, rng.uniform(-.3, .3))


def thud(t, amp=1.0):
    n = int(.6 * SR)
    tt = np.arange(n) / SR
    x = np.sin(2 * np.pi * np.cumsum(90 * np.exp(-tt * 9) + 38) / SR) * np.exp(-tt * 7)
    put(x * .7 * amp, t, 0)


def sweep(t, dur, lo=400, hi=3000, amp=.3):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    x = np.sin(2 * np.pi * np.cumsum(np.geomspace(lo, hi, n)) / SR) * np.sin(np.pi * np.clip(tt / dur, 0, 1)) ** 2
    put(reverb(x * amp, .3, 1.0), t, 0)


FN = dict(
    pad=lambda c: pad(c["t"], c["dur"]), tick=lambda c: tick(c["t"], c.get("v", 0), c.get("hi", 0)), pop=lambda c: pop(c["t"], c.get("hi", 0)),
    whoosh=lambda c: whoosh(c["t"], c["dur"]), riser=lambda c: riser(c["t"], c["dur"], c.get("lo", 180), c.get("hi", 900), c.get("amp", .35)),
    stream=lambda c: stream(c["t"], c["dur"]), draw=lambda c: draw(c["t"], c["dur"]), chime=lambda c: chime(c["t"]), ding=lambda c: ding(c["t"], c.get("hi", 0)),
    blink=lambda c: blink(c["t"], c.get("v", 0)), impact=lambda c: impact(c["t"]), sparkle=lambda c: sparkle(c["t"]), shimmer=lambda c: shimmer(c["t"]),
    click=lambda c: click(c["t"], c.get("v", 0)), thud=lambda c: thud(c["t"], c.get("amp", 1.0)), sweep=lambda c: sweep(c["t"], c["dur"], c.get("lo", 400), c.get("hi", 3000), c.get("amp", .3)),
)
for c in cfg["cues"]:
    if c["type"] in FN:
        FN[c["type"]](c)
    else:
        print("unknown cue", c["type"])

out = np.stack([L, R], 1)
out = np.tanh(out * 1.15)  # gentle glue limiter
fade = np.ones(N)
fade[-int(1.2 * SR):] = np.linspace(1, 0, int(1.2 * SR))
out *= fade[:, None]
out = out / (np.max(np.abs(out)) + 1e-9) * .89
with wave.open(dst, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((out * 32767).astype("<i2").tobytes())
print("wrote", dst, f"{N / SR:.1f}s")
