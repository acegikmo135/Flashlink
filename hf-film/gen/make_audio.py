"""Sound for the 11:42 pm film -> assets/audio/mix.wav (44.1 kHz stereo, 63 s).
Plan (SPEC): near silence while the old way fails; a minimal piano bed (120 bpm) enters with the product at 10.8 s and
holds back for the payoff (riser into ONE impact, then a tick per blink); soft key ticks on typing, a soft click on every
real cursor click, a whoosh on each seam, a pop on landing chips. No chimes/dings/synth tones. Deterministic (seeded)."""
import wave

import numpy as np
from numpy.fft import irfft, rfft, rfftfreq

SR = 44100
DUR = 63
N = int((DUR + 1) * SR)
rng = np.random.default_rng(42)
L = np.zeros(N)
R = np.zeros(N)
BED = np.zeros(N)


def midi(n):
    return 440 * 2 ** ((n - 69) / 12)


def lp(x, fc, order=2):
    X = rfft(x)
    f = rfftfreq(len(x), 1 / SR)
    return irfft(X / (1 + (f / fc) ** (2 * order)), len(x))


def hp(x, fc):
    return x - lp(x, fc, 1)


def put(sig, t, pan=0.0, gain=1.0, bus=None):
    i = int(t * SR)
    n = min(len(sig), N - i)
    if n <= 0 or i < 0:
        return
    if bus is not None:
        bus[i:i + n] += sig[:n] * gain
        return
    L[i:i + n] += sig[:n] * gain * np.cos((pan + 1) * np.pi / 4)
    R[i:i + n] += sig[:n] * gain * np.sin((pan + 1) * np.pi / 4)


def piano(n, d=2.6, vel=.6, bright=1.0):
    t = np.arange(int(d * SR)) / SR
    f = midi(n)
    x = np.zeros_like(t)
    for k, a, dec in [(1, 1.0, 1.2), (2, .55, 1.7), (3, .32, 2.3), (4, .2, 3.1), (5, .1, 4.2), (6, .06, 5.2)]:
        x += a * np.sin(2 * np.pi * f * k * (1 + k * k * 4e-5) * t + k) * np.exp(-dec * t * (1 + f / 800 * .6))
    x += rng.standard_normal(len(t)) * np.exp(-t * 90) * .05
    return lp(x * np.minimum(1, t / .003) * vel, 2600 * bright + 500)


# ------------------------------------------------------------------ the bed: C | Am | F | G, 2 s per bar, from 10.8 s
BARS = [([48, 55], [64, 67, 71, 72, 71, 67, 64, 67]), ([45, 52], [64, 67, 69, 72, 69, 67, 64, 67]),
        ([41, 48], [65, 67, 69, 72, 69, 67, 65, 67]), ([43, 50], [62, 67, 71, 74, 71, 67, 62, 67])]


def level(t):  # how much of the bed is present (the film's emotional curve)
    if t < 10.8:
        return 0.0
    if t < 15:
        return .45 + (t - 10.8) * .05
    if t < 44.6:
        return min(.95, .65 + (t - 15) * .012)
    if t < 47.0:
        return .12                      # hold back for the payoff
    if t < 51.5:
        return .08                      # the blinks play almost alone
    if t < 55.0:
        return .85
    return .8


t0 = 10.8
b = 0
while t0 < 62:
    bass, arp = BARS[b % 4]
    for j, nb in enumerate(bass):
        put(piano(nb, 4.0, .5 * level(t0), .6), t0 + j * .02, bus=BED)
    if t0 >= 12.8:
        for k, nb in enumerate(arp):
            tt = t0 + k * .25
            put(piano(nb, 2.0, (.30 + .1 * (k % 2 == 0)) * level(tt), 1.0), tt, bus=BED)
    t0 += 2.0
    b += 1


def reverb(sig, mix=.35, tail=2.4):
    n = int(tail * SR)
    ir = lp(rng.standard_normal(n) * np.exp(-np.linspace(0, 6.5, n)), 3000)
    m = len(sig) + len(ir)
    o = irfft(rfft(sig, m) * rfft(ir, m), m)[: len(sig)]
    o /= np.max(np.abs(o)) + 1e-9
    return sig * (1 - mix) + o * mix * (np.max(np.abs(sig)) + 1e-9)


bed = reverb(BED[: int(DUR * SR)])
fade_in = np.clip((np.arange(len(bed)) / SR - 10.8) / .4, 0, 1)
bed *= fade_in
L[: len(bed)] += bed * .95
R[: len(bed)] += bed * .95


# ------------------------------------------------------------------ effects (each has a cause on screen)
def click(t, g=1.0):
    n = int(.045 * SR)
    tt = np.arange(n) / SR
    x = lp((np.sin(2 * np.pi * 1700 * tt) * .5 + rng.standard_normal(n) * .35) * np.exp(-tt * 100), 5000)
    put(x * .5 * g, t, .05)


def key(t, g=1.0):
    n = int(.03 * SR)
    tt = np.arange(n) / SR
    x = lp(rng.standard_normal(n) * np.exp(-tt * 140), 3500) + np.sin(2 * np.pi * 2200 * tt) * np.exp(-tt * 160) * .4
    put(x * .16 * g, t, rng.uniform(-.2, .2))


def whoosh(t, d=.7, g=1.0):
    n = int(d * SR)
    tt = np.arange(n) / SR
    x = rng.standard_normal(n)
    out = np.zeros(n)
    fc = np.geomspace(300, 4200, n)
    for i in range(0, n, 2048):
        seg = x[i:i + 2048]
        c = fc[min(i, n - 1)]
        X = rfft(seg)
        f = rfftfreq(len(seg), 1 / SR)
        X[(f < c * .5) | (f > c * 1.6)] = 0
        out[i:i + len(seg)] += irfft(X, len(seg))
    e = np.sin(np.pi * np.clip(tt / d, 0, 1)) ** 1.8
    x = out * e
    i = int(t * SR)
    m = min(n, N - i)
    L[i:i + m] += (x * np.linspace(1, .4, n))[:m] * .5 * g
    R[i:i + m] += (x * np.linspace(.4, 1, n))[:m] * .5 * g


def pop(t, g=1.0):
    n = int(.12 * SR)
    tt = np.arange(n) / SR
    x = np.sin(2 * np.pi * np.cumsum(np.linspace(420, 220, n)) / SR) * np.exp(-tt * 38)
    put(lp(x, 2200) * .45 * g, t, 0)


def riser(t, d, g=1.0):
    n = int(d * SR)
    tt = np.arange(n) / SR
    x = hp(rng.standard_normal(n), 500) * (tt / d) ** 2.4
    put(lp(x, 6000) * .5 * g, t, 0)


def impact(t, g=1.0):
    n = int(1.8 * SR)
    tt = np.arange(n) / SR
    x = np.sin(2 * np.pi * np.cumsum(46 + 70 * np.exp(-tt * 12)) / SR) * np.exp(-tt * 2.6)
    put(lp(x, 400) * .6 * g, t, 0)


def blink(t, g=1.0):
    n = int(.25 * SR)
    tt = np.arange(n) / SR
    x = np.sin(2 * np.pi * 70 * tt) * np.exp(-tt * 14) * .6
    put(x * g, t, 0)
    click(t, .7 * g)


# fail scene (4.6 → terminal typing): near-silent keys
for st, ln in [(4.6 + 1.2, 42), (4.6 + 2.1, 51), (4.6 + 3.1, 37), (4.6 + 4.0, 38)]:
    for i in range(0, ln, 2):
        key(st + i * min(.7, ln / 90) / ln, .8)
# seams: whoosh
whoosh(4.05, .9, 1.0)      # dive into the laptop
whoosh(10.75, .7, .7)      # blue flood
whoosh(14.3, .6, .8)       # whip to the dashboard
whoosh(18.8, .6, .8)       # iris to chat
whoosh(24.4, .8, .8)       # chip grows into the next ground
whoosh(33.8, .6, .6)       # iris to the flash map
whoosh(38.8, .6, .7)       # whip to dashboard
whoosh(44.1, .8, .8)       # check grows through
# cursor clicks (real captures)
click(14.6 + 1.0)
click(39.0 + 3.0)
click(55.0 + 1.6)
# typing: the rename, then the prompt
for i in range(10):
    key(14.6 + 1.53 + i * .067)
for i in range(25):
    key(19.0 + 1.2 + i * 1.5 / 25)
# landing chips/cards
pop(19.0 + 3.4)
pop(19.0 + 3.0, .6)
pop(55.0 + 3.9, .8)
# payoff: ONE riser into ONE impact at the first blink, then a tick on every blink
riser(44.6 + .6, 1.8, .9)
impact(44.6 + 2.4)
for i in range(9):
    if i > 0:
        blink(44.6 + 2.4 + i * .5, .8)

out = np.stack([L, R], 1)[: int(DUR * SR)]
out = np.tanh(out * 1.25)
fl = int(1.5 * SR)
out[-fl:] *= np.linspace(1, 0, fl)[:, None]
out = out / (np.max(np.abs(out)) + 1e-9) * .8
with wave.open("assets/audio/mix.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((out * 32767).astype("<i2").tobytes())
print("wrote assets/audio/mix.wav", DUR, "s")
